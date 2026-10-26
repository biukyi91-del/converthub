/** Sticky footer — mt-auto keeps it pinned to the viewport bottom (spec: layout rules). */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t bg-card">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-6 text-center text-sm text-muted-foreground sm:flex-row sm:px-6 sm:text-left">
        <p>
          ConvertHub — a demo file converter inspired by{" "}
          <a
            href="https://cloudconvert.com"
            className="underline decoration-brand/40 underline-offset-2 hover:text-brand"
            rel="noopener noreferrer"
          >
            CloudConvert
          </a>
          . Powered by sharp, FFmpeg, LibreOffice, Poppler &amp; Playwright.
        </p>
        <p className="shrink-0">Files are deleted automatically after 3 hours.</p>
      </div>
    </footer>
  )
}
