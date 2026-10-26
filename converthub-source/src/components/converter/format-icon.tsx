import {
  FileArchive,
  FileAudio,
  FileText,
  FileType,
  FileVideo,
  Image as ImageIcon,
} from "lucide-react"

import { CATEGORIES, FORMATS, type Category } from "@/lib/convert/registry"

const ICONS: Record<Category, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  image: ImageIcon,
  document: FileText,
  pdf: FileType,
  audio: FileAudio,
  video: FileVideo,
  archive: FileArchive,
}

/** Category icon + tint for a source format (brand-red accent, spec §2). */
export function FormatIcon({
  format,
  className,
}: {
  format: string | null
  className?: string
}) {
  const category = (format && FORMATS[format]?.category) || "document"
  const Icon = ICONS[category] ?? FileText
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand"
      style={{ backgroundColor: "color-mix(in srgb, #b53836 12%, transparent)" }}
    >
      <Icon className={`size-4.5 text-brand ${className ?? ""}`} />
    </span>
  )
}
