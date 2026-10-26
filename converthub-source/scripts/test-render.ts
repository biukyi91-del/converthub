/**
 * Standalone verification of the new HTML->PDF margins (CloudConvert parity).
 * Renders the stored HTML directly through the engine, bypassing the server.
 */
import { renderHtmlToPdf } from "../src/lib/convert/engines"

async function main() {
  const html = await Bun.file(
    "/home/z/my-project/storage/uploads/cmvo43rq70000p9txb9jb765b/all-day-slimming-tea-reviews-complaints.html"
  ).text()
  const out = "/home/z/my-project/scripts/pdf-compare/standalone.pdf"
  const isFullDoc = /<html[\s>]|<head[\s>]|<body[\s>]/i.test(html)
  const doc = isFullDoc
    ? /^\s*<!doctype/i.test(html)
      ? html
      : `<!doctype html>${html}`
    : `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`
  await renderHtmlToPdf(doc, out, {
    margins: { top: "0", bottom: "0", left: "15.5mm", right: "15.5mm" },
  })
  console.log("written:", out)
}
main()
