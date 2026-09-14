"use client"

import { FileQuestion } from "lucide-react"
import { EvidencePageView } from "@/components/quarry/EvidencePageView"
import type { Locator } from "@/lib/api/types"
import { formatCount } from "@/lib/format"

/**
 * One interface, five views. Every adapter produces the same kind of locator,
 * so adding a format later means adding one case here and touching nothing
 * above it.
 */
export function EvidenceView({ locator }: { locator: Locator }) {
  switch (locator.type) {
    case "page":
      return <EvidencePageView locator={locator} />
    case "audio":
      return <EvidenceAudioView locator={locator} />
    case "text":
      return <EvidenceTextView locator={locator} />
    case "record":
      return <EvidenceRecordView locator={locator} />
    case "none":
      return <EvidenceUnavailable locator={locator} />
  }
}

function EvidenceAudioView({ locator }: { locator: Extract<Locator, { type: "audio" }> }) {
  const seconds = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] tabular-nums text-muted-foreground">
        {seconds(locator.startMs)} – {seconds(locator.endMs)}
        {locator.speaker ? ` · ${locator.speaker}` : ""}
      </p>
      <audio
        controls
        preload="metadata"
        aria-label="The moment this value was said"
        src={`${locator.audioUrl}#t=${locator.startMs / 1000},${locator.endMs / 1000}`}
        className="w-full"
      />
      <blockquote className="rounded-lg border border-border-faint bg-muted px-3 py-2.5 text-[13px] leading-[1.55]">
        {locator.transcript}
      </blockquote>
      {locator.speakerInferred && locator.speaker && (
        // Say what we actually know: nobody told us who this is.
        <p className="text-[11.5px] text-muted-foreground">
          The speaker label is worked out from the recording, not from anything that names them.
        </p>
      )}
    </div>
  )
}

function EvidenceTextView({ locator }: { locator: Extract<Locator, { type: "text" }> }) {
  const before = locator.paragraph.slice(0, locator.start)
  const match = locator.paragraph.slice(locator.start, locator.end)
  const after = locator.paragraph.slice(locator.end)

  return (
    <p className="rounded-lg border border-border-faint bg-card px-3.5 py-3 text-[13px] leading-[1.6]">
      {before}
      <mark className="rounded-[3px] border-b-2 border-primary bg-primary/12 px-0.5 text-foreground">
        {match}
      </mark>
      {after}
    </p>
  )
}

function EvidenceRecordView({ locator }: { locator: Extract<Locator, { type: "record" }> }) {
  const rows: [string, string][] = [
    ["File", locator.path],
    ...(locator.sheet ? ([["Sheet", locator.sheet]] as [string, string][]) : []),
    ...(locator.row !== undefined ? ([["Row", formatCount(locator.row)]] as [string, string][]) : []),
    ...(locator.column ? ([["Column", locator.column]] as [string, string][]) : []),
  ]

  return (
    <dl className="overflow-hidden rounded-lg border border-border-faint">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="grid grid-cols-[88px_1fr] gap-2 border-b border-border-faint bg-card px-3 py-2 text-[12.5px] last:border-b-0"
        >
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="truncate font-mono tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function EvidenceUnavailable({ locator }: { locator: Extract<Locator, { type: "none" }> }) {
  return (
    <div className="flex flex-col gap-3">
      {/* Never draw a box we aren't sure about. Say so, and show the text. */}
      <div className="flex items-start gap-2.5 rounded-[10px] border border-border-subtle bg-muted px-3.5 py-3 text-[12.5px] leading-[1.5]">
        <FileQuestion aria-hidden className="mt-px size-4 shrink-0 text-muted-foreground" strokeWidth={1.9} />
        <div>
          <p className="font-medium">This format can&apos;t say where the value was.</p>
          <p className="mt-0.5 text-muted-foreground">{locator.reason}</p>
        </div>
      </div>
      <blockquote className="rounded-lg border border-border-faint bg-card px-3.5 py-3 text-[13px] leading-[1.6]">
        {locator.sourceText}
      </blockquote>
    </div>
  )
}
