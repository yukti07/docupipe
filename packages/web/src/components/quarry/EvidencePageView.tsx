"use client"

import { useEffect, useRef, useState } from "react"
import { LoadingState } from "@/components/common/LoadingState"
import { HighlightBox } from "@/components/quarry/HighlightBox"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import type { Locator } from "@/lib/api/types"
import { formatCount } from "@/lib/format"

type PageLocator = Extract<Locator, { type: "page" }>

type Render = { key: string; state: "rendered" | "unavailable" }

const keyOf = (locator: PageLocator) => `${locator.documentUrl}#${locator.page}`

/**
 * The box arrives as fractions of the page, never as points, so the worker's
 * PyMuPDF coordinates and this browser's pdf.js render agree at any zoom (D17).
 * Scaling happens here, once, against the rendered size.
 */
export function EvidencePageView({ locator }: { locator: PageLocator }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Keyed by the page being drawn, so switching pages is a wait rather than a
  // stale render — and nothing has to be reset on the way in.
  const [render, setRender] = useState<Render | null>(null)
  const key = keyOf(locator)
  const state = render?.key === key ? render.state : "rendering"

  useEffect(() => {
    let cancelled = false

    async function draw() {
      try {
        const pdfjs = await import("pdfjs-dist")
        // The worker ships with the package; bundling it by URL avoids
        // vendoring a copy into public/ that can drift from the library.
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString()

        const doc = await pdfjs.getDocument({ url: locator.documentUrl }).promise
        if (cancelled) return
        const page = await doc.getPage(locator.page)
        if (cancelled) return

        const base = page.getViewport({ scale: 1 })
        const width = Math.min(880, base.width * 1.4)
        const viewport = page.getViewport({ scale: width / base.width })

        const canvas = canvasRef.current
        const context = canvas?.getContext("2d")
        if (!canvas || !context) {
          if (!cancelled) setRender({ key, state: "unavailable" })
          return
        }
        canvas.width = viewport.width
        canvas.height = viewport.height
        await page.render({ canvas, canvasContext: context, viewport }).promise
        if (cancelled) return

        setRender({ key, state: "rendered" })
      } catch {
        if (!cancelled) setRender({ key, state: "unavailable" })
      }
    }

    void draw()
    return () => {
      cancelled = true
    }
  }, [key, locator.documentUrl, locator.page])

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] tabular-nums text-muted-foreground">
        Page {formatCount(locator.page)} of {formatCount(locator.pageCount)}
      </p>

      {state === "rendering" && <LoadingState label="Loading the page" />}

      {state === "unavailable" && (
        <FailureMessage
          failure={{
            class: "acquisition",
            message: "The original couldn't be loaded.",
            nextStep: "The value and its reason are still above; try again in a moment.",
          }}
        />
      )}

      <div
        className="relative mx-auto w-fit overflow-hidden rounded-lg border border-border-subtle bg-card"
        style={state === "unavailable" ? { display: "none" } : undefined}
      >
        <canvas ref={canvasRef} className="block max-w-full" />
        {state === "rendered" && (
          <HighlightBox box={locator.box} label={`Highlighted on page ${locator.page}`} />
        )}
      </div>
    </div>
  )
}
