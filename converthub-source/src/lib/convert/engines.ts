/**
 * ConvertHub conversion engines — REAL conversions only.
 *
 * Wraps the engine-verified toolchain from Task 3-b:
 *   sharp | system ffmpeg/ffprobe | soffice headless | playwright-core PDF
 *   pdf-lib | pdftoppm/pdftotext (poppler) | mammoth | docx | SheetJS | marked
 *   adm-zip / archiver / system tar
 *
 * Every engine: never crashes the process, honors a hard timeout with child kill,
 * and reports friendly ConversionError messages.
 */

import { spawn } from "child_process"
import fs from "fs"
import fsp from "fs/promises"
import path from "path"
import os from "os"

import {
  sanitizeBaseName,
  outputFileName,
  FORMATS,
} from "./registry"

/* ------------------------------------------------------------------ */
/* Errors + constants                                                  */
/* ------------------------------------------------------------------ */

export class ConversionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConversionError"
  }
}

export const TIMEOUT_MS = {
  video: 120_000,
  soffice: 120_000,
  default: 60_000,
}

const FFMPEG = "/usr/bin/ffmpeg"
const FFPROBE = "/usr/bin/ffprobe"
const SOFFICE = "/usr/bin/soffice"
const PDFTOPPM = "/usr/bin/pdftoppm"
const PDFTOTEXT = "/usr/bin/pdftotext"
const TAR = "/usr/bin/tar"
const CHROMIUM_PATH =
  "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome"

export interface ConversionInput {
  jobId: string
  sourceFormat: string
  targetFormat: string
  inputPath: string
  outputDir: string
  outputName: string
  settings: Record<string, string | number>
  onProgress: (p: number) => void
}

/* ------------------------------------------------------------------ */
/* Child process helper with hard timeout + kill                       */
/* ------------------------------------------------------------------ */

interface ProcResult {
  code: number | null
  stdout: string
  stderr: string
}

function runProcess(
  cmd: string,
  args: string[],
  opts: {
    timeoutMs?: number
    label?: string
    onStdoutLine?: (line: string) => void
  } = {}
): Promise<ProcResult> {
  const label = opts.label ?? path.basename(cmd)
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS.default
  return new Promise<ProcResult>((resolve, reject) => {
    let stdout = ""
    let stderr = ""
    let stdoutBytes = 0
    let timedOut = false
    let settled = false

    let child
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] })
    } catch (err) {
      reject(new ConversionError(`${label} could not be started: ${(err as Error).message}`))
      return
    }

    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill("SIGTERM")
      } catch {
        /* noop */
      }
      setTimeout(() => {
        try {
          if (!child.killed) child.kill("SIGKILL")
        } catch {
          /* noop */
        }
      }, 4000).unref()
    }, timeoutMs)
    timer.unref()

    child.stdout!.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      if (stdoutBytes < 1_000_000) {
        stdoutBytes += chunk.length
        stdout += text
      }
      if (opts.onStdoutLine) {
        for (const line of text.split(/\r?\n|\r/)) {
          if (line) opts.onStdoutLine(line)
        }
      }
    })
    child.stderr!.on("data", (chunk: Buffer) => {
      if (stderr.length < 100_000) stderr += chunk.toString()
    })

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err.code === "ENOENT") {
        reject(new ConversionError(`${label} is not installed on the server.`))
      } else {
        reject(new ConversionError(`${label} failed to start: ${err.message}`))
      }
    })

    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (timedOut) {
        reject(
          new ConversionError(
            `${label} timed out after ${Math.round(timeoutMs / 1000)}s and was stopped.`
          )
        )
      } else {
        resolve({ code, stdout, stderr })
      }
    })
  })
}

/* ------------------------------------------------------------------ */
/* IMAGE — sharp                                                       */
/* ------------------------------------------------------------------ */

async function convertImage(inp: ConversionInput): Promise<void> {
  if (inp.sourceFormat === "heic") {
    throw new ConversionError(
      "HEIC photos are not supported in this environment. Export to JPG from your phone, then convert."
    )
  }
  const sharpMod = await import("sharp")
  const sharp = (sharpMod as unknown as { default: typeof sharpMod }).default ?? sharpMod

  const outPath = path.join(inp.outputDir, inp.outputName)
  try {
    // svg needs density for crisp rasterization (spec §9)
    const srcOpts = inp.sourceFormat === "svg" ? { density: 150 } : undefined
    let pipeline = sharp(inp.inputPath, srcOpts)
      // auto-orient from EXIF (no-op for non-jpeg)
      .rotate()
      .withMetadata()

    const width = typeof inp.settings.width === "number" ? inp.settings.width : undefined
    const height = typeof inp.settings.height === "number" ? inp.settings.height : undefined
    if (width || height) {
      pipeline = pipeline.resize({
        width: width || undefined,
        height: height || undefined,
        fit: "inside",
        withoutEnlargement: true, // never upscale (spec §4)
      })
    }

    const quality = typeof inp.settings.quality === "number" ? inp.settings.quality : 85
    switch (inp.targetFormat) {
      case "png":
        pipeline = pipeline.png()
        break
      case "jpg":
        // flatten alpha onto white so transparent PNGs convert cleanly
        pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({ quality })
        break
      case "webp":
        pipeline = pipeline.webp({ quality })
        break
      case "avif":
        pipeline = pipeline.avif({ quality })
        break
      case "gif":
        pipeline = pipeline.gif()
        break
      case "tiff":
        pipeline = pipeline.tiff()
        break
      default:
        throw new ConversionError(`Unsupported image target: ${inp.targetFormat}`)
    }
    await pipeline.toFile(outPath)
  } catch (err) {
    const msg = (err as Error).message ?? ""
    if (/heif|heic/i.test(msg)) {
      throw new ConversionError(
        "HEIC photos are not supported in this environment. Export to JPG from your phone, then convert."
      )
    }
    if (/Input file has corrupt header|premature end|VipsJpeg|corrupt/i.test(msg)) {
      throw new ConversionError("This image file appears to be corrupt or not a real image.")
    }
    throw new ConversionError(`Image conversion failed: ${msg}`)
  }
}

