# ConvertHub

A simplified, self-hosted CloudConvert alternative — upload files, pick an output format,
convert for real, preview the result in-browser, then download. Built with Next.js 16 and
inspired by CloudConvert's current dark UI (verified via REA static + runtime analysis of
cloudconvert.com).

**Everything converts locally on your machine. No sign-up, no API keys, no external
conversion services. Files auto-delete after 3 hours.**

---

## Features

- **Drag & drop or click to upload** — add as many files as you want (no batch limit;
  uploads are chunked automatically so memory stays bounded)
- **Real conversions** across images, documents, spreadsheets, audio, video, PDF and archives
- **Per-format settings** — image quality/resize, audio bitrate/channels/sample-rate,
  video resolution/fps
- **Live preview before download** — images, PDF (native viewer), video, audio, text/CSV/JSON
  and archive listings render inline; nothing touches your disk until you press Download
- **Progress + status per file** — upload %, conversion % (real ffmpeg progress), queue position
- **Download individually or all at once** (auto-zipped)
- **Conversion history** — recent jobs with re-download + delete, auto-purged after 3 hours
- **Responsive + dark/light theme** (dark default, CloudConvert-style red accent)

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript strict |
| UI | Tailwind CSS 4 + shadcn/ui (New York), Lucide icons, Inter font, next-themes |
| State | Zustand (client), 1s polling for job status |
| DB | Prisma ORM + SQLite (`db/`), `ConversionJob` model |
| Image engine | **sharp** 0.35 (libvips) — png/jpg/webp/gif/avif/tiff, SVG raster |
| Audio/Video engine | **system ffmpeg 7.1.5** — libx264, libvpx-vp9, libmp3lame, libvorbis, aac, flac, opus |
| Office engine | **LibreOffice 25.2 headless** (`soffice`) — docx/xlsx/pptx/odt/rtf → pdf/csv |
| PDF engine | **Playwright-core + Chromium** (HTML→PDF), **pdf-lib** (img→PDF), **poppler** pdftoppm/pdftotext (PDF→png/txt) |
| Document libs | mammoth (docx→html/txt), docx (txt/md→docx), SheetJS xlsx (csv/json/xlsx), marked (md→html) |
| Archives | adm-zip, archiver, system tar (zip ⇄ tar.gz ⇄ tar, any file → zip/tar.gz) |

## Setup

```bash
# 1. Install dependencies
bun install

# 2. Add conversion libs (already in package.json)
bun add sharp pdf-lib pdfjs-dist mammoth docx xlsx marked adm-zip archiver playwright-core

# 3. Configure Prisma + create the SQLite database
bun run db:push

# 4. Run the dev server
bun run dev        # http://localhost:3000
```

### External binaries (system packages, no API keys)

| Binary | Used for | Install |
|---|---|---|
| `ffmpeg` / `ffprobe` | audio + video conversions, media probing | `apt install ffmpeg` |
| `soffice` (LibreOffice) | docx/xlsx/pptx/odt/rtf → pdf, xlsx → csv | `apt install libreoffice --no-install-recommends` |
| `pdftoppm` / `pdftotext` (poppler) | pdf → png / pdf → txt | `apt install poppler-utils` |
| `tar` | tar.gz conversions | preinstalled on Linux |
| Chromium (Playwright cache) | HTML/MD/TXT → PDF rendering | `npx playwright install chromium` |

Playwright uses the cached Chromium at `~/.cache/ms-playwright/chromium-1200` with
`--no-sandbox` — see `src/lib/convert/engines.ts` (`CHROMIUM_EXECUTABLE`).

## Format matrix

**Images** (sharp): `png, jpg, jpeg, webp, gif, avif, tiff, svg, bmp, ico` →
`png, jpg, webp, gif, avif, tiff` · settings: quality (1–100), width/height (downscale)

**Documents**: `docx` → pdf/html/txt/md · `xlsx` → pdf/csv/json · `csv` → xlsx/json/pdf ·
`json` → csv/xlsx · `md` → pdf/html/docx · `txt` → pdf/docx · `html` → pdf/txt ·
`pptx, odt, rtf` → pdf

**PDF**: `png, jpg` → pdf · `pdf` → png (first page) / txt

