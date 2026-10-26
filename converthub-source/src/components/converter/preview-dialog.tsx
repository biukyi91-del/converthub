"use client"

import * as React from "react"
import {
  Download,
  Eye,
  FileQuestion,
  Loader2,
  TriangleAlert,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { FORMATS, formatBytes } from "@/lib/convert/registry"

/* ------------------------------------------------------------------ */
/* Preview capability model                                            */
/* ------------------------------------------------------------------ */

type PreviewKind =
  | "image"
  | "pdf"
  | "video"
  | "audio"
  | "text"
  | "archive"
  | "none"

const IMAGE_TARGETS = new Set(["png", "jpg", "webp", "gif", "avif", "tiff", "svg", "bmp", "ico"])
const VIDEO_TARGETS = new Set(["mp4", "webm"])
const AUDIO_TARGETS = new Set(["mp3", "wav", "ogg", "flac", "m4a", "opus", "aac"])
const TEXT_TARGETS = new Set(["txt", "md", "csv", "json", "html"])
const ARCHIVE_TARGETS = new Set(["zip", "tar", "tar.gz"])

function previewKind(target: string): PreviewKind {
  if (IMAGE_TARGETS.has(target)) return "image"
  if (target === "pdf") return "pdf"
  if (VIDEO_TARGETS.has(target)) return "video"
  if (AUDIO_TARGETS.has(target)) return "audio"
  if (TEXT_TARGETS.has(target)) return "text"
  if (ARCHIVE_TARGETS.has(target)) return "archive"
  return "none"
}

function previewUrl(jobId: string): string {
  return `/api/preview/${jobId}`
}

/* ------------------------------------------------------------------ */
/* Renderers                                                           */
/* ------------------------------------------------------------------ */

function ImagePreview({ jobId, name }: { jobId: string; name: string }) {
  return (
    <div className="flex items-center justify-center rounded-md bg-zinc-100 p-4 dark:bg-zinc-800">
      <img
        src={previewUrl(jobId)}
        alt={`Converted output preview of ${name}`}
        className="max-h-[62vh] max-w-full rounded object-contain"
      />
    </div>
  )
}

function PdfPreview({ jobId, name }: { jobId: string; name: string }) {
  return (
    <iframe
      src={previewUrl(jobId)}
      title={`PDF preview of ${name}`}
      className="h-[62vh] w-full rounded-md border bg-white"
    />
  )
}

function VideoPreview({ jobId, name }: { jobId: string; name: string }) {
  return (
    <video
      controls
      preload="metadata"
      src={previewUrl(jobId)}
      aria-label={`Video preview of ${name}`}
      className="max-h-[62vh] w-full rounded-md bg-black"
    />
  )
}

function AudioPreview({ jobId, name }: { jobId: string; name: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-md bg-zinc-100 p-8 dark:bg-zinc-800">
      <Eye aria-hidden className="size-10 text-brand" />
      <audio
        controls
        preload="metadata"
        src={previewUrl(jobId)}
        aria-label={`Audio preview of ${name}`}
        className="w-full max-w-md"
      />
    </div>
  )
}

function CsvTable({ rows }: { rows: string[][] }) {
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0)
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-xs">
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i === 0 ? "bg-zinc-100 font-semibold dark:bg-zinc-800" : ""}>
              {Array.from({ length: maxCols }, (_, c) => (
                <td key={c} className="border px-2 py-1 align-top whitespace-nowrap">
                  {row[c] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TextPreview({ jobId, format }: { jobId: string; format: string }) {
  const [state, setState] = React.useState<
    { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; text: string }
  >({ kind: "loading" })

  React.useEffect(() => {
    const controller = new AbortController()
    setState({ kind: "loading" })
    fetch(previewUrl(jobId), { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
          throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
        }
        return res.text()
      })
      .then((text) => setState({ kind: "ready", text }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Could not load the preview.",
        })
      })
    return () => controller.abort()
  }, [jobId])

  if (state.kind === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="size-4 animate-spin" /> Loading preview…
      </div>
    )
  }
  if (state.kind === "error") {
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-destructive">
        <TriangleAlert aria-hidden className="size-4" /> {state.message}
      </p>
    )
  }

  if (format === "csv") {
    const lines = state.text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 200)
    const rows = lines.map((line) => line.split(","))
    return <CsvTable rows={rows} />
  }

  const body =
    format === "json"
      ? (() => {
          try {
            return JSON.stringify(JSON.parse(state.text), null, 2)
          } catch {
            return state.text
          }
        })()
      : state.text

  return (
    <pre className="max-h-[62vh] overflow-auto rounded-md border bg-zinc-100 p-4 font-mono text-xs leading-relaxed dark:bg-zinc-800 ch-scroll">
      {body.length > 100_000 ? body.slice(0, 100_000) + "\n… (truncated)" : body}
    </pre>
  )
}

