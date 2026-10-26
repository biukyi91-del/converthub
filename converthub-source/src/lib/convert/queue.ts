/**
 * ConvertHub job queue — module-level singleton, concurrency 2, FIFO.
 *
 * Dev hot-reload safe: the queue is cached on globalThis so per-route
 * module instances share one worker pool (spec §6).
 */

import fs from "fs"
import fsp from "fs/promises"
import path from "path"

import { db } from "@/lib/db"
import { runConversion, TIMEOUT_MS } from "./engines"
import { FORMATS, outputFileName } from "./registry"

export const STORAGE_ROOT = path.join(process.cwd(), "storage")
export const UPLOADS_ROOT = path.join(STORAGE_ROOT, "uploads")
export const OUTPUTS_ROOT = path.join(STORAGE_ROOT, "outputs")

export function uploadDirFor(jobId: string): string {
  return path.join(UPLOADS_ROOT, jobId)
}
export function outputDirFor(jobId: string): string {
  return path.join(OUTPUTS_ROOT, jobId)
}

type PrismaJob = Awaited<ReturnType<typeof db.conversionJob.findFirstOrThrow>>

interface QueueJob {
  id: string
  enqueuedAt: number
}

class ConvertQueue {
  private queue: QueueJob[] = []
  private active = 0
  readonly concurrency = 2

  enqueue(jobId: string): void {
    if (this.queue.some((j) => j.id === jobId)) return
    this.queue.push({ id: jobId, enqueuedAt: Date.now() })
    this.drain()
  }

  get depth(): number {
    return this.queue.length + this.active
  }

  private drain(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!
      this.active++
      void this.run(job.id)
        .catch(() => {})
        .finally(() => {
          this.active--
          this.drain()
        })
    }
  }

  private async run(jobId: string): Promise<void> {
    let job: PrismaJob | null = null
    try {
      job = await db.conversionJob.findUnique({ where: { id: jobId } })
    } catch {
      return
    }
    if (!job || job.status === "finished") return

    const outDir = outputDirFor(jobId)
    const startedAt = Date.now()
    let lastWritten = 0
    let maxProgress = 0

    const report = async (p: number): Promise<void> => {
      if (p <= maxProgress) return // never regress (spec §6)
      maxProgress = p
      const now = Date.now()
      if (p >= 100 || now - lastWritten >= 300) {
        lastWritten = now
        await db.conversionJob
          .update({ where: { id: jobId }, data: { progress: Math.min(p, 99) } })
          .catch(() => {})
      }
    }

    try {
      await fsp.mkdir(outDir, { recursive: true })
      await db.conversionJob.update({
        where: { id: jobId },
        data: { status: "processing", progress: maxProgress >= 10 ? maxProgress : 10 },
      })

      const settings = JSON.parse(job.settings || "{}") as Record<string, string | number>
      const outputName = outputFileName(job.originalName, job.targetFormat)

      const srcCat = FORMATS[job.sourceFormat]?.category
      const tgtCat = FORMATS[job.targetFormat]?.category
      const isMedia = srcCat === "audio" || srcCat === "video" || tgtCat === "audio" || tgtCat === "video"

      // belt & braces: even if an engine stalls, never leave the job stuck
      const hardDeadlineMs = (isMedia ? TIMEOUT_MS.video : TIMEOUT_MS.soffice) + 20_000
      const deadline = new Promise<never>((_, reject) => {
        const t = setTimeout(
          () => reject(new Error("The conversion took too long and was stopped.")),
          hardDeadlineMs
        )
        if (typeof t.unref === "function") t.unref()
      })

      // staged engines (sharp/pdf/doc): 10 received -> 60 engine running -> 100.
      // media engines (ffmpeg) drive 5..95 themselves via -progress parsing.
      if (!isMedia) await report(60)

      await Promise.race([
        runConversion({
          jobId,
          sourceFormat: job.sourceFormat,
          targetFormat: job.targetFormat,
          inputPath: job.storedPath,
          outputDir: outDir,
          outputName,
          settings,
          onProgress: (p) => void report(p),
        }),
        deadline,
      ])

      const outPath = path.join(outDir, outputName)
      const stat = await fsp.stat(outPath)
      if (!stat.isFile() || stat.size === 0) throw new Error("Converter produced an empty file.")

      await db.conversionJob.update({
        where: { id: jobId },
        data: {
          status: "finished",
          progress: 100,
          outputName,
          outputPath: outPath,
          outputSizeBytes: stat.size,
          durationMs: Date.now() - startedAt,
          completedAt: new Date(),
          error: null,
        },
      })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "The conversion failed for an unknown reason."
      await db.conversionJob
        .update({
          where: { id: jobId },
          data: {
            status: "error",
            error: message.slice(0, 500),
            durationMs: Date.now() - startedAt,
            completedAt: new Date(),
          },
        })
        .catch(() => {})
    }
  }
}