/* ------------------------------------------------------------------ */
/* AUDIO / VIDEO — system ffmpeg (+ ffprobe for progress)              */
/* ------------------------------------------------------------------ */

async function probeDurationSeconds(inputPath: string): Promise<number | null> {
  try {
    const res = await runProcess(
      FFPROBE,
      ["-v", "error", "-show_entries", "format=duration", "-of", "json", inputPath],
      { timeoutMs: 30_000, label: "ffprobe" }
    )
    if (res.code !== 0) return null
    const parsed = JSON.parse(res.stdout) as { format?: { duration?: string } }
    const d = parsed.format?.duration ? Number(parsed.format.duration) : NaN
    return Number.isFinite(d) && d > 0 ? d : null
  } catch {
    return null
  }
}

function audioCodecArgs(target: string, settings: Record<string, string | number>): string[] {
  const bitrate = typeof settings.bitrate === "string" ? settings.bitrate : "192"
  switch (target) {
    case "mp3":
      return ["-c:a", "libmp3lame", "-b:a", `${bitrate}k`]
    case "ogg":
      return ["-c:a", "libvorbis", "-b:a", `${bitrate}k`]
    case "m4a":
      return ["-c:a", "aac", "-b:a", `${bitrate}k`]
    case "aac":
      return ["-c:a", "aac", "-b:a", `${bitrate}k`]
    case "opus":
      return ["-c:a", "libopus", "-b:a", `${bitrate}k`]
    case "flac":
      return ["-c:a", "flac"]
    case "wav":
      return ["-c:a", "pcm_s16le"]
    default:
      throw new ConversionError(`Unsupported audio target: ${target}`)
  }
}

async function convertFfmpeg(inp: ConversionInput): Promise<void> {
  const srcCat = FORMATS[inp.sourceFormat]?.category
  const tgtCat = FORMATS[inp.targetFormat]?.category
  const isVideoToVideo = srcCat === "video" && tgtCat === "video"
  const isVideoToGif = srcCat === "video" && inp.targetFormat === "gif"
  const isAudioOut = tgtCat === "audio"
  const timeout = isVideoToVideo || isVideoToGif ? TIMEOUT_MS.video : TIMEOUT_MS.default

  const outPath = path.join(inp.outputDir, inp.outputName)
  const args: string[] = ["-y", "-nostdin", "-i", inp.inputPath] // -y -nostdin always (spec §9)

  const filters: string[] = []

  if (isVideoToGif) {
    // fps + 480px wide + palettegen/paletteuse for quality (spec §4)
    const fps = typeof inp.settings.fps === "string" ? inp.settings.fps : "12"
    filters.push(
      `fps=${fps}`,
      "scale=480:-2:flags=lanczos",
      "split[a][b];[a]palettegen[p];[b][p]paletteuse"
    )
  } else if (isVideoToVideo) {
    if (typeof inp.settings.fps === "string" && inp.settings.fps !== "original") {
      filters.push(`fps=${inp.settings.fps}`)
    }
    if (typeof inp.settings.resolution === "string" && inp.settings.resolution !== "original") {
      filters.push(`scale=-2:${inp.settings.resolution}`)
    }
    if (inp.targetFormat === "mp4") {
      args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart")
    } else if (inp.targetFormat === "webm") {
      args.push("-c:v", "libvpx-vp9", "-crf", "40", "-b:v", "0", "-c:a", "libopus")
    } else {
      throw new ConversionError(`Unsupported video target: ${inp.targetFormat}`)
    }
  } else if (isAudioOut) {
    // audio->audio or video->audio extraction
    args.push("-vn")
    args.push(...audioCodecArgs(inp.targetFormat, inp.settings))
    if (typeof inp.settings.channels === "string" && inp.settings.channels !== "auto") {
      args.push("-ac", inp.settings.channels === "mono" ? "1" : "2")
    }
    if (typeof inp.settings.sample_rate === "string" && inp.settings.sample_rate !== "auto") {
      args.push("-ar", inp.settings.sample_rate)
    }
  } else {
    throw new ConversionError(
      `${inp.sourceFormat} -> ${inp.targetFormat} is not a supported media conversion.`
    )
  }

  if (filters.length > 0) args.push("-vf", filters.join(","))
  args.push("-progress", "pipe:1", "-nostats", outPath)

  const duration = await probeDurationSeconds(inp.inputPath)
  let lastReported = 0

  const res = await runProcess(FFMPEG, args, {
    timeoutMs: timeout,
    label: "ffmpeg",
    onStdoutLine: (line) => {
      // -progress pipe:1 emits key=value lines; out_time_ms is in microseconds
      if (!line.startsWith("out_time_ms=")) return
      const raw = Number(line.slice("out_time_ms=".length))
      if (!Number.isFinite(raw) || !duration) return
      const seconds = raw / 1_000_000
      const pct = Math.max(5, Math.min(95, Math.round((seconds / duration) * 90) + 5))
      if (pct > lastReported) {
        lastReported = pct
        inp.onProgress(pct)
      }
    },
  })

  if (res.code !== 0 || !fs.existsSync(outPath)) {
    const tail = res.stderr.trim().split("\n").slice(-2).join(" | ").slice(0, 400)
    throw new ConversionError(
      `ffmpeg could not convert ${inp.sourceFormat} to ${inp.targetFormat}.${tail ? ` (${tail})` : ""}`
    )
  }
}

