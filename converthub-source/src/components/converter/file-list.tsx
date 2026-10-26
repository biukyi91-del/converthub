"use client"

import * as React from "react"
import { Download, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { FileRowItem } from "@/components/converter/file-row"
import { useConvertStore } from "@/lib/store"
import { formatBytes, isPairSupported } from "@/lib/convert/registry"

/** File rows + the red Convert bar (spec §8). */
export function FileList() {
  const rows = useConvertStore((s) => s.rows)
  const isSubmitting = useConvertStore((s) => s.isSubmitting)
  const submitAll = useConvertStore((s) => s.submitAll)
  const clearRows = useConvertStore((s) => s.clearRows)

  const pending = rows.filter(
    (r) => r.status === "pending" && r.target && isPairSupported(r.sourceFormat ?? "", r.target)
  )
  const finished = rows.filter((r) => r.status === "finished" && r.jobId)
  const totalSize = pending.reduce((acc, r) => acc + r.size, 0)

  if (rows.length === 0) return null

  return (
    <section
      aria-label="Files to convert"
      aria-live="polite"
      className="mt-4 rounded-lg border bg-white p-3 shadow-lg shadow-zinc-950/5 dark:bg-zinc-900 sm:p-4"
    >
      <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto ch-scroll pr-1">
        {rows.map((row) => (
          <FileRowItem key={row.id} row={row} />
        ))}
      </ul>

      <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t pt-4 sm:flex-row">
        <p className="text-sm text-muted-foreground">
          {pending.length > 0
            ? `${pending.length} file${pending.length === 1 ? "" : "s"} ready · ${formatBytes(totalSize)}`
            : `${rows.length} file${rows.length === 1 ? "" : "s"} in the list`}
        </p>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          {finished.length > 1 && (
            <Button variant="outline" asChild className="min-h-11">
              <a href={`/api/download-all?ids=${finished.map((r) => r.jobId).join(",")}`}>
                <Download aria-hidden className="size-4" />
                Download all ({finished.length})
              </a>
            </Button>
          )}
          {finished.length > 0 && pending.length === 0 && (
            <Button variant="ghost" className="min-h-11" onClick={() => clearRows(true)}>
              Clear list
            </Button>
          )}
          <Button
            className="min-h-11 rounded-md bg-primary px-8 font-semibold text-primary-foreground hover:bg-brand-hover"
            disabled={pending.length === 0 || isSubmitting}
            onClick={() => void submitAll()}
          >
            {isSubmitting && <Loader2 aria-hidden className="size-4 animate-spin" />}
            {isSubmitting
              ? "Uploading…"
              : pending.length > 0
                ? `Convert ${pending.length} file${pending.length === 1 ? "" : "s"}`
                : "Convert"}
          </Button>
        </div>
      </div>
    </section>
  )
}