/*
 * Dev hot-reload escape hatch: the singleton is cached on globalThis (keyed by
 * QUEUE_VERSION) so queued jobs survive route-module re-evaluation — but that
 * also means edits to engines.ts/queue.ts are NOT picked up by an already-
 * running dev server (stale closures keep working). Bump QUEUE_VERSION whenever
 * you change conversion code during development: the next module evaluation
 * builds a fresh queue wired to the freshly-imported engines module.
 */
const QUEUE_VERSION = "v3"
const globalForQueue = globalThis as unknown as {
  [`__convertQueue_${string}`]?: ConvertQueue
}
const queueKey = `__convertQueue_${QUEUE_VERSION}`
export const convertQueue: ConvertQueue =
  globalForQueue[queueKey] ?? (globalForQueue[queueKey] = new ConvertQueue())

/* ------------------------------------------------------------------ */
/* Storage helpers                                                     */
/* ------------------------------------------------------------------ */

export async function ensureStorageRoots(): Promise<void> {
  await fsp.mkdir(UPLOADS_ROOT, { recursive: true })
  await fsp.mkdir(OUTPUTS_ROOT, { recursive: true })
}

/** Save an uploaded file under storage/uploads/{jobId}/<originalName>. */
export async function saveUpload(jobId: string, originalName: string, data: ArrayBuffer): Promise<string> {
  const dir = uploadDirFor(jobId)
  await fsp.mkdir(dir, { recursive: true })
  const safeName = path.basename(originalName).replace(/[/\\]/g, "_") || "file"
  const storedPath = path.join(dir, safeName)
  await fsp.writeFile(storedPath, Buffer.from(data))
  return storedPath
}

export async function removeJobFiles(jobId: string): Promise<void> {
  await fsp.rm(uploadDirFor(jobId), { recursive: true, force: true }).catch(() => {})
  await fsp.rm(outputDirFor(jobId), { recursive: true, force: true }).catch(() => {})
}

/* ------------------------------------------------------------------ */
/* Retention: purge jobs/files older than 3h (runs lazily on GET)      */
/* ------------------------------------------------------------------ */

const globalForCleanup = globalThis as unknown as { __chLastCleanup?: number }

export async function purgeExpired(force = false): Promise<void> {
  const now = Date.now()
  if (!force && globalForCleanup.__chLastCleanup && now - globalForCleanup.__chLastCleanup < 60_000) {
    return
  }
  globalForCleanup.__chLastCleanup = now
  try {
    const cutoff = new Date(now - 3 * 60 * 60 * 1000)
    const old = await db.conversionJob.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
    })
    if (old.length > 0) {
      await Promise.all(old.map((j) => removeJobFiles(j.id)))
      await db.conversionJob.deleteMany({ where: { createdAt: { lt: cutoff } } })
    }

    // orphan dirs (row gone) — best effort
    for (const root of [UPLOADS_ROOT, OUTPUTS_ROOT]) {
      let entries: fs.Dirent[] = []
      try {
        entries = await fsp.readdir(root, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const exists = await db.conversionJob
          .findUnique({ where: { id: entry.name }, select: { id: true } })
          .catch(() => null)
        if (!exists) {
          await fsp.rm(path.join(root, entry.name), { recursive: true, force: true }).catch(() => {})
        }
      }
    }
  } catch {
    // cleanup must never break API responses
  }
}
