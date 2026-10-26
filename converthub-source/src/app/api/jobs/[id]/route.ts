import { db } from "@/lib/db"
import { removeJobFiles, outputDirFor, uploadDirFor } from "@/lib/convert/queue"
import { jsonError } from "@/lib/convert/serialize"
import fs from "fs"

export const runtime = "nodejs"

/** DELETE /api/jobs/:id — delete row + files (CloudConvert parity, spec §7). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id } = await params
    const job = await db.conversionJob.findUnique({ where: { id } })
    if (!job) {
      return jsonError(404, "This job does not exist (or was already deleted).")
    }
    await removeJobFiles(id)
    await db.conversionJob.delete({ where: { id } })
    return Response.json({ deleted: id })
  } catch (err) {
    console.error("[DELETE /api/jobs/:id]", err)
    return jsonError(500, "Unexpected server error while deleting the job.")
  }
}

/** GET /api/jobs/:id — single job detail (handy for debugging). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  try {
    const { id } = await params
    const job = await db.conversionJob.findUnique({ where: { id } })
    if (!job) return jsonError(404, "This job does not exist.")
    return Response.json({
      job: {
        ...job,
        uploadDirExists: fs.existsSync(uploadDirFor(id)),
        outputDirExists: fs.existsSync(outputDirFor(id)),
      },
    })
  } catch (err) {
    console.error("[GET /api/jobs/:id]", err)
    return jsonError(500, "Unexpected server error while fetching the job.")
  }
}
