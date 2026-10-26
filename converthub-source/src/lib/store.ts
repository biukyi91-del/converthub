"use client"

import { create } from "zustand"
import { toast } from "sonner"

import {
  detectSourceFormat,
  getSettingsSchema,
  isPairSupported,
  isSupportedSource,
  suggestTarget,
  unsupportedReason,
  UPLOAD_CHUNK_FILES,
  UPLOAD_CHUNK_BYTES,
  type SerializedJob,
} from "@/lib/convert/registry"

export type RowStatus = "pending" | "uploading" | "queued" | "processing" | "finished" | "error"

export interface FileRow {
  id: string
  file: File
  name: string
  size: number
  sourceFormat: string | null
  target: string | null
  settings: Record<string, string | number>
  status: RowStatus
  progress: number // conversion progress 0..100
  uploadProgress: number // 0..100
  jobId: string | null
  error: string | null
  outputName: string | null
  outputSizeBytes: number | null
}

export interface HistoryItem {
  id: string
  originalName: string
  sourceFormat: string
  targetFormat: string
  status: string
  sizeBytes: number
  outputSizeBytes: number | null
  outputName: string | null
  durationMs: number | null
  error: string | null
  createdAt: string
}

export const ACTIVE_STATUSES: RowStatus[] = ["uploading", "queued", "processing"]

function defaultSettings(source: string, target: string): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const field of getSettingsSchema(source, target)) {
    if (field.default !== undefined) out[field.name] = field.default
  }
  return out
}

interface ConvertState {
  rows: FileRow[]
  history: HistoryItem[]
  historyLoading: boolean
  isSubmitting: boolean
  addFiles: (files: File[]) => { accepted: number; rejected: Array<{ name: string; reason: string }> }
  removeRow: (id: string) => void
  clearRows: (onlyDone?: boolean) => void
  setTarget: (id: string, target: string) => void
  setSetting: (id: string, name: string, value: string | number) => void
  submitAll: () => Promise<void>
  fetchHistory: () => Promise<void>
  deleteHistoryItem: (id: string) => Promise<void>
  clearHistory: () => Promise<void>
}

let pollTimer: ReturnType<typeof setInterval> | null = null

function startPolling(get: () => ConvertState, set: (partial: Partial<ConvertState>) => void) {
  if (pollTimer) return
  pollTimer = setInterval(async () => {
    const state = get()
    const activeIds = state.rows
      .filter((r) => r.jobId && ACTIVE_STATUSES.includes(r.status))
      .map((r) => r.jobId!)
    const historyActive = state.history.some((h) => h.status === "queued" || h.status === "processing")
    if (activeIds.length === 0 && !historyActive) {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      return
    }
    if (activeIds.length === 0) return
    try {
      const res = await fetch(`/api/jobs?ids=${encodeURIComponent(activeIds.join(","))}`)
      if (!res.ok) return
      const data = (await res.json()) as { jobs: SerializedJob[] }
      let finishedTransition = false
      set({
        rows: state.rows.map((row) => {
          const job = data.jobs.find((j) => j.id === row.jobId)
          if (!job) return row
          if (row.status === "finished" && job.status === "finished") return row
          if (row.status !== "finished" && job.status === "finished") finishedTransition = true
          return {
            ...row,
            status: job.status as RowStatus,
            progress: job.progress,
            error: job.error,
            outputName: job.outputName,
            outputSizeBytes: job.outputSizeBytes,
          }
        }),
      })
      if (finishedTransition) void get().fetchHistory()
    } catch {
      // network hiccup: keep polling
    }
  }, 1000)
}