**Audio** (ffmpeg): `mp3, wav, ogg, flac, m4a, aac, opus, wma` → `mp3, wav, ogg, flac, m4a, opus` ·
settings: bitrate (96–320k), channels, sample rate

**Video** (ffmpeg): `mp4, webm, mkv, mov, avi` → `mp4, webm, gif` + audio extraction →
`mp3, m4a, wav, ogg` · settings: resolution (480p/720p/1080p), fps

**Archives**: `zip, tar.gz, tar, gz` + any file → `zip, tar.gz, tar` (encrypted archives rejected gracefully)

Unsupported uploads (e.g. `.heic`, `.xyz`) are rejected with a clear message before any
processing. HEIC decode is not available in prebuilt libvips.

## Limits & retention

- **Files per batch: unlimited** (uploaded in 5-file / 64 MB chunks)
- **100 MB per file**, empty files rejected
- Queue concurrency: 2 conversions at a time (FIFO)
- Engine timeouts: 120 s (video, LibreOffice), 60 s (everything else)
- **Files + records auto-delete after 3 hours** (lazy purge on each history poll)

## Architecture

```
src/
├── app/
│   ├── page.tsx                    # the whole UI (only visible route)
│   └── api/
│       ├── jobs/route.ts           # POST create (multipart), GET poll/history, DELETE clear
│       ├── jobs/[id]/route.ts      # DELETE one job
│       ├── download/[id]/route.ts  # attachment stream
│       ├── download-all/route.ts   # zip-on-the-fly of finished outputs
│       └── preview/[id]/route.ts   # INLINE stream (?list=1 → archive listing JSON)
├── components/converter/           # dropzone, file rows, preview dialog, history, header/footer
├── lib/
│   ├── convert/registry.ts         # format matrix + settings schema (single source of truth)
│   ├── convert/engines.ts          # sharp/ffmpeg/soffice/playwright/pdf-lib wrappers
│   ├── convert/queue.ts            # FIFO queue, concurrency 2, progress, purge
│   └── store.ts                    # Zustand: rows, chunked XHR uploads, polling, history
└── prisma/schema.prisma            # ConversionJob model
```

Job lifecycle mirrors CloudConvert's task model: `queued → processing → finished | error`,
with progress parsed from `ffmpeg -progress pipe:1` (out_time vs duration) or staged
0→60→100 for library-based engines.

## Testing

```bash
bash scripts/e2e-test.sh              # full API conversion matrix
bash scripts/test-unlimited-preview.sh  # 14-file batch + preview endpoints
```

## Credits

- UX/design language inspired by [CloudConvert](https://cloudconvert.com) (analyzed with REA;
  no code or assets copied)
- Powered by sharp, FFmpeg, LibreOffice, Poppler, Playwright, pdf-lib, SheetJS, mammoth,
  marked, adm-zip — all running locally

## Deploy elsewhere (new machine / VPS / Docker)

```bash
# 1. Unzip and enter the project
unzip converthub-source.zip -d converthub && cd converthub

# 2. Install system conversion engines (Ubuntu/Debian)
sudo apt update
sudo apt install -y ffmpeg libreoffice --no-install-recommends poppler-utils

# 3. Install JS deps + configure env + create the database
bun install            # or: npm install / pnpm install
cp .env.example .env   # adjust DATABASE_URL if you want an absolute path
bun run db:push        # creates db/custom.db from prisma/schema.prisma

# 4. Production build + start
bun run build
bun run start          # serves on :3000

# 5. One-time: install Chromium for HTML/MD → PDF rendering
npx playwright install chromium
# (if the cached path differs on your machine, update CHROMIUM_EXECUTABLE
#  in src/lib/convert/engines.ts — see the table above)

# 6. Verify everything works
bash scripts/e2e-test.sh
bash scripts/test-unlimited-preview.sh
```

Notes for other hosts:
- Works behind any reverse proxy (Nginx/Caddy) — only HTTP is needed, no websockets.
- To raise the 100 MB/file limit, adjust `MAX_FILE_BYTES` in `src/lib/convert/registry.ts`
  and your proxy's `client_max_body_size` / body-limit setting.
- Runtime data lives in `db/custom.db` and `storage/{uploads,outputs}` — mount these as a
  volume if you deploy in a container; files self-purge after 3 hours.