/* ------------------------------------------------------------------ */
/* DOCUMENT -> PDF — soffice headless (per-job profile, spec §9)       */
/* ------------------------------------------------------------------ */

async function convertSofficeToPdf(inp: ConversionInput): Promise<void> {
  const outPath = path.join(inp.outputDir, inp.outputName)
  const profile = path.join(os.tmpdir(), `converthub-lo-${inp.jobId}`)
  const expected = path.join(
    inp.outputDir,
    `${sanitizeBaseName(path.basename(inp.inputPath).replace(/\.[^.]*$/, ""))}.pdf`
  )
  try {
    const res = await runProcess(
      SOFFICE,
      [
        `-env:UserInstallation=file://${profile}`, // UNIQUE profile per job (spec §9)
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        inp.outputDir,
        inp.inputPath,
      ],
      { timeoutMs: TIMEOUT_MS.soffice, label: "LibreOffice" }
    )
    const produced = fs.existsSync(expected) ? expected : null
    if (res.code !== 0 || !produced) {
      throw new ConversionError(
        `LibreOffice could not convert ${inp.sourceFormat.toUpperCase()} to PDF. The document may be damaged or password-protected.`
      )
    }
    await fsp.rename(produced, outPath)
  } finally {
    await fsp.rm(profile, { recursive: true, force: true }).catch(() => {})
  }
}

/* ------------------------------------------------------------------ */
/* HTML -> PDF — playwright-core (chromium, spec §9)                   */
/* ------------------------------------------------------------------ */

const DOC_PDF_STYLE = `
  <style>
    @page { margin: 0; }
    body {
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #18181b; background: #ffffff;
      padding: 48px 56px; line-height: 1.6; font-size: 14px;
    }
    pre { white-space: pre-wrap; word-wrap: break-word; font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #d4d4d8; padding: 6px 10px; text-align: left; font-size: 12.5px; }
    th { background: #f4f4f5; }
    h1, h2, h3 { line-height: 1.3; }
    code { background: #f4f4f5; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
    blockquote { border-left: 3px solid #b53836; margin-left: 0; padding-left: 14px; color: #52525b; }
    img { max-width: 100%; }
  </style>`

type PdfMarginOpts = {
  /** CSS margin strings; defaults to 0 (DOC_PDF_STYLE's body padding supplies the margins) */
  margins?: { top: string; bottom: string; left: string; right: string }
}

export async function renderHtmlToPdf(html: string, outPath: string, opts?: PdfMarginOpts): Promise<void> {
  let browser
  try {
    const pw = await import("playwright-core")
    const chromium = (pw as unknown as { chromium: typeof pw.chromium }).chromium
    browser = await chromium.launch({
      executablePath: CHROMIUM_PATH, // explicit executablePath (spec §3)
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    })
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: "networkidle", timeout: 20_000 }).catch(() => {
      // networkidle can hang on odd pages; proceed with whatever is loaded
    })
    // CloudConvert-parity fidelity: wait for web fonts + every image before printing
    await page
      .evaluate(() =>
        Promise.all([
          document.fonts?.ready.catch(() => undefined),
          ...Array.from(document.images).map((img) =>
            img.complete
              ? Promise.resolve()
              : new Promise<void>((res) => {
                  img.onload = () => res()
                  img.onerror = () => res()
                }),
          ),
        ]),
      )
      .catch(() => {
        // never block the conversion on flaky resources
      })
    const buf = await page.pdf({
      format: "A4",
      printBackground: true, // backgrounds + colors (spec §9)
      margin: opts?.margins ?? { top: "0", bottom: "0", left: "0", right: "0" },
    })
    await fsp.writeFile(outPath, buf)
    await page.close()
  } catch (err) {
    throw new ConversionError(`PDF rendering failed: ${(err as Error).message}`)
  } finally {
    if (browser) await browser.close().catch(() => {}) // one browser per job, always closed
  }
}