export const useConvertStore = create<ConvertState>((set, get) => ({
  rows: [],
  history: [],
  historyLoading: false,
  isSubmitting: false,

  addFiles: (files) => {
    const rejected: Array<{ name: string; reason: string }> = []
    const state = get()

    const accepted: FileRow[] = []
    for (const file of files) {
      const sourceFormat = detectSourceFormat(file.name)
      if (!sourceFormat || !isSupportedSource(sourceFormat)) {
        rejected.push({ name: file.name, reason: unsupportedReason(sourceFormat) ?? "Unsupported file type" })
        continue
      }
      accepted.push({
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        name: file.name,
        size: file.size,
        sourceFormat,
        target: suggestTarget(sourceFormat),
        settings: defaultSettings(
          sourceFormat,
          suggestTarget(sourceFormat) ?? ""
        ),
        status: "pending",
        progress: 0,
        uploadProgress: 0,
        jobId: null,
        error: null,
        outputName: null,
        outputSizeBytes: null,
      })
    }

    if (accepted.length > 0) set({ rows: [...state.rows, ...accepted] })
    return { accepted: accepted.length, rejected }
  },

  removeRow: (id) => {
    const row = get().rows.find((r) => r.id === id)
    if (!row) return
    if (ACTIVE_STATUSES.includes(row.status)) return // never abandon active jobs from the list
    set({ rows: get().rows.filter((r) => r.id !== id) })
  },

  clearRows: (onlyDone) => {
    if (onlyDone) {
      set({
        rows: get().rows.filter((r) => ACTIVE_STATUSES.includes(r.status) || r.status === "pending"),
      })
    } else {
      set({ rows: get().rows.filter((r) => ACTIVE_STATUSES.includes(r.status)) })
    }
  },

  setTarget: (id, target) => {
    set({
      rows: get().rows.map((row) => {
        if (row.id !== id || !row.sourceFormat) return row
        if (!isPairSupported(row.sourceFormat, target)) return row
        return { ...row, target, settings: defaultSettings(row.sourceFormat, target), error: null }
      }),
    })
  },

  setSetting: (id, name, value) => {
    set({
      rows: get().rows.map((row) =>
        row.id === id ? { ...row, settings: { ...row.settings, [name]: value } } : row
      ),
    })
  },

  submitAll: async () => {
    const state = get()
    const pending = state.rows.filter(
      (r) =>
        r.status === "pending" &&
        r.target &&
        r.sourceFormat &&
        isPairSupported(r.sourceFormat, r.target)
    )
    if (pending.length === 0 || state.isSubmitting) return

    set({ isSubmitting: true })

    // ---- split into bounded chunks: unlimited total files, safe requests ----
    const chunks: FileRow[][] = []
    let chunk: FileRow[] = []
    let chunkBytes = 0
    for (const row of pending) {
      if (
        chunk.length > 0 &&
        (chunk.length >= UPLOAD_CHUNK_FILES || chunkBytes + row.size > UPLOAD_CHUNK_BYTES)
      ) {
        chunks.push(chunk)
        chunk = []
        chunkBytes = 0
      }
      chunk.push(row)
      chunkBytes += row.size
    }
    if (chunk.length > 0) chunks.push(chunk)

    try {
      for (const chunkRows of chunks) {
        const ids = chunkRows.map((r) => r.id)
        set({
          rows: get().rows.map((r) =>
            ids.includes(r.id) ? { ...r, status: "uploading", uploadProgress: 0 } : r
          ),
        })

        const form = new FormData()
        for (const row of chunkRows) form.append("files", row.file, row.name)
        form.append(
          "targets",
          JSON.stringify(chunkRows.map((r) => ({ target: r.target, settings: r.settings })))
        )

        const patchRows = (patch: (row: FileRow) => FileRow) =>
          set({ rows: get().rows.map((r) => (ids.includes(r.id) ? patch(r) : r)) })

        await new Promise<void>((resolve) => {
          const xhr = new XMLHttpRequest()
          xhr.open("POST", "/api/jobs")
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              // distribute chunk-level progress across the rows in this chunk
              const pct = Math.round((e.loaded / e.total) * 100)
              patchRows((row) => ({ ...row, uploadProgress: pct }))
            }
          }
          xhr.onload = () => {
            try {
              const data = JSON.parse(xhr.responseText) as {
                jobs?: SerializedJob[]
                error?: { message: string }
              }
              if (xhr.status >= 200 && xhr.status < 300 && data.jobs) {
                patchRows((row) => {
                  const idx = ids.indexOf(row.id)
                  const job = data.jobs![idx]
                  return job
                    ? {
                        ...row,
                        jobId: job.id,
                        status: job.status as RowStatus,
                        progress: job.progress,
                      }
                    : { ...row, status: "error", error: "The server did not accept this file." }
                })
              } else {
                const message = data.error?.message ?? `Upload failed (HTTP ${xhr.status}).`
                patchRows((row) => ({ ...row, status: "pending", uploadProgress: 0 }))
                toast.error(message)
              }
            } catch {
              patchRows((row) => ({ ...row, status: "pending", uploadProgress: 0 }))
              toast.error("The server returned an unexpected response.")
            }
            resolve()
          }
          xhr.onerror = () => {
            patchRows((row) => ({ ...row, status: "pending", uploadProgress: 0 }))
            toast.error("Network error — could not reach the server.")
            resolve()
          }
          xhr.send(form)
        })
      }
      const okCount = get().rows.filter((r) => r.jobId && r.status !== "error").length
      if (okCount > 0) {
        toast.success(okCount === 1 ? "Conversion started" : `${okCount} conversions started`)
      }
    } finally {
      set({ isSubmitting: false })
      void get().fetchHistory()
      startPolling(get, set)
    }
  },

  fetchHistory: async () => {
    set({ historyLoading: true })
    try {
      const res = await fetch("/api/jobs?history=1&limit=30")
      if (res.ok) {
        const data = (await res.json()) as { jobs: SerializedJob[] }
        set({
          history: data.jobs.map((j) => ({
            id: j.id,
            originalName: j.originalName,
            sourceFormat: j.sourceFormat,
            targetFormat: j.targetFormat,
            status: j.status,
            sizeBytes: j.sizeBytes,
            outputSizeBytes: j.outputSizeBytes,
            outputName: j.outputName,
            durationMs: j.durationMs,
            error: j.error,
            createdAt: j.createdAt,
          })),
        })
      }
    } catch {
      // ignore
    } finally {
      set({ historyLoading: false })
    }
  },

  deleteHistoryItem: async (id) => {
    try {
      const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" })
      if (res.ok || res.status === 404) {
        set({
          history: get().history.filter((h) => h.id !== id),
          rows: get().rows.filter((r) => r.jobId !== id),
        })
        toast.success("Entry deleted")
      } else {
        toast.error("Could not delete this entry.")
      }
    } catch {
      toast.error("Network error — could not delete this entry.")
    }
  },

  clearHistory: async () => {
    try {
      const res = await fetch("/api/jobs?all=1", { method: "DELETE" })
      if (res.ok) {
        set({ history: [] })
        toast.success("History cleared")
      } else {
        toast.error("Could not clear the history.")
      }
    } catch {
      toast.error("Network error — could not clear the history.")
    }
  },
}))
