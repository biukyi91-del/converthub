"use client"

import * as React from "react"
import {
  Download,
  Loader2,
  Settings2,
  X,
  AlertTriangle,
  CheckCircle2,
  Clock3,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { PreviewDialogButton } from "@/components/converter/preview-dialog"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { FormatIcon } from "@/components/converter/format-icon"
import { useConvertStore, type FileRow } from "@/lib/store"
import {
  CATEGORIES,
  FORMATS,
  formatBytes,
  getSettingsSchema,
  getTargets,
  isPairSupported,
  type SettingField,
} from "@/lib/convert/registry"

function StatusChip({ row }: { row: FileRow }) {
  switch (row.status) {
    case "uploading":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-white" style={{ backgroundColor: "#b53836" }}>
          <Loader2 aria-hidden className="size-3 animate-spin" />
          Uploading {row.uploadProgress}%
        </span>
      )
    case "queued":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-400/40 bg-zinc-500/10 px-2.5 py-1 text-xs font-medium text-muted-foreground">
          <Clock3 aria-hidden className="size-3" />
          Queued
        </span>
      )
    case "processing":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-white" style={{ backgroundColor: "#b53836" }}>
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-white" />
          Converting {row.progress}%
        </span>
      )
    case "finished":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/40 bg-emerald-600/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 aria-hidden className="size-3" />
          Finished
        </span>
      )
    case "error":
      return (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-help items-center gap-1.5 rounded-full border border-destructive/50 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
                <AlertTriangle aria-hidden className="size-3" />
                Error
              </span>
            </TooltipTrigger>
            <TooltipContent role="status" className="max-w-72">
              {row.error ?? "Conversion failed."}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    default:
      return null
  }
}

function SettingsField({
  rowId,
  field,
  value,
  onChange,
}: {
  rowId: string
  field: SettingField
  value: string | number | undefined
  onChange: (name: string, v: string | number) => void
}) {
  if (field.type === "enum") {
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`set-${rowId}-${field.name}`} className="text-xs">
          {field.label}
        </Label>
        <Select
          value={String(value ?? field.default ?? "")}
          onValueChange={(v) => onChange(field.name, v)}
        >
          <SelectTrigger id={`set-${rowId}-${field.name}`} size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.enumValues?.map((e) => (
              <SelectItem key={e.value} value={e.value}>
                {e.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field.help && <p className="text-[11px] text-muted-foreground">{field.help}</p>}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`set-${rowId}-${field.name}`} className="text-xs">
        {field.label}
        {field.unit ? ` (${field.unit})` : ""}
      </Label>
      <Input
        id={`set-${rowId}-${field.name}`}
        type="number"
        inputMode="numeric"
        min={field.min}
        max={field.max}
        value={value ?? ""}
        placeholder={field.default !== undefined ? String(field.default) : ""}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === "") return
          const n = Number(raw)
          if (Number.isFinite(n)) onChange(field.name, n)
        }}
        className="h-8"
      />
      {field.help && <p className="text-[11px] text-muted-foreground">{field.help}</p>}
    </div>
  )
}

export function FileRowItem({ row }: { row: FileRow }) {
  const setTarget = useConvertStore((s) => s.setTarget)
  const setSetting = useConvertStore((s) => s.setSetting)
  const removeRow = useConvertStore((s) => s.removeRow)

  const locked = row.status !== "pending"
  const groups = row.sourceFormat ? getTargets(row.sourceFormat) : []
  const schema = row.sourceFormat && row.target ? getSettingsSchema(row.sourceFormat, row.target) : []
  const unsupported =
    !row.sourceFormat || !isPairSupported(row.sourceFormat, row.target ?? "")
  const meta = row.target ? FORMATS[row.target] : null
  const sourceMeta = row.sourceFormat ? FORMATS[row.sourceFormat] : null
  const busy = row.status === "uploading" || row.status === "processing"
  const progressValue = busy ? (row.status === "uploading" ? row.uploadProgress : row.progress) : row.progress

  return (
    <li
      className={`flex flex-col gap-3 rounded-md border bg-white p-3 dark:bg-zinc-900 md:flex-row md:items-center ${
        row.status === "error" ? "border-destructive/40" : ""
      }`}
      aria-label={`Convert ${row.name}`}
    >
      <FormatIcon format={row.sourceFormat} />

      <div className="min-w-0 flex-1 md:max-w-56">
        <p className="truncate text-sm font-medium" title={row.name}>
          {row.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {formatBytes(row.size)}
          {sourceMeta ? ` · ${sourceMeta.name}` : ""}
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        {unsupported ? (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex cursor-help items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                  <AlertTriangle aria-hidden className="size-3" />
                  Format not supported yet
                </span>
              </TooltipTrigger>
              <TooltipContent>
                This file type has no conversion recipe. Supported sources: images,
                documents, spreadsheets, audio, video, archives.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <>
            <Select
              value={row.target ?? undefined}
              onValueChange={(v) => setTarget(row.id, v)}
              disabled={locked}
            >
              <SelectTrigger
                className="w-full sm:w-40"
                size="sm"
                aria-label={`Output format for ${row.name}`}
              >
                <SelectValue placeholder="Output format" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {groups.map((g) => (
                  <SelectGroup key={`${g.category}-${g.label}`}>
                    <SelectLabel>{CATEGORIES[g.category].label}</SelectLabel>
                    {g.formats.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f.toUpperCase()}
                        {f === row.sourceFormat ? " (re-encode)" : ""}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>

            {schema.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-9 shrink-0"
                    disabled={locked}
                    aria-label={`Conversion settings for ${row.name}`}
                  >
                    <Settings2 className="size-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64">
                  <p className="mb-3 text-sm font-semibold">
                    {meta ? `${meta.name} settings` : "Settings"}
                  </p>
                  <div className="flex flex-col gap-3">
                    {schema.map((field) => (
                      <SettingsField
                        key={field.name}
                        rowId={row.id}
                        field={field}
                        value={row.settings[field.name]}
                        onChange={(name, v) => setSetting(row.id, name, v)}
                      />
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-3 md:w-52 md:justify-end">
        {busy && (
          <div className="flex w-full flex-col gap-1 md:w-32" aria-live="polite">
            <div
              role="progressbar"
              aria-valuenow={progressValue}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progress for ${row.name}`}
              className="h-2 w-full overflow-hidden rounded-full bg-brand/15"
            >
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${progressValue}%`, backgroundColor: "#b53836" }}
              />
            </div>
          </div>
        )}
        {row.status === "error" && (
          <p
            className="hidden max-w-40 truncate text-xs text-destructive lg:block"
            title={row.error ?? undefined}
          >
            {row.error ?? "Conversion failed."}
          </p>
        )}
        <StatusChip row={row} />

        {row.status === "finished" && row.jobId && (
          <>
            <PreviewDialogButton
              target={{
                jobId: row.jobId,
                outputName: row.outputName,
                targetFormat: row.target ?? "",
                outputSizeBytes: row.outputSizeBytes,
              }}
            />
            <Button
              asChild
              size="sm"
              className="min-h-9 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <a href={`/api/download/${row.jobId}`} download>
                <Download aria-hidden className="size-4" />
                Download
              </a>
            </Button>
          </>
        )}

        {!locked && (
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => removeRow(row.id)}
            aria-label={`Remove ${row.name} from the list`}
          >
            <X aria-hidden className="size-4" />
          </Button>
        )}
      </div>
    </li>
  )
}