/** Minimal style for UNSTYLED html fragments (full docs keep their own CSS). */
const FRAG_PDF_STYLE = `
  <style>
    body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #18181b; background: #ffffff; line-height: 1.6; font-size: 14px; }
    pre { white-space: pre-wrap; word-wrap: break-word; font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; }
    table { border-collapse: collapse; }
    td, th { border: 1px solid #d4d4d8; padding: 6px 10px; }
  </style>`

/*
 * Print hardening for styled HTML documents (injected last so it wins cascade
 * ties with the document's own @media print rules).
 *
 * Why: templates generated by review-page builders ship aggressive fragmentation
 * rules — `break-inside: avoid` on page-tall boxes and `break-after: avoid` on
 * hero images. In Chromium print this produces PAGE-SIZED HOLES: when a glued
 * group (hero + next card) or an oversized box doesn't fit the remaining space,
 * the whole group is pushed to the next page and 40-60% of the current page is
 * left blank. Allowing big containers to split and un-gluing hero images keeps
 * pages full (CloudConvert behaves the same way) while small cards stay intact.
 */
const PRINT_HARDENING_STYLE = `
  <style>
    @media print {
      /* un-glue hero images from whatever follows them */
      .hero-img, [class*="hero-image"], [class*="hero-img"] {
        break-after: auto !important;
        page-break-after: auto !important;
        max-height: 320px !important;
      }
      /* oversized containers: split instead of leaving page-sized holes */
      .offer-box, .testimonial-box, .toc-box, .references-box,
      .content-box, .verdict-box, .criteria-grid, [class*="offer-box"],
      [class*="testimonial"] {
        break-inside: auto !important;
        page-break-inside: auto !important;
      }
      /* small units stay intact */
      .faq-card, .author-box, .quick-verdict-box, .pros-cons-box,
      .data-table-wrap, .meta-pills, .section-header, tr {
        break-inside: avoid !important;
        page-break-inside: avoid !important;
      }
      h1, h2, h3, .section-header, .section-title {
        break-after: avoid !important;
        page-break-after: avoid !important;
      }
    }
  </style>`

/** Append the hardening style just before </body> so it loads after every author style. */
function injectPrintHardening(doc: string): string {
  return /<\/body>/i.test(doc)
    ? doc.replace(/<\/body>/i, `${PRINT_HARDENING_STYLE}</body>`)
    : doc + PRINT_HARDENING_STYLE
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

async function convertHtmlToPdf(inp: ConversionInput): Promise<void> {
  const raw = await fsp.readFile(inp.inputPath, "utf8")
  let body: string
  if (inp.sourceFormat === "md") {
    const { marked } = await import("marked")
    body = await marked.parse(raw) // marked v18: await marked.parse (spec §9)
  } else if (inp.sourceFormat === "txt") {
    body = `<pre>${escapeHtml(raw)}</pre>`
  } else {
    // html: the document carries its own styles — render it as-is with two
    // additions on top: page margins (user-facing: content must not touch the
    // paper edge) and PRINT_HARDENING_STYLE to stop page-sized fragmentation
    // holes. DOC_PDF_STYLE is deliberately NOT injected here: its @page{margin:0}
    // would defeat the pdf() margins and its body padding would double-inset
    // already-styled layouts.
    const isFullDoc = /<html[\s>]|<head[\s>]|<body[\s>]/i.test(raw)
    const base = isFullDoc
      ? /^\s*<!doctype/i.test(raw)
        ? raw
        : `<!doctype html>${raw}`
      : `<!doctype html><html><head><meta charset="utf-8">${FRAG_PDF_STYLE}</head><body>${raw}</body></html>`
    const out = injectPrintHardening(base)
    await renderHtmlToPdf(out, path.join(inp.outputDir, inp.outputName), {
      margins: { top: "12mm", bottom: "10mm", left: "15.5mm", right: "15.5mm" },
    })
    return
  }
  const html = `<!doctype html><html><head><meta charset="utf-8">${DOC_PDF_STYLE}</head><body>${body}</body></html>`
  await renderHtmlToPdf(html, path.join(inp.outputDir, inp.outputName))
}

/** csv -> pdf via SheetJS parse + simple HTML table (spec §4 "simplest reliable"). */
async function convertCsvToPdf(inp: ConversionInput): Promise<void> {
  const XLSX = await loadXlsx()
  const csv = await fsp.readFile(inp.inputPath, "utf8")
  const wb = XLSX.read(csv, { type: "string" })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false })
  if (rows.length === 0) throw new ConversionError("The CSV file is empty.")
  const maxCols = Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 0)))
  const trs = rows
    .map((row, i) => {
      const cells = Array.from({ length: maxCols }, (_, c) => {
        const v = Array.isArray(row) ? row[c] : ""
        return `<td>${escapeHtml(v === null || v === undefined ? "" : String(v))}</td>`
      }).join("")
      return i === 0 ? `<thead><tr>${cells}</tr></thead>` : `<tr>${cells}</tr>`
    })
    .join("\n")
  const html = `<!doctype html><html><head><meta charset="utf-8">${DOC_PDF_STYLE}</head><body><table>${trs}</table></body></html>`
  await renderHtmlToPdf(html, path.join(inp.outputDir, inp.outputName))
}

