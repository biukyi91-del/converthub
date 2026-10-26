"use client"

import * as React from "react"
import { CloudUpload } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useConvertStore } from "@/lib/store"

/**
 * White upload card / dropzone — CloudConvert-style (spec §2):
 * red cloud icon, "Select your files to convert", red Select File button,
 * whole card is a dropzone with a red dashed ring on dragover.
 */
export function DropzoneCard() {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = React.useState(false)
  const addFiles = useConvertStore((s) => s.addFiles)

  const handleFiles = React.useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files)
      if (list.length === 0) return
      const { accepted, rejected } = addFiles(list)
      if (accepted > 0) {
        toast.success(
          accepted === 1 ? "1 file added" : `${accepted} files added`
        )
      }
      for (const r of rejected.slice(0, 3)) {
        toast.error(`${r.name}: ${r.reason}`)
      }
      if (rejected.length > 3) toast.error(`${rejected.length - 3} more files were rejected.`)
    },
    [addFiles]
  )

  const openPicker = () => inputRef.current?.click()

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Add files to convert: click or drop files here"
      onClick={openPicker}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          openPicker()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragActive(true)
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragActive(false)
        handleFiles(e.dataTransfer.files)
      }}
      className={`cursor-pointer rounded-lg border-2 border-dashed bg-white p-6 text-center shadow-xl outline-none transition-all focus-visible:ring-2 focus-visible:ring-brand dark:bg-zinc-900 sm:p-10 ${
        dragActive
          ? "border-brand bg-brand/5 shadow-brand/20"
          : "border-transparent shadow-zinc-950/10 dark:shadow-black/30"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files)
          e.target.value = "" // allow re-picking the same file
        }}
      />
      <CloudUpload aria-hidden className="mx-auto size-10 text-brand" />
      <h2 className="mt-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50 sm:text-xl">
        Select your files to convert
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        or drop them here — documents, images, audio, video and archives
      </p>
      <Button
        type="button"
        className="mt-6 min-h-[47px] rounded-md bg-primary px-10 text-base font-semibold text-primary-foreground hover:bg-brand-hover"
        onClick={(e) => {
          e.stopPropagation()
          openPicker()
        }}
      >
        Select File
      </Button>
    </div>
  )
}
