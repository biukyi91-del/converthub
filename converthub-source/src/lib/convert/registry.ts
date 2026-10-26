/**
 * ConvertHub format registry — SINGLE SOURCE OF TRUTH.
 *
 * Drives:
 *  - API validation (which source->target pairs are supported)
 *  - UI target <select> optgroups
 *  - Per-pair settings schema (CloudConvert-style option fields)
 *  - Output MIME types / extensions
 *
 * Everything listed here is engine-verified (see rea-findings + Task 3-b audit).
 */

export type Category =
  | "image"
  | "document"
  | "pdf"
  | "audio"
  | "video"
  | "archive"

export interface CategoryMeta {
  label: string
  icon: string // Lucide component name
  accent: string // hex used for the icon tint
}

export const CATEGORIES: Record<Category, CategoryMeta> = {
  image: { label: "Image", icon: "Image", accent: "#b53836" },
  document: { label: "Document", icon: "FileText", accent: "#b53836" },
  pdf: { label: "PDF", icon: "FileType", accent: "#b53836" },
  audio: { label: "Audio", icon: "FileAudio", accent: "#b53836" },
  video: { label: "Video", icon: "FileVideo", accent: "#b53836" },
  archive: { label: "Archive", icon: "FileArchive", accent: "#b53836" },
}

export interface FormatMeta {
  category: Category
  name: string
  ext: string // canonical output extension (tar.gz keeps its compound ext)
  mime: string
}

