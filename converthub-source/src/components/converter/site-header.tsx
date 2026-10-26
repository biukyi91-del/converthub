import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/converter/theme-toggle"

/** Always-dark header, 64px tall — mirrors CloudConvert chrome (spec §2). */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 h-16 border-b border-white/10 bg-[#18181b]/95 text-white backdrop-blur supports-[backdrop-filter]:bg-[#18181b]/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <a href="/" className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand" aria-label="ConvertHub home">
          <span
            aria-hidden
            className="flex size-8 items-center justify-center rounded-md text-white"
            style={{ backgroundColor: "#b53836" }}
          >
            <RefreshCw className="size-4" />
          </span>
          <span className="text-lg font-semibold tracking-tight">
            Convert<span style={{ color: "#cd5856" }}>Hub</span>
          </span>
        </a>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main">
          <Button
            variant="ghost"
            asChild
            className="min-h-11 rounded-md text-zinc-300 hover:bg-white/10 hover:text-white"
          >
            <a href="#history">History</a>
          </Button>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  )
}
