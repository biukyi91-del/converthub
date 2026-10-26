"use client"

import * as React from "react"
import { formatDistanceToNow } from "date-fns"
import { Download, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { FormatIcon } from "@/components/converter/format-icon"
import { PreviewDialogButton } from "@/components/converter/preview-dialog"
import { useConvertStore, type HistoryItem } from "@/lib/store"
import { formatBytes } from "@/lib/convert/registry"

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "finished":
      return (
        <Badge className="border border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
          Finished
        </Badge>
      )
    case "error":
      return <Badge variant="outline" className="border-destructive/50 text-destructive">Error</Badge>
    case "processing":
    case "queued":
      return <Badge className="bg-brand text-white">{status === "queued" ? "Queued" : "Converting"}</Badge>
    default:
      return <Badge variant="secondary">{status}</Badge>
  }
}

function HistoryRow({ item }: { item: HistoryItem }) {
  const deleteHistoryItem = useConvertStore((s) => s.deleteHistoryItem)
  const when = formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })
  const duration =
    item.durationMs !== null && item.durationMs !== undefined
      ? `${(item.durationMs / 1000).toFixed(1)}s`
      : null

  return (
    <li className="flex items-center gap-3 p-3">
      <FormatIcon format={item.sourceFormat} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={item.originalName}>
          {item.originalName}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {item.sourceFormat.toUpperCase()} → {item.targetFormat.toUpperCase()} ·{" "}
          {formatBytes(item.sizeBytes)}
          {item.outputSizeBytes ? ` → ${formatBytes(item.outputSizeBytes)}` : ""}
          {duration ? ` · ${duration}` : ""} · {when}
        </p>
        {item.error && (
          <p className="truncate text-xs text-destructive" title={item.error}>
            {item.error}
          </p>
        )}
      </div>
      <StatusBadge status={item.status} />
      {item.status === "finished" && (
        <PreviewDialogButton
          target={{
            jobId: item.id,
            outputName: item.outputName,
            targetFormat: item.targetFormat,
            outputSizeBytes: item.outputSizeBytes,
          }}
        />
      )}
      {item.status === "finished" && (
        <Button asChild size="sm" variant="outline" className="min-h-9">
          <a href={`/api/download/${item.id}`} download aria-label={`Download ${item.originalName}`}>
            <Download aria-hidden className="size-4" />
            <span className="hidden sm:inline">Download</span>
          </a>
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={() => void deleteHistoryItem(item.id)}
        aria-label={`Delete history entry for ${item.originalName}`}
      >
        <Trash2 aria-hidden className="size-4" />
      </Button>
    </li>
  )
}

/** "Recent conversions" panel (spec §8). */
export function HistoryPanel() {
  const history = useConvertStore((s) => s.history)
  const historyLoading = useConvertStore((s) => s.historyLoading)
  const clearHistory = useConvertStore((s) => s.clearHistory)

  return (
    <section id="history" aria-label="Recent conversions" className="mt-14 scroll-mt-20">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">Recent conversions</h2>
        {history.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="min-h-9 text-muted-foreground hover:text-destructive">
                <Trash2 aria-hidden className="size-4" />
                Clear history
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear the conversion history?</AlertDialogTitle>
                <AlertDialogDescription>
                  This deletes every job record and its stored files from the server. It
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={() => void clearHistory()}
                >
                  Delete everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <div className="mt-3 max-h-96 divide-y overflow-y-auto rounded-lg border bg-white ch-scroll dark:bg-zinc-900">
        {historyLoading && history.length === 0 ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
            ))}
          </div>
        ) : history.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No conversions yet — your recent jobs will appear here.
          </p>
        ) : (
          <ul className="divide-y">
            {history.map((item) => (
              <HistoryRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