/* ------------------------------------------------------------------ */
/* PNG/JPG -> PDF — pdf-lib (A4 fit, spec §4)                          */
/* ------------------------------------------------------------------ */

async function convertImageToPdf(inp: ConversionInput): Promise<void> {
  const { PDFDocument } = await import("pdf-lib")
  const buf = await fsp.readFile(inp.inputPath)
  const pdf = await PDFDocument.create()
  let image
  try {
    image =
      inp.sourceFormat === "png"
        ? await pdf.embedPng(buf)
        : await pdf.embedJpg(buf)
  } catch {
    throw new ConversionError(
      `Could not embed this ${inp.sourceFormat.toUpperCase()} file into a PDF — the image may be corrupt.`
    )
  }
  // A4 portrait, 24pt margins, centered fit
  const page = pdf.addPage([595.28, 841.89])
  const margin = 24
  const maxW = page.getWidth() - margin * 2
  const maxH = page.getHeight() - margin * 2
  const scale = Math.min(maxW / image.width, maxH / image.height, 1)
  const w = image.width * scale
  const h = image.height * scale
  page.drawImage(image, {
    x: (page.getWidth() - w) / 2,
    y: (page.getHeight() - h) / 2,
    width: w,
    height: h,
  })
  const bytes = await pdf.save()
  await fsp.writeFile(path.join(inp.outputDir, inp.outputName), bytes)
}

/* ------------------------------------------------------------------ */
/* PDF -> PNG / TXT — poppler (pdftoppm / pdftotext)                   */
/* ------------------------------------------------------------------ */

async function convertPdfToPng(inp: ConversionInput): Promise<void> {
  // First page only, 150 DPI (spec §4)
  const prefix = path.join(inp.outputDir, `pp-${inp.jobId}`)
  const res = await runProcess(
    PDFTOPPM,
    ["-png", "-r", "150", "-f", "1", "-l", "1", inp.inputPath, prefix],
    { timeoutMs: TIMEOUT_MS.default, label: "pdftoppm" }
  )
  const produced = (await fsp.readdir(inp.outputDir)).filter(
    (f) => f.startsWith(`pp-${inp.jobId}`) && f.endsWith(".png")
  )
  const outPath = path.join(inp.outputDir, inp.outputName)
  if (res.code !== 0 || produced.length === 0) {
    throw new ConversionError(
      "Could not render this PDF to an image — it may be encrypted or damaged."
    )
  }
  await fsp.rename(path.join(inp.outputDir, produced[0]), outPath)
  // remove extra rendered pages (pdftoppm may emit -01 / -1 naming)
  for (const extra of produced.slice(1)) {
    await fsp.rm(path.join(inp.outputDir, extra), { force: true }).catch(() => {})
  }
}

async function convertPdfToTxt(inp: ConversionInput): Promise<void> {
  const outPath = path.join(inp.outputDir, inp.outputName)
  try {
    const res = await runProcess(PDFTOTEXT, [inp.inputPath, outPath], {
      timeoutMs: TIMEOUT_MS.default,
      label: "pdftotext",
    })
    if (res.code === 0 && fs.existsSync(outPath)) return
    if (res.code !== 0 && !fs.existsSync(outPath)) throw new Error(res.stderr.slice(0, 200))
  } catch (err) {
    // ENOENT => binary missing: fall back to pdfjs-dist (spec §9)
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await pdfjsExtractText(inp.inputPath, outPath)
      return
    }
    if (err instanceof ConversionError) throw err
    throw new ConversionError(
      "Could not extract text from this PDF — it may be encrypted or scanned (image-only)."
    )
  }
}

async function pdfjsExtractText(inputPath: string, outPath: string): Promise<void> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
    const data = new Uint8Array(await fsp.readFile(inputPath))
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
    let text = ""
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      text += content.items.map((item) => ("str" in item ? item.str : "")).join(" ") + "\n\n"
      page.cleanup()
    }
    await fsp.writeFile(outPath, text)
  } catch (err) {
    throw new ConversionError(
      `Could not extract text from this PDF: ${(err as Error).message.slice(0, 200)}`
    )
  }
}

/* ------------------------------------------------------------------ */
/* DOCX — mammoth (html / txt / md)                                    */
/* ------------------------------------------------------------------ */

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
}

/** Minimal server-side tag stripper for html -> txt (spec §4). */
function htmlToText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
  s = s.replace(/<br\s*\/?>/gi, "\n")
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote)>/gi, "\n")
  s = s.replace(/<[^>]+>/g, "")
  s = decodeEntities(s)
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  return s
}

