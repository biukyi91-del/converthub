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

/** Mime fixes for formats Chromium renders natively but labels oddly. */
const INLINE_MIME_OVERRIDES: Record<string, string> = {
  m4a: "audio/mp4",
  opus: "audio/ogg",
  tar: "application/x-tar",
}

async function listZip(
  outputPath: string
): Promise<Array<{ name: string; sizeBytes: number }>> {
  const AdmZip = (await import("adm-zip")).default
  const zip = new AdmZip(outputPath)
  return zip.getEntries().map((entry) => ({
    name: entry.entryName,
    sizeBytes: entry.header.size,
  }))
}

async function listTar(
  outputPath: string
): Promise<Array<{ name: string; sizeBytes: number }>> {
  const { execFile } = await import("child_process")
  const { promisify } = await import("util")
  const run = promisify(execFile)
  // -tvzf gives "perms owner size date name" — extract size + name columns
  const { stdout } = await run("tar", ["-tvzf", outputPath], {
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  const out: Array<{ name: string; sizeBytes: number }> = []
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(/\s+/)
    if (parts.length >= 6) {
      const size = Number(parts[2])
      const name = parts.slice(5).join(" ")
      if (name && name !== "./") out.push({ name, sizeBytes: Number.isFinite(size) ? size : 0 })
    }
  }
  return out
}

/**
 * GET /api/preview/:id          — stream the converted output INLINE (no download)
 * GET /api/preview/:id?list=1   — JSON listing for archive outputs (zip/tar/tar.gz)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id } = await params
    const job = await db.conversionJob.findUnique({ where: { id } })

    if (!job) {
      return jsonError(404, "This conversion does not exist (or expired).")
    }
    if (job.status !== "finished" || !job.outputPath || !job.outputName) {
      return jsonError(404, "This file is not ready for preview yet.")
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

    const targetFormat = job.targetFormat

    // ---- archive listing mode ----
    const wantsList = new URL(request.url).searchParams.get("list") === "1"
    if (wantsList) {
      try {
        const entries =
          targetFormat === "zip" ? await listZip(outputPath) : await listTar(outputPath)
        return Response.json(
          {
            entries: entries.slice(0, 500),
            truncated: entries.length > 500,
            total: entries.length,
          },
          { headers: { "Cache-Control": "no-store" } }
        )
      } catch (err) {
        if (err instanceof Error && /password|encrypted/i.test(err.message)) {
          return jsonError(422, "Password-protected archive — preview unavailable.")
        }
        console.error("[GET /api/preview/:id list]", err)
        return jsonError(422, "Could not read the archive contents.")
      }
    }

    const mime =
      INLINE_MIME_OVERRIDES[targetFormat] ??
      FORMATS[targetFormat]?.mime ??
      "application/octet-stream"
    const stream = Readable.toWeb(fs.createReadStream(outputPath)) as ReadableStream<Uint8Array>
    const name = asciiName(job.outputName)

    return new Response(stream, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(stat.size),
        "Content-Disposition": `inline; filename="${name}"; filename*=UTF-8''${encodeURIComponent(
          job.outputName
        )}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (err) {
    console.error("[GET /api/preview/:id]", err)
    return jsonError(500, "Unexpected server error while previewing the file.")
  }
}
