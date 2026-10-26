import type { ConversionJob } from "@prisma/client"
import type { SerializedJob } from "./registry"

export type { SerializedJob }

export function serializeJob(job: ConversionJob): SerializedJob {
  return {
    id: job.id,
    originalName: job.originalName,
    sizeBytes: job.sizeBytes,
    sourceFormat: job.sourceFormat,
    targetFormat: job.targetFormat,
    category: job.category,
    status: job.status,
    progress: job.progress,
    error: job.error,
    outputName: job.outputName,
    outputSizeBytes: job.outputSizeBytes,
    durationMs: job.durationMs,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
  }
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status })
}