/** mammoth HTML -> simple markdown (spec §4 "html->md simple strip"). */
function htmlToMarkdown(html: string): string {
  let s = html
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, t) => `\n\n# ${strip(t)}\n\n`)
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, t) => `\n\n## ${strip(t)}\n\n`)
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, t) => `\n\n### ${strip(t)}\n\n`)
  s = s.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, (_m, t) => `\n\n#### ${strip(t)}\n\n`)
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `**${inner}**`)
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `*${inner}*`)
  s = s.replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => `[${text}](${href})`)
  s = s.replace(/<li[^>]*>/gi, "\n- ")
  s = s.replace(/<\/li>/gi, "")
  s = s.replace(/<br\s*\/?>/gi, "\n")
  s = s.replace(/<\/(p|div|h[1-6]|blockquote)>/gi, "\n\n")
  s = s.replace(/<[^>]+>/g, "")
  s = decodeEntities(s)
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  return `${s}\n`

  function strip(x: string): string {
    return x.replace(/<[^>]+>/g, "").trim()
  }
}

async function loadMammoth() {
  const mod = await import("mammoth")
  return ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod
}

async function convertDocx(inp: ConversionInput): Promise<void> {
  const mammoth = await loadMammoth()
  const buffer = await fsp.readFile(inp.inputPath)
  const outPath = path.join(inp.outputDir, inp.outputName)
  try {
    if (inp.targetFormat === "html") {
      const { value } = await mammoth.convertToHtml({ buffer })
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Document</title>${DOC_PDF_STYLE}</head><body>${value}</body></html>`
      await fsp.writeFile(outPath, html)
    } else if (inp.targetFormat === "txt") {
      const { value } = await mammoth.extractRawText({ buffer })
      await fsp.writeFile(outPath, value)
    } else if (inp.targetFormat === "md") {
      const { value } = await mammoth.convertToHtml({ buffer })
      await fsp.writeFile(outPath, htmlToMarkdown(value))
    } else {
      throw new ConversionError(`Unsupported docx target: ${inp.targetFormat}`)
    }
  } catch (err) {
    if (err instanceof ConversionError) throw err
    throw new ConversionError(
      "Could not read this Word document — it may be corrupt or password-protected."
    )
  }
}

/* ------------------------------------------------------------------ */
/* DOCX creation — docx lib (md->docx, txt->docx)                      */
/* ------------------------------------------------------------------ */

async function convertToDocx(inp: ConversionInput): Promise<void> {
  const docxMod = await import("docx")
  const { Document, Paragraph, TextRun, Packer, HeadingLevel } = docxMod as unknown as typeof docxMod
  const raw = await fsp.readFile(inp.inputPath, "utf8")
  const paragraphs: InstanceType<typeof Paragraph>[] = []

  const lines = raw.split(/\r?\n/)
  for (const line of lines) {
    const text = line.trimEnd()
    if (inp.sourceFormat === "md") {
      const heading = text.match(/^(#{1,6})\s+(.*)$/)
      if (heading) {
        const level = heading[1].length
        paragraphs.push(new Paragraph({ text: heading[2], heading: HeadingLevel[`HEADING_${Math.min(level, 4)}` as keyof typeof HeadingLevel] as never }))
        continue
      }
      if (/^[-*+]\s+/.test(text)) {
        paragraphs.push(new Paragraph({ text: text.replace(/^[-*+]\s+/, ""), bullet: { level: 0 } }))
        continue
      }
      if (/^\d+\.\s+/.test(text)) {
        paragraphs.push(new Paragraph({ text: text.replace(/^\d+\.\s+/, ""), bullet: { level: 0 } }))
        continue
      }
      if (text.trim() === "") {
        paragraphs.push(new Paragraph({ text: "" }))
        continue
      }
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: text.replace(/\*\*([^*]+)\*\*/g, "$1") })],
        })
      )
    } else {
      paragraphs.push(new Paragraph({ text }))
    }
  }

  const doc = new Document({ sections: [{ children: paragraphs }] })
  const buf = await Packer.toBuffer(doc)
  await fsp.writeFile(path.join(inp.outputDir, inp.outputName), Buffer.from(buf))
}

/* ------------------------------------------------------------------ */
/* Spreadsheets / data — SheetJS (xlsx .default fallback, spec §9)     */
/* ------------------------------------------------------------------ */

async function loadXlsx(): Promise<typeof import("xlsx")> {
  const mod = await import("xlsx")
  // ESM/CJS interop: xlsx may land on .default (spec §9)
  const modAny = mod as unknown as { default?: typeof mod }
  return (modAny.default ?? mod) as typeof mod
}

function writeXlsxBuffer(xlsx: typeof import("xlsx"), sheets: { name: string; aoa: unknown[][] }[]): Buffer {
  const wb = xlsx.utils.book_new()
  for (const s of sheets) {
    const ws = xlsx.utils.aoa_to_sheet(s.aoa)
    xlsx.utils.book_append_sheet(wb, ws, s.name)
  }
  const out = xlsx.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer
  return Buffer.from(out)
}

/** JSON -> array-of-objects validation (spec: "array-of-objects only, else clear error"). */
function jsonToRecords(jsonText: string): Record<string, unknown>[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new ConversionError("Invalid JSON file — could not parse it.")
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || typeof parsed[0] !== "object" || parsed[0] === null || Array.isArray(parsed[0])) {
    throw new ConversionError(
      "JSON must be an array of objects (e.g. [{\"name\":\"Ada\"}, …]) to convert to CSV/XLSX."
    )
  }
  return parsed as Record<string, unknown>[]
}

async function convertSheetData(inp: ConversionInput): Promise<void> {
  const XLSX = await loadXlsx()
  const outPath = path.join(inp.outputDir, inp.outputName)

  // --- xlsx source ---
  if (inp.sourceFormat === "xlsx") {
    const wb = XLSX.read(await fsp.readFile(inp.inputPath), { type: "buffer" })
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (!ws) throw new ConversionError("The workbook has no sheets.")
    if (inp.targetFormat === "csv") {
      await fsp.writeFile(outPath, XLSX.utils.sheet_to_csv(ws))
      return
    }
    if (inp.targetFormat === "json") {
      const records = XLSX.utils.sheet_to_json(ws)
      await fsp.writeFile(outPath, JSON.stringify(records, null, 2))
      return
    }
  }

  // --- csv source ---
  if (inp.sourceFormat === "csv") {
    const csv = await fsp.readFile(inp.inputPath, "utf8")
    const wb = XLSX.read(csv, { type: "string" })
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (inp.targetFormat === "xlsx") {
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false })
      await fsp.writeFile(outPath, writeXlsxBuffer(XLSX, [{ name: "Sheet1", aoa }]))
      return
    }
    if (inp.targetFormat === "json") {
      const records = XLSX.utils.sheet_to_json(ws)
      await fsp.writeFile(outPath, JSON.stringify(records, null, 2))
      return
    }
  }

  // --- json source ---
  if (inp.sourceFormat === "json") {
    const records = jsonToRecords(await fsp.readFile(inp.inputPath, "utf8"))
    const ws = XLSX.utils.json_to_sheet(records)
    if (inp.targetFormat === "csv") {
      await fsp.writeFile(outPath, XLSX.utils.sheet_to_csv(ws))
      return
    }
    if (inp.targetFormat === "xlsx") {
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false })
      await fsp.writeFile(outPath, writeXlsxBuffer(XLSX, [{ name: "Sheet1", aoa }]))
      return
    }
  }

  throw new ConversionError(`${inp.sourceFormat} -> ${inp.targetFormat} is not supported.`)
}

/* ------------------------------------------------------------------ */
/* md -> html, html/txt passthrough helpers                            */
/* ------------------------------------------------------------------ */

async function convertMdToHtml(inp: ConversionInput): Promise<void> {
  const { marked } = await import("marked")
  const md = await fsp.readFile(inp.inputPath, "utf8")
  const body = await marked.parse(md)
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Document</title>${DOC_PDF_STYLE}</head><body>${body}</body></html>`
  await fsp.writeFile(path.join(inp.outputDir, inp.outputName), html)
}

async function convertHtmlToTxt(inp: ConversionInput): Promise<void> {
  const html = await fsp.readFile(inp.inputPath, "utf8")
  await fsp.writeFile(path.join(inp.outputDir, inp.outputName), htmlToText(html))
}

/* ------------------------------------------------------------------ */
/* ARCHIVES — adm-zip / system tar (encrypted zip friendly error)      */
/* ------------------------------------------------------------------ */

async function stageSourceForArchive(
  inp: ConversionInput,
  stageDir: string
): Promise<void> {
  const src = inp.sourceFormat
  if (src === "zip") {
    try {
      const AdmZipMod = await import("adm-zip")
      const AdmZip = (AdmZipMod as unknown as { default: new (d?: Buffer) => import("adm-zip") }).default
      const zip = new AdmZip(await fsp.readFile(inp.inputPath))
      // touching entries throws on encrypted zips
      for (const entry of zip.getEntries()) {
        if (entry.isEncrypted || entry.isPasswordProtected) {
          throw new ConversionError("password-protected archives not supported")
        }
      }
      zip.extractAllTo(stageDir, true)
      return
    } catch (err) {
      if (err instanceof ConversionError) throw err
      const msg = (err as Error).message ?? ""
      if (/encrypt|password/i.test(msg)) {
        throw new ConversionError("password-protected archives not supported")
      }
      throw new ConversionError("This ZIP archive is corrupt or cannot be read.")
    }
  }
  if (src === "tar" || src === "tar.gz") {
    const res = await runProcess(
      TAR,
      [src === "tar" ? "-xf" : "-xzf", inp.inputPath, "-C", stageDir],
      { timeoutMs: TIMEOUT_MS.default, label: "tar" }
    )
    if (res.code !== 0) {
      throw new ConversionError(
        `Could not extract this ${src.toUpperCase()} archive — it may be corrupt.`
      )
    }
    return
  }
  if (src === "gz") {
    // single-file gzip -> decompress into stage
    const { gunzipSync } = await import("zlib")
    const base = path.basename(inp.inputPath).replace(/\.gz$/i, "") || "file"
    try {
      const buf = gunzipSync(await fsp.readFile(inp.inputPath))
      await fsp.writeFile(path.join(stageDir, sanitizeBaseName(base)), buf)
    } catch {
      throw new ConversionError("This GZIP file is corrupt or cannot be decompressed.")
    }
    return
  }
  // regular file: copy as-is
  await fsp.copyFile(inp.inputPath, path.join(stageDir, sanitizeBaseName(path.basename(inp.inputPath))))
}

async function listStageFiles(dir: string): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) files.push(...(await listStageFiles(full)))
    else if (e.isFile()) files.push(full)
  }
  return files
}