export const FORMATS: Record<string, FormatMeta> = {
  // images
  png: { category: "image", name: "PNG image", ext: "png", mime: "image/png" },
  jpg: { category: "image", name: "JPG image", ext: "jpg", mime: "image/jpeg" },
  webp: { category: "image", name: "WebP image", ext: "webp", mime: "image/webp" },
  gif: { category: "image", name: "GIF image", ext: "gif", mime: "image/gif" },
  avif: { category: "image", name: "AVIF image", ext: "avif", mime: "image/avif" },
  tiff: { category: "image", name: "TIFF image", ext: "tiff", mime: "image/tiff" },
  svg: { category: "image", name: "SVG vector", ext: "svg", mime: "image/svg+xml" },
  bmp: { category: "image", name: "BMP image", ext: "bmp", mime: "image/bmp" },
  ico: { category: "image", name: "ICO icon", ext: "ico", mime: "image/x-icon" },
  heic: { category: "image", name: "HEIC image", ext: "heic", mime: "image/heic" },

  // documents
  docx: {
    category: "document",
    name: "Word document",
    ext: "docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  xlsx: {
    category: "document",
    name: "Excel workbook",
    ext: "xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  pptx: {
    category: "document",
    name: "PowerPoint presentation",
    ext: "pptx",
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  odt: {
    category: "document",
    name: "OpenDocument text",
    ext: "odt",
    mime: "application/vnd.oasis.opendocument.text",
  },
  rtf: { category: "document", name: "Rich text", ext: "rtf", mime: "application/rtf" },
  csv: { category: "document", name: "CSV spreadsheet", ext: "csv", mime: "text/csv" },
  json: { category: "document", name: "JSON data", ext: "json", mime: "application/json" },
  md: { category: "document", name: "Markdown", ext: "md", mime: "text/markdown" },
  txt: { category: "document", name: "Plain text", ext: "txt", mime: "text/plain" },
  html: { category: "document", name: "HTML page", ext: "html", mime: "text/html" },

  // pdf
  pdf: { category: "pdf", name: "PDF document", ext: "pdf", mime: "application/pdf" },

  // audio
  mp3: { category: "audio", name: "MP3 audio", ext: "mp3", mime: "audio/mpeg" },
  wav: { category: "audio", name: "WAV audio", ext: "wav", mime: "audio/wav" },
  ogg: { category: "audio", name: "OGG audio", ext: "ogg", mime: "audio/ogg" },
  flac: { category: "audio", name: "FLAC audio", ext: "flac", mime: "audio/flac" },
  m4a: { category: "audio", name: "M4A audio", ext: "m4a", mime: "audio/mp4" },
  aac: { category: "audio", name: "AAC audio", ext: "aac", mime: "audio/aac" },
  opus: { category: "audio", name: "Opus audio", ext: "opus", mime: "audio/opus" },
  wma: { category: "audio", name: "WMA audio", ext: "wma", mime: "audio/x-ms-wma" },

  // video
  mp4: { category: "video", name: "MP4 video", ext: "mp4", mime: "video/mp4" },
  webm: { category: "video", name: "WebM video", ext: "webm", mime: "video/webm" },
  mkv: { category: "video", name: "MKV video", ext: "mkv", mime: "video/x-matroska" },
  mov: { category: "video", name: "MOV video", ext: "mov", mime: "video/quicktime" },
  avi: { category: "video", name: "AVI video", ext: "avi", mime: "video/x-msvideo" },

  // archives
  zip: { category: "archive", name: "ZIP archive", ext: "zip", mime: "application/zip" },
  "tar.gz": { category: "archive", name: "TAR.GZ archive", ext: "tar.gz", mime: "application/gzip" },
  tar: { category: "archive", name: "TAR archive", ext: "tar", mime: "application/x-tar" },
  gz: { category: "archive", name: "GZIP file", ext: "gz", mime: "application/gzip" },
}

export const IMAGE_SOURCES = ["png", "jpg", "webp", "gif", "avif", "tiff", "svg", "bmp", "ico"]
export const IMAGE_TARGETS = ["png", "jpg", "webp", "gif", "avif", "tiff"]

export const DOC_SOURCES = ["docx", "xlsx", "csv", "json", "md", "txt", "html", "pptx", "odt", "rtf"]

export const AUDIO_SOURCES = ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus", "wma"]
export const AUDIO_TARGETS = ["mp3", "wav", "ogg", "flac", "m4a", "opus"]

export const VIDEO_SOURCES = ["mp4", "webm", "mkv", "mov", "avi"]
export const VIDEO_TARGETS = ["mp4", "webm", "gif"]

/** Video sources may extract audio into these targets (category bridging). */
export const VIDEO_TO_AUDIO_TARGETS = ["mp3", "m4a", "wav", "ogg"]

export const ARCHIVE_SOURCES = ["zip", "tar", "tar.gz", "gz"]
export const ARCHIVE_TARGETS = ["zip", "tar.gz", "tar"]

/** Office Open XML formats are zip containers — never let magic sniffing reclassify them. */
const ZIP_BASED_OFFICE = new Set(["docx", "xlsx", "pptx"])

export interface TargetGroup {
  category: Category
  label: string
  formats: string[]
}

/**
 * The matrix: source format -> grouped target formats.
 * Built programmatically from the source lists above.
 */
function buildMatrix(): Record<string, TargetGroup[]> {
  const m: Record<string, TargetGroup[]> = {}

  const groupsFor = (source: string): TargetGroup[] => {
    const groups: TargetGroup[] = []
    const cat = FORMATS[source]?.category
    if (cat === "image") {
      groups.push({ category: "image", label: "Image", formats: [...IMAGE_TARGETS] })
      // Special pair: png/jpg -> PDF via pdf-lib embed (spec §4 PDF section)
      if (source === "png" || source === "jpg") {
        groups.push({ category: "pdf", label: "PDF", formats: ["pdf"] })
      }
    } else if (cat === "document") {
      const docTargets: string[] = []
      if (source === "docx") docTargets.push("pdf", "html", "txt", "md")
      if (source === "xlsx") docTargets.push("pdf", "csv", "json")
      if (source === "csv") docTargets.push("xlsx", "json", "pdf")
      if (source === "json") docTargets.push("csv", "xlsx")
      if (source === "md") docTargets.push("pdf", "html", "docx")
      if (source === "txt") docTargets.push("pdf", "docx")
      if (source === "html") docTargets.push("pdf", "txt")
      if (source === "pptx" || source === "odt" || source === "rtf") docTargets.push("pdf")
      groups.push({ category: "document", label: "Document", formats: docTargets })
    } else if (cat === "pdf") {
      groups.push({ category: "pdf", label: "PDF", formats: ["png", "txt"] })
    } else if (cat === "audio") {
      groups.push({ category: "audio", label: "Audio", formats: [...AUDIO_TARGETS] })
    } else if (cat === "video") {
      groups.push({ category: "video", label: "Video", formats: [...VIDEO_TARGETS] })
      groups.push({ category: "audio", label: "Audio (extract)", formats: [...VIDEO_TO_AUDIO_TARGETS] })
    }
    // Archive repack/pack is available for every source (spec §4 archive)
    groups.push({ category: "archive", label: "Archive", formats: [...ARCHIVE_TARGETS] })
    return groups.filter((g) => g.formats.length > 0)
  }

  const allSources = [
    ...IMAGE_SOURCES,
    ...DOC_SOURCES,
    "pdf",
    ...AUDIO_SOURCES,
    ...VIDEO_SOURCES,
    ...ARCHIVE_SOURCES,
  ]
  for (const src of allSources) {
    if (!m[src]) m[src] = groupsFor(src)
  }
  return m
}

export const MATRIX = buildMatrix()

/** Known source formats (heic detected but explicitly unsupported). */
export const KNOWN_SOURCES = new Set([...Object.keys(MATRIX), "heic"])

/** Sensible default target per source (UI auto-suggestion). */
const SUGGESTED: Record<string, string> = {
  png: "jpg",
  jpg: "webp",
  webp: "png",
  gif: "mp4",
  avif: "png",
  tiff: "png",
  svg: "png",
  bmp: "png",
  ico: "png",
  heic: "",
  docx: "pdf",
  xlsx: "pdf",
  csv: "xlsx",
  json: "xlsx",
  md: "pdf",
  txt: "pdf",
  html: "pdf",
  pptx: "pdf",
  odt: "pdf",
  rtf: "pdf",
  pdf: "png",
  mp3: "wav",
  wav: "mp3",
  ogg: "mp3",
  flac: "mp3",
  m4a: "mp3",
  aac: "mp3",
  opus: "mp3",
  wma: "mp3",
  mp4: "webm",
  webm: "mp4",
  mkv: "mp4",
  mov: "mp4",
  avi: "mp4",
  zip: "tar.gz",
  "tar.gz": "zip",
  tar: "zip",
  gz: "zip",
}

export function isKnownSource(format: string): boolean {
  return KNOWN_SOURCES.has(format)
}

export function isSupportedSource(format: string): boolean {
  return Boolean(MATRIX[format]?.length)
}

export function getTargets(sourceFormat: string): TargetGroup[] {
  return MATRIX[sourceFormat] ?? []
}

export function isPairSupported(source: string, target: string): boolean {
  return getTargets(source).some((g) => g.formats.includes(target))
}

export function suggestTarget(source: string): string | null {
  const sug = SUGGESTED[source]
  if (sug && isPairSupported(source, sug)) return sug
  const first = getTargets(source)[0]
  return first ? first.formats[0] : null
}

/* ------------------------------------------------------------------ */
/* Settings schema (CloudConvert-style option fields, kept v1 minimal) */
/* ------------------------------------------------------------------ */

export interface SettingField {
  name: string
  label: string
  type: "integer" | "enum"
  default?: number | string
  enumValues?: Array<{ value: string; label: string }>
  min?: number
  max?: number
  unit?: string
  help?: string
}

const IMAGE_QUALITY: SettingField = {
  name: "quality",
  label: "Quality",
  type: "integer",
  default: 85,
  min: 1,
  max: 100,
  unit: "%",
  help: "Applies to JPG, WebP and AVIF output.",
}
const IMAGE_WIDTH: SettingField = {
  name: "width",
  label: "Width",
  type: "integer",
  min: 1,
  max: 20000,
  unit: "px",
  help: "Optional. Fit inside, never upscales.",
}
const IMAGE_HEIGHT: SettingField = {
  name: "height",
  label: "Height",
  type: "integer",
  min: 1,
  max: 20000,
  unit: "px",
  help: "Optional. Fit inside, never upscales.",
}
const AUDIO_BITRATE: SettingField = {
  name: "bitrate",
  label: "Audio bitrate",
  type: "enum",
  default: "192",
  enumValues: ["96", "128", "192", "256", "320"].map((v) => ({ value: v, label: `${v} kbps` })),
  help: "Applies to lossy outputs (MP3, M4A, OGG, Opus).",
}
const AUDIO_CHANNELS: SettingField = {
  name: "channels",
  label: "Channels",
  type: "enum",
  default: "auto",
  enumValues: [
    { value: "auto", label: "Keep original" },
    { value: "mono", label: "Mono" },
    { value: "stereo", label: "Stereo" },
  ],
}
const AUDIO_SAMPLE_RATE: SettingField = {
  name: "sample_rate",
  label: "Sample rate",
  type: "enum",
  default: "auto",
  enumValues: [
    { value: "auto", label: "Keep original" },
    { value: "44100", label: "44.1 kHz" },
    { value: "48000", label: "48 kHz" },
  ],
}
const VIDEO_RESOLUTION: SettingField = {
  name: "resolution",
  label: "Resolution",
  type: "enum",
  default: "original",
  enumValues: [
    { value: "original", label: "Original" },
    { value: "480", label: "480p" },
    { value: "720", label: "720p" },
    { value: "1080", label: "1080p" },
  ],
  help: "Scales to match height; width auto-computed.",
}
const VIDEO_FPS: SettingField = {
  name: "fps",
  label: "Frame rate",
  type: "enum",
  default: "original",
  enumValues: [
    { value: "original", label: "Original" },
    { value: "12", label: "12 fps" },
    { value: "24", label: "24 fps" },
    { value: "30", label: "30 fps" },
  ],
}
const GIF_FPS: SettingField = {
  name: "fps",
  label: "Frame rate",
  type: "enum",
  default: "12",
  enumValues: [
    { value: "12", label: "12 fps" },
    { value: "24", label: "24 fps" },
    { value: "30", label: "30 fps" },
  ],
}

/** Lossy audio targets that accept a bitrate. */
const LOSSY_AUDIO = new Set(["mp3", "m4a", "ogg", "opus"])
/** Image targets that accept a quality knob. */
const QUALITY_IMAGE = new Set(["jpg", "webp", "avif"])

export function getSettingsSchema(source: string, target: string): SettingField[] {
  const srcCat = FORMATS[source]?.category
  const tgtCat = FORMATS[target]?.category
  if (!srcCat || !tgtCat) return []

  // image -> image
  if (srcCat === "image" && tgtCat === "image") {
    const fields: SettingField[] = []
    if (QUALITY_IMAGE.has(target)) fields.push(IMAGE_QUALITY)
    fields.push(IMAGE_WIDTH, IMAGE_HEIGHT)
    return fields
  }
  // image -> pdf (pdf-lib embed): no settings v1
  if (srcCat === "image" && target === "pdf") return []

  // audio -> audio (or video -> audio)
  if (tgtCat === "audio" && (srcCat === "audio" || srcCat === "video")) {
    const fields: SettingField[] = []
    if (LOSSY_AUDIO.has(target)) fields.push(AUDIO_BITRATE)
    fields.push(AUDIO_CHANNELS, AUDIO_SAMPLE_RATE)
    return fields
  }

  // video -> video / gif
  if (srcCat === "video" && tgtCat === "video") {
    if (target === "gif") return [GIF_FPS]
    return [VIDEO_RESOLUTION, VIDEO_FPS]
  }

  // pdf / document / archive: 1:1, no settings in v1
  return []
}

/** Apply schema defaults + clamping to a raw settings object (server-side hardening). */
export function normalizeSettings(
  source: string,
  target: string,
  raw: Record<string, unknown> | undefined
): Record<string, string | number> {
  const schema = getSettingsSchema(source, target)
  const out: Record<string, string | number> = {}
  for (const field of schema) {
    const v = raw?.[field.name]
    if (field.type === "enum") {
      const allowed = field.enumValues?.map((e) => e.value) ?? []
      out[field.name] = typeof v === "string" && allowed.includes(v) ? v : (field.default as string)
    } else {
      const n =
        typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN
      if (Number.isFinite(n)) {
        const lo = field.min ?? n
        const hi = field.max ?? n
        out[field.name] = Math.min(Math.max(Math.round(n), lo), hi)
      } else if (typeof field.default === "number") {
        out[field.name] = field.default
      }
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Format detection: extension first, then fast magic-byte correction  */
/* ------------------------------------------------------------------ */

const EXT_ALIASES: Record<string, string> = {
  jpeg: "jpg",
  jpe: "jpg",
  tif: "tiff",
  htm: "html",
  markdown: "md",
  text: "txt",
  gzip: "gz",
}

/** Split "name.tar.gz" -> ext "tar.gz"; otherwise last segment. */
export function extensionOf(filename: string): string {
  const base = filename.toLowerCase().replace(/\\/g, "/").split("/").pop() ?? ""
  if (base.endsWith(".tar.gz")) return "tar.gz"
  const dot = base.lastIndexOf(".")
  if (dot <= 0) return ""
  return base.slice(dot + 1)
}

function formatFromExtension(filename: string): string | null {
  const ext = extensionOf(filename)
  if (!ext) return null
  const aliased = EXT_ALIASES[ext] ?? ext
  if (ZIP_BASED_OFFICE.has(aliased) || FORMATS[aliased]) return aliased
  return null
}

/** Magic-byte sniff for the formats that matter (pdf/png/jpg/zip/gz). */
export function sniffFormat(buf: Uint8Array): string | null {
  if (buf.length < 4) return null
  const b = buf
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf" // %PDF
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png"
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg"
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07))
    return "zip" // PK
  if (b[0] === 0x1f && b[1] === 0x8b) return "gz"
  return null
}

/**
 * Extension-based detection, corrected by magic bytes for pdf/png/jpg/zip/gz.
 * Zip-based office formats (docx/xlsx/pptx) and .tar.gz keep their extension.
 */
export function detectSourceFormat(filename: string, buffer?: Uint8Array): string | null {
  const extFormat = formatFromExtension(filename)
  if (buffer) {
    const sniffed = sniffFormat(buffer)
    if (sniffed) {
      if (!extFormat) return sniffed
      if (ZIP_BASED_OFFICE.has(extFormat)) return extFormat
      if (extFormat === "tar.gz") return extFormat // gzip magic expected
      if (extFormat !== sniffed) return sniffed // corrects mislabeled extensions
      return extFormat
    }
  }
  return extFormat
}

/** Friendly unsupported-source message (e.g. HEIC). */
export function unsupportedReason(format: string | null): string | null {
  if (!format) return "This file type could not be recognized."
  if (format === "heic") {
    return "HEIC photos are not supported in this environment. Export to JPG from your phone, then convert."
  }
  if (!isSupportedSource(format)) {
    return `${format.toUpperCase()} is not supported yet.`
  }
  return null
}

/** Wire format of a job as returned by the API routes (client-safe). */
export interface SerializedJob {
  id: string
  originalName: string
  sizeBytes: number
  sourceFormat: string
  targetFormat: string
  category: string
  status: string
  progress: number
  error: string | null
  outputName: string | null
  outputSizeBytes: number | null
  durationMs: number | null
  createdAt: string
  completedAt: string | null
}

/* ------------------------------------------------------------------ */
/* Limits + helpers                                                    */
/* ------------------------------------------------------------------ */

export const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024 // 100 MB per file
/** Unlimited batch size: uploads are chunked client-side to keep memory bounded. */
export const UPLOAD_CHUNK_FILES = 5
export const UPLOAD_CHUNK_BYTES = 64 * 1024 * 1024 // 64 MB per chunk
export const RETENTION_MS = 3 * 60 * 60 * 1000 // 3 hours

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—"
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

/** Sanitize a user filename: keep base name, strip path/unsafe chars. */
export function sanitizeBaseName(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "file"
  const noExt = base.replace(/\.[^.]*$/, "")
  const clean = noExt.replace(/[^a-zA-Z0-9._ -]+/g, "_").trim()
  return (clean || "file").slice(0, 120)
}

/** Output file name for a converted job. */
export function outputFileName(originalName: string, target: string): string {
  const meta = FORMATS[target]
  const ext = meta?.ext ?? target
  return `${sanitizeBaseName(originalName)}.${ext}`
}
