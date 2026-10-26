import { ShieldCheck, Zap, Timer } from "lucide-react"

/** Dark hero with the red-tinted gradient from the REA capture (spec §2). */
export function Hero() {
  return (
    <section className="relative overflow-hidden bg-[#18181b] text-white">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(65% 90% at 50% 10%, #2c2629 0%, #241f22 45%, #18181b 100%)",
        }}
      />
      <div className="relative mx-auto max-w-3xl px-4 pb-32 pt-14 text-center sm:px-6 sm:pb-36 sm:pt-20">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-50 sm:text-5xl md:text-[56px] md:leading-[1.1]">
          Convert Any File
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-zinc-400 sm:mt-5 sm:text-lg">
          Drop your files and pick what to turn them into. ConvertHub handles
          documents, images, audio, video and archives — free, private, right in your
          browser.
        </p>
        <ul className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs sm:text-sm text-zinc-400">
          <li className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
            <Zap aria-hidden className="size-3.5" style={{ color: "#cd5856" }} />
            Real conversions, no sign-up
          </li>
          <li className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
            <Timer aria-hidden className="size-3.5" style={{ color: "#cd5856" }} />
            Unlimited files · 100 MB each
          </li>
          <li className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
            <ShieldCheck aria-hidden className="size-3.5" style={{ color: "#cd5856" }} />
            Auto-deleted after 3 hours
          </li>
        </ul>
      </div>
    </section>
  )
}