async function packArchive(inp: ConversionInput, stageDir: string): Promise<void> {
  const outPath = path.join(inp.outputDir, inp.outputName)
  if (inp.targetFormat === "zip") {
    const AdmZipMod = await import("adm-zip")
    const AdmZip = (AdmZipMod as unknown as { default: new () => import("adm-zip") }).default
    const zip = new AdmZip()
    const files = await listStageFiles(stageDir)
    if (files.length === 0) throw new ConversionError("Nothing to archive — the source was empty.")
    for (const f of files) {
      const rel = path.relative(stageDir, f)
      zip.addLocalFile(f, path.dirname(rel) === "." ? "" : path.dirname(rel))
    }
    zip.writeZip(outPath)
    return
  }
  // tar / tar.gz via system tar from the stage dir
  const flag = inp.targetFormat === "tar.gz" ? "-czf" : "-cf"
  const res = await runProcess(TAR, [flag, outPath, "-C", stageDir, "."], {
    timeoutMs: TIMEOUT_MS.default,
    label: "tar",
  })
  if (res.code !== 0 || !fs.existsSync(outPath)) {
    throw new ConversionError(`Could not create the ${inp.targetFormat} archive.`)
  }
}

async function convertArchive(inp: ConversionInput): Promise<void> {
  const stageDir = path.join(os.tmpdir(), `converthub-arch-${inp.jobId}`)
  await fsp.mkdir(stageDir, { recursive: true })
  try {
    await stageSourceForArchive(inp, stageDir)
    await packArchive(inp, stageDir)
  } finally {
    await fsp.rm(stageDir, { recursive: true, force: true }).catch(() => {})
  }
}

