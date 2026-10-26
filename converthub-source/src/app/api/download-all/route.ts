import fsp from "fs/promises"
import { Readable } from "stream"
import { ZipArchive } from "archiver"

import { db } from "@/lib/db"
import { jsonError } from "@/lib/convert/serialize"

export const runtime = "nodejs"

/** converthub-YYYYMMDD-HHmm.zip (spec §7) */
function zipName(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `converthub-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(
    date.getHours()
  )}${p(date.getMinutes())}.zip`
}

/**
 * GET /api/download-all?ids=a,b — zip finished outputs on the fly (archiver).
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    const ids = (url.searchParams.get("ids") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50)

    if (ids.length === 0) {
      return jsonError(400, "No job ids were provided.")
    }

    const rows = await db.conversionJob.findMany({ where: { id: { in: ids } } })
    const byId = new Map(rows.map((r) => [r.id, r]))

    const ready: Array<{ absPath: string; name: string }> = []
    for (const id of ids) {
      const job = byId.get(id)
      if (!job || job.status !== "finished" || !job.outputPath || !job.outputName) continue
      try {
        const stat = await fsp.stat(job.outputPath)
        if (stat.isFile()) ready.push({ absPath: job.outputPath, name: job.outputName })
      } catch {
        // purged -> skip
      }
    }

    if (ready.length === 0) {
      return jsonError(404, "None of the selected conversions are ready for download.")
    }

    // archiver v8 (pure ESM) replaced the archiver(format, opts) factory with
    // format classes — ZipArchive is the zip-flavoured Transform stream.
    const archive = new ZipArchive({ zlib: { level: 6 } })
    const used = new Map<string, number>()
    for (const file of ready) {
      const count = used.get(file.name) ?? 0
      used.set(file.name, count + 1)
      const name = count === 0 ? file.name : file.name.replace(/(\.[^.]+)?$/, `-${count + 1}$1`)
      archive.file(file.absPath, { name })
    }
    void archive.finalize()

    const stream = Readable.toWeb(archive) as ReadableStream<Uint8Array>
    return new Response(stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipName()}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    console.error("[GET /api/download-all]", err)
    return jsonError(500, "Unexpected server error while building the ZIP archive.")
  }
}
