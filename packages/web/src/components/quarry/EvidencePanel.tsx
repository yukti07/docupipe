"use client"

import { X } from "lucide-react"
import { useCallback } from "react"
import { LoadingState } from "@/components/common/LoadingState"
import { EvidenceView } from "@/components/quarry/EvidenceView"
import { FailureMessage } from "@/components/quarry/FailureMessage"
import { MarkedCellReason } from "@/components/quarry/MarkedCellReason"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { useAsync } from "@/lib/useAsync"

/**
 * A side panel, never a modal: the cell and its source have to be visible at
 * the same time, and a modal over the table breaks the thing the screen is for.
 *
 * Read-only. Correcting a value arrives with the review queue at P2.
 */
export function EvidencePanel({
  valueId,
  fileName,
  onClose,
}: {
  valueId: string
  fileName: string
  onClose: () => void
}) {
  const { data: evidence, failure } = useAsync(
    valueId,
    useCallback(() => api.getEvidence(valueId), [valueId]),
  )

  return (
    <div className="flex min-h-0 flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">Where this came from</p>
          <p className="mt-0.5 truncate font-mono text-[11.5px] text-muted-foreground">
            {fileName}
            {evidence ? ` · ${evidence.fieldKey}` : ""}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close the evidence panel"
          onClick={onClose}
          className="size-8 shrink-0 rounded-lg"
        >
          <X aria-hidden className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {!evidence && !failure && <LoadingState label="Finding the source" />}
        {failure && <FailureMessage failure={failure} />}

        {evidence && (
          <div className="flex flex-col gap-4">
            <div>
              <p className="font-mono text-[15px] tabular-nums">
                {evidence.display || <span className="italic text-muted-foreground">not found</span>}
              </p>
              {evidence.reason && <MarkedCellReason reason={evidence.reason} className="mt-1.5" />}
            </div>

            <EvidenceView locator={evidence.locator} />
          </div>
        )}
      </div>

      <footer className="border-t border-border-subtle px-4 py-3 text-[11.5px] text-muted-foreground">
        This panel shows where a value came from. To change a value, download the table and edit it
        there.
      </footer>
    </div>
  )
}