/* ------------------------------------------------------------------ */
/* Dispatcher                                                          */
/* ------------------------------------------------------------------ */

const SOFFICE_SOURCES = new Set(["docx", "xlsx", "pptx", "odt", "rtf"])

export async function runConversion(inp: ConversionInput): Promise<void> {
  const { sourceFormat: src, targetFormat: tgt } = inp

  // image -> image
  if (FORMATS[src]?.category === "image" && FORMATS[tgt]?.category === "image") {
    return convertImage(inp)
  }
  // png/jpg -> pdf
  if ((src === "png" || src === "jpg") && tgt === "pdf") {
    return convertImageToPdf(inp)
  }
  // pdf -> png / txt
  if (src === "pdf" && tgt === "png") return convertPdfToPng(inp)
  if (src === "pdf" && tgt === "txt") return convertPdfToTxt(inp)

  // audio/video (incl. extraction)
  const srcCat = FORMATS[src]?.category
  const tgtCat = FORMATS[tgt]?.category
  if (srcCat === "audio" || srcCat === "video" || tgtCat === "audio" || tgtCat === "video") {
    return convertFfmpeg(inp)
  }

  // soffice -> pdf
  if (SOFFICE_SOURCES.has(src) && tgt === "pdf") {
    return convertSofficeToPdf(inp)
  }
  // csv -> pdf (HTML table route)
  if (src === "csv" && tgt === "pdf") return convertCsvToPdf(inp)
  // md/txt/html -> pdf
  if ((src === "md" || src === "txt" || src === "html") && tgt === "pdf") {
    return convertHtmlToPdf(inp)
  }

  // docx -> html/txt/md
  if (src === "docx") return convertDocx(inp)

  // md -> html
  if (src === "md" && tgt === "html") return convertMdToHtml(inp)
  // html -> txt
  if (src === "html" && tgt === "txt") return convertHtmlToTxt(inp)

  // md/txt -> docx
  if ((src === "md" || src === "txt") && tgt === "docx") return convertToDocx(inp)

  // spreadsheets / data
  if (
    (src === "xlsx" && (tgt === "csv" || tgt === "json")) ||
    (src === "csv" && (tgt === "xlsx" || tgt === "json")) ||
    (src === "json" && (tgt === "csv" || tgt === "xlsx"))
  ) {
    return convertSheetData(inp)
  }

  // archives (any source)
  if (tgtCat === "archive") return convertArchive(inp)

  throw new ConversionError(`${src} -> ${tgt} conversion is not supported.`)
}

export { outputFileName }
