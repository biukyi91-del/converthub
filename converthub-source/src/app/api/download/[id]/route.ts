import fs from "fs"
import fsp from "fs/promises"
import { Readable } from "stream"
import path from "path"

import { db } from "@/lib/db"
import { FORMATS } from "@/lib/convert/registry"
import { jsonError } from "@/lib/convert/serialize"

export const runtime = "nodejs"

/** Content-Disposition-safe ASCII filename fallback. */
function asciiName(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
}

/**
 * GET /api/download/:id — stream the converted output as an attachment.
 * 404 with a friendly "expired" message when the job is not finished or the
 * file has been purged by the retention policy (spec §7).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id } = await params
    const job = await db.conversionJob.findUnique({ where: { id } })

    if (!job) {
      return jsonError(404, "This conversion does not exist (or expired).")
    }
    if (job.status !== "finished" || !job.outputPath || !job.outputName) {
      return jsonError(404, "This file is not ready for download yet.")
    }
    const outputPath = path.resolve(job.outputPath)
    if (!outputPath.startsWith(path.resolve(process.cwd(), "storage") + path.sep)) {
      return jsonError(404, "This file is not available.")
    }
    let stat: fs.Stats
    try {
      stat = await fsp.stat(outputPath)
    } catch {
      return jsonError(404, "This file has expired and was removed from the server.")
    }
    if (!stat.isFile()) {
      return jsonError(404, "This file has expired and was removed from the server.")
    }

    const mime = FORMATS[job.targetFormat]?.mime ?? "application/octet-stream"
    const stream = Readable.toWeb(fs.createReadStream(outputPath)) as ReadableStream<Uint8Array>
    const name = asciiName(job.outputName)

    return new Response(stream, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(
          job.outputName
        )}`,
        "Cache-Control": "no-store",
      },
    })
  } catch (err) {
    console.error("[GET /api/download/:id]", err)
    return jsonError(500, "Unexpected server error while downloading the file.")
  }
}
