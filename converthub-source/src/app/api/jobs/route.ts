import { db } from "@/lib/db"
import {
  MAX_FILE_SIZE_BYTES,
  detectSourceFormat,
  isPairSupported,
  unsupportedReason,
  normalizeSettings,
  FORMATS,
  formatBytes,
} from "@/lib/convert/registry"
import {
  convertQueue,
  ensureStorageRoots,
  purgeExpired,
  saveUpload,
  removeJobFiles,
} from "@/lib/convert/queue"
import { serializeJob, jsonError } from "@/lib/convert/serialize"

export const runtime = "nodejs"

interface TargetSpec {
  target?: string
  settings?: Record<string, unknown>
}

/**
 * POST /api/jobs — multipart/form-data
 *   files[]  : one or more files
 *   targets  : JSON string array parallel to files, e.g. [{"target":"jpg","settings":{"quality":85}}]
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await ensureStorageRoots()

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return jsonError(400, "Could not read the upload. Please try again.")
    }

    const files = form.getAll("files").filter((f): f is File => f instanceof File)
    if (files.length === 0) {
      return jsonError(400, "No files were uploaded.")
    }

    let specs: TargetSpec[] = []
    const targetsRaw = form.get("targets")
    if (typeof targetsRaw === "string" && targetsRaw.trim()) {
      try {
        const parsed = JSON.parse(targetsRaw) as unknown
        if (Array.isArray(parsed)) specs = parsed as TargetSpec[]
      } catch {
        return jsonError(400, "The targets field must be a JSON array.")
      }
    }

    // ---- validate everything BEFORE creating rows (early rejection, spec §6) ----
    const headBufs: (Uint8Array | undefined)[] = []
    for (const file of files) {
      if (file.size === 0) {
        return jsonError(400, `"${file.name}" is empty.`)
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        return jsonError(
          400,
          `"${file.name}" is ${formatBytes(file.size)} — the limit is ${formatBytes(
            MAX_FILE_SIZE_BYTES
          )} per file.`
        )
      }
      try {
        const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
        headBufs.push(head)
      } catch {
        headBufs.push(undefined)
      }
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const spec = specs[i] ?? {}
      const source = detectSourceFormat(file.name, headBufs[i])
      const reason = unsupportedReason(source)
      if (reason) {
        return jsonError(400, `"${file.name}": ${reason}`)
      }
      const target = typeof spec.target === "string" ? spec.target.toLowerCase().trim() : ""
      if (!target) {
        return jsonError(400, `"${file.name}": no output format was selected.`)
      }
      if (!FORMATS[target]) {
        return jsonError(400, `"${file.name}": "${target}" is not a valid output format.`)
      }
      if (!isPairSupported(source!, target)) {
        return jsonError(
          400,
          `"${file.name}": converting ${source!.toUpperCase()} to ${target.toUpperCase()} is not supported.`
        )
      }
    }

    // ---- persist + enqueue ----
    const jobs = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const spec = specs[i] ?? {}
      const source = detectSourceFormat(file.name, headBufs[i])!
      const target = (spec.target as string).toLowerCase().trim()
      const settings = normalizeSettings(source, target, spec.settings)

      const row = await db.conversionJob.create({
        data: {
          originalName: file.name,
          storedPath: "pending",
          sizeBytes: file.size,
          sourceFormat: source,
          targetFormat: target,
          category: FORMATS[source].category,
          settings: JSON.stringify(settings),
          status: "queued",
        },
      })

      const buffer = new Uint8Array(await file.arrayBuffer())
      const storedPath = await saveUpload(row.id, file.name, buffer.buffer)
      const updated = await db.conversionJob.update({
        where: { id: row.id },
        data: { storedPath },
      })

      convertQueue.enqueue(row.id)
      jobs.push(serializeJob(updated))
    }

    return Response.json({ jobs }, { status: 201 })
  } catch (err) {
    console.error("[POST /api/jobs]", err)
    return jsonError(500, "Unexpected server error while creating the conversion jobs.")
  }
}

/**
 * GET /api/jobs?ids=a,b      — poll statuses
 * GET /api/jobs?history=1    — recent jobs for the history panel
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await purgeExpired()
    const url = new URL(request.url)

    const idsParam = url.searchParams.get("ids")
    if (idsParam !== null) {
      const ids = idsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 50)
      if (ids.length === 0) return Response.json({ jobs: [] })
      const rows = await db.conversionJob.findMany({ where: { id: { in: ids } } })
      const byId = new Map(rows.map((r) => [r.id, r]))
      const ordered = ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r)
      return Response.json({ jobs: ordered.map(serializeJob) })
    }

    const limit = Math.min(Number(url.searchParams.get("limit") ?? 30) || 30, 100)
    const rows = await db.conversionJob.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    })
    return Response.json({ jobs: rows.map(serializeJob) })
  } catch (err) {
    console.error("[GET /api/jobs]", err)
    return jsonError(500, "Unexpected server error while fetching jobs.")
  }
}

/** DELETE /api/jobs?all=1 — clear the whole history (spec §8). */
export async function DELETE(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    if (url.searchParams.get("all") === "1") {
      const rows = await db.conversionJob.findMany({ select: { id: true } })
      await Promise.all(rows.map((r) => removeJobFiles(r.id)))
      await db.conversionJob.deleteMany({})
      return Response.json({ deleted: rows.length })
    }
    return jsonError(400, "Use ?all=1 to clear the history, or DELETE /api/jobs/:id for one job.")
  } catch (err) {
    console.error("[DELETE /api/jobs]", err)
    return jsonError(500, "Unexpected server error while clearing history.")
  }
}
