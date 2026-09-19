"use client"

import { Check, Layers } from "lucide-react"
import { useEffect, useEffectEvent, useRef } from "react"

/** How long the loop runs before it gets out of the way on its own. */
const INTRO_MS = 8000

/** The four shapes on the left. Four kinds of file, so the point reads as *anything* in. */
const SOURCES = [
  { name: "Q3-SHEET.XLSX", top: 26, left: 0, width: 196, drift: "qdrift4", delay: "0.1s" },
  { name: "SCAN-0091.PDF", top: 66, left: 40, width: 170, drift: "qdrift3", delay: "2.5s" },
  { name: "CALL-NOTES.M4A", top: 120, left: 14, width: 184, drift: "qdrift1", delay: "0.9s" },
  { name: "RECEIPT.JPG", top: 214, left: 0, width: 200, drift: "qdrift2", delay: "1.7s" },
] as const

/** Bar heights for the audio card, as percentages of the waveform's height. */
const WAVEFORM = [40, 80, 55, 100, 64, 36, 72, 48]

const ROWS = [
  { no: "INV-1001", supplier: "Acme Supplies", net: "1250.50", total: "1475.59" },
  { no: "INV-1002", supplier: "Global Parts", net: "820.00", total: "967.60" },
  { no: "INV-1003", supplier: "Northwind Traders", net: "2140.75", total: "2526.09" },
  { no: "INV-1004", supplier: "Prime Office", net: "560.25", total: "661.10" },
]

// The table sheds columns rather than its shape: on a phone the point is
// still "rows came out of that", and invoice-and-total makes it.
const GRID =
  "grid grid-cols-[minmax(0,1fr)_96px] items-center px-4 sm:grid-cols-[110px_minmax(0,1fr)_96px] md:grid-cols-[150px_minmax(0,1fr)_120px_110px]"

export function IntroHero({ onDone }: { onDone: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  // A parent that re-renders must not restart the countdown from the top.
  const finish = useEffectEvent(() => onDone())

  useEffect(() => {
    panel.current?.focus()
    const timer = setTimeout(() => finish(), INTRO_MS)
    return () => clearTimeout(timer)
  }, [])

  return (
    // A full-screen thing that swallows clicks has to be closable from the
    // keyboard too, so it takes focus and answers Escape.
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="intro-headline"
      tabIndex={-1}
      onClick={() => onDone()}
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === "Enter" || e.key === " ") onDone()
      }}
      className="fixed inset-x-0 bottom-0 top-[58px] z-40 flex cursor-pointer flex-col items-center justify-center gap-8 bg-[linear-gradient(135deg,var(--primary-tint)_0%,var(--card)_46%,var(--primary-tint)_100%)] outline-none"
    >
      <div
        className="flex flex-col gap-2 px-6 text-center"
        style={{ animation: "qfade 700ms ease both" }}
      >
        <h2
          id="intro-headline"
          className="text-[clamp(24px,4vw,34px)] font-semibold leading-[1.2] tracking-[-0.03em]"
        >
          Anything in. Tables out.
        </h2>
        <p className="text-[15px] leading-[1.5] text-subtle-foreground">
          Invoices, scans, recordings, spreadsheets — read, typed, filled.
        </p>
      </div>

      {/* The animation says nothing a screen reader can use; the headline above
          and the table's own summary line carry the meaning. */}
      <div
        aria-hidden
        className="flex h-[340px] w-[1080px] max-w-[92%] items-center"
      >
        <div className="relative hidden h-full w-[300px] flex-none md:block">
          {SOURCES.map((source) => (
            <div
              key={source.name}
              className="absolute rounded-[10px] border border-border bg-card px-3.5 py-3 shadow-[0_8px_22px_-14px_rgba(20,25,40,0.30)]"
              style={{
                top: source.top,
                left: source.left,
                width: source.width,
                animation: `${source.drift} 4.6s ease-in ${source.delay} infinite`,
              }}
            >
              <div className="mb-2 font-mono text-[10px] font-medium leading-none tracking-[0.05em] text-muted-foreground">
                {source.name}
              </div>
              {source.name.endsWith(".M4A") ? (
                <div className="flex h-[22px] items-end gap-[3px]">
                  {WAVEFORM.map((height, i) => (
                    <div
                      key={i}
                      className="w-[3px] rounded-[2px] bg-primary-tint-border"
                      style={{ height: `${height}%` }}
                    />
                  ))}
                </div>
              ) : source.name.endsWith(".XLSX") ? (
                <div className="grid grid-cols-3 gap-[3px]">
                  {Array.from({ length: 6 }, (_, i) => (
                    <div key={i} className="h-[6px] rounded-[2px] bg-border-subtle" />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-[5px]">
                  <div className="h-[6px] w-[86%] rounded-[3px] bg-border-subtle" />
                  <div className="h-[6px] w-[62%] rounded-[3px] bg-border-faint" />
                  <div
                    className={`h-[6px] w-[74%] rounded-[3px] ${
                      source.name.endsWith(".JPG") ? "bg-primary-tint-strong" : "bg-border-faint"
                    }`}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="hidden w-[90px] flex-none flex-col items-center gap-2.5 md:flex">
          <span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_10px_26px_-12px_var(--primary)]">
            <Layers className="size-5" strokeWidth={2} />
          </span>
          <div
            className="w-[2px] flex-1 bg-[linear-gradient(180deg,transparent,var(--primary),transparent)]"
            style={{ animation: "qbeam 1.6s ease-in-out infinite" }}
          />
        </div>

        <div className="min-w-0 flex-1 overflow-hidden rounded-xl border border-border-subtle bg-card shadow-[0_14px_40px_-22px_rgba(20,25,40,0.35)]">
          <div
            className={`${GRID} h-10 border-b border-border-subtle bg-background font-mono text-[11.5px] font-medium leading-none text-secondary-foreground`}
            style={{ animation: "qrowin 500ms ease both" }}
          >
            <div>invoice_no</div>
            <div className="hidden sm:block">supplier</div>
            <div className="hidden text-right md:block">net</div>
            <div className="text-right">total</div>
          </div>
          {ROWS.map((row, i) => (
            <div
              key={row.no}
              className={`${GRID} h-11 border-b border-border-faint text-[13px] leading-none`}
              // Rows land one at a time, roughly a second apart, because a
              // table that appeared all at once would say nothing about work.
              style={{ animation: `qrowin 600ms ease ${1.2 + i * 0.9}s both` }}
            >
              <div className="font-mono text-[12.5px]">{row.no}</div>
              <div className="hidden truncate sm:block">{row.supplier}</div>
              <div className="hidden text-right font-mono text-[12.5px] md:block">{row.net}</div>
              <div className="text-right font-mono text-[12.5px]">{row.total}</div>
            </div>
          ))}
          <div
            className="flex h-[42px] items-center gap-2 bg-primary-tint px-4"
            style={{ animation: "qfade 700ms ease 4.8s both" }}
          >
            <Check className="size-3.5 text-primary-hover" strokeWidth={2.4} />
            <span className="text-[12.5px] font-medium text-water-ink">
              4 rows · 4 typed fields · ready to query
            </span>
          </div>
        </div>
      </div>

      <p className="text-[13px] text-subtle-foreground">Click anywhere to skip</p>
    </div>
  )
}