interface ArchiveEntry {
  name: string
  sizeBytes: number
}

function ArchivePreview({ jobId, format }: { jobId: string; format: string }) {
  const [state, setState] = React.useState<
    { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; entries: ArchiveEntry[]; total: number; truncated: boolean }
  >({ kind: "loading" })

  React.useEffect(() => {
    const controller = new AbortController()
    setState({ kind: "loading" })
    fetch(`${previewUrl(jobId)}?list=1`, { signal: controller.signal })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as
          | { entries?: ArchiveEntry[]; total?: number; truncated?: boolean; error?: { message?: string } }
          | null
        if (!res.ok || !data?.entries) {
          throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
        }
        return data
      })
      .then((data) =>
        setState({
          kind: "ready",
          entries: data.entries ?? [],
          total: data.total ?? 0,
          truncated: Boolean(data.truncated),
        })
      )
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Could not list the archive contents.",
        })
      })
    return () => controller.abort()
  }, [jobId])

  if (state.kind === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="size-4 animate-spin" /> Reading archive…
      </div>
    )
  }
  if (state.kind === "error") {
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-destructive">
        <TriangleAlert aria-hidden className="size-4" /> {state.message}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {state.total} file{state.total === 1 ? "" : "s"} inside the {format === "zip" ? "ZIP" : "TAR"} archive
        {state.truncated ? " (showing first 500)" : ""}
      </p>
      <ScrollArea className="h-[52vh] rounded-md border">
        <ul className="divide-y text-xs">
          {state.entries.map((entry, i) => (
            <li key={`${entry.name}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="truncate font-mono" title={entry.name}>
                {entry.name}
              </span>
              <span className="shrink-0 text-muted-foreground">{formatBytes(entry.sizeBytes)}</span>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  )
}

function NoPreview({ format }: { format: string }) {
  const meta = FORMATS[format]
  return (
    <div className="flex flex-col items-center gap-3 rounded-md bg-zinc-100 p-10 text-center dark:bg-zinc-800">
      <FileQuestion aria-hidden className="size-10 text-muted-foreground" />
      <p className="text-sm font-medium">No inline preview for {meta ? meta.name : format.toUpperCase()}</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        {meta?.category === "document"
          ? "Office documents render on your device after download — browsers cannot display them inline."
          : "This format cannot be displayed in the browser. Download it to open with a native app."}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

export interface PreviewTarget {
  jobId: string
  outputName: string | null
  targetFormat: string
  outputSizeBytes?: number | null
}

export function PreviewDialogButton({
  target,
  label = false,
  className,
}: {
  target: PreviewTarget
  label?: boolean
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const kind = previewKind(target.targetFormat)
  const meta = FORMATS[target.targetFormat]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={className ?? "min-h-9"}
          aria-label={`Preview converted ${target.outputName ?? "file"}`}
        >
          <Eye aria-hidden className="size-4" />
          {label ? <span className="hidden sm:inline">Preview</span> : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-2xl lg:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6 text-left">
            <span className="truncate" title={target.outputName ?? undefined}>
              {target.outputName ?? "Converted file"}
            </span>
          </DialogTitle>
          <DialogDescription className="text-left">
            {meta ? meta.name : target.targetFormat.toUpperCase()} preview
            {target.outputSizeBytes ? ` · ${formatBytes(target.outputSizeBytes)}` : ""} — nothing is
            downloaded until you press Download.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto ch-scroll pr-1">
          {kind === "image" && <ImagePreview jobId={target.jobId} name={target.outputName ?? "file"} />}
          {kind === "pdf" && <PdfPreview jobId={target.jobId} name={target.outputName ?? "file"} />}
          {kind === "video" && <VideoPreview jobId={target.jobId} name={target.outputName ?? "file"} />}
          {kind === "audio" && <AudioPreview jobId={target.jobId} name={target.outputName ?? "file"} />}
          {kind === "text" && <TextPreview jobId={target.jobId} format={target.targetFormat} />}
          {kind === "archive" && <ArchivePreview jobId={target.jobId} format={target.targetFormat} />}
          {kind === "none" && <NoPreview format={target.targetFormat} />}
        </div>

        <div className="flex items-center justify-end gap-2 border-t pt-3">
          <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700">
            <a href={`/api/download/${target.jobId}`} download>
              <Download aria-hidden className="size-4" />
              Download
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
