"use client"

import { useEffect } from "react"

import { SiteHeader } from "@/components/converter/site-header"
import { Hero } from "@/components/converter/hero"
import { DropzoneCard } from "@/components/converter/dropzone-card"
import { FileList } from "@/components/converter/file-list"
import { HistoryPanel } from "@/components/converter/history-panel"
import { SiteFooter } from "@/components/converter/site-footer"
import { useConvertStore } from "@/lib/store"

export default function Home() {
  const fetchHistory = useConvertStore((s) => s.fetchHistory)

  useEffect(() => {
    void fetchHistory()
  }, [fetchHistory])

  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <Hero />
        <div className="flex-1 bg-zinc-100 pb-16 dark:bg-zinc-950">
          <div className="relative z-10 mx-auto -mt-24 max-w-3xl px-4 sm:-mt-28 sm:px-6">
            <DropzoneCard />
            <FileList />
            <HistoryPanel />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
