"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { formatClock } from "@/lib/format"

/**
 * The cap is a setting, and the settings screen does not exist yet. Rather than
 * leave the control pointing nowhere, it says plainly that the cap cannot be
 * raised from here and what the alternatives actually are — the reset time, and
 * the tables already finished.
 */
export function RaiseCapDialog({ resetsAt }: { resetsAt?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Raise the cap
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-[460px] rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-[16px]">The cap can&apos;t be raised yet</DialogTitle>
          <DialogDescription className="text-[13px] leading-[1.55]">
            There is no setting for this in the product yet, so nothing here can lift it today.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-1.5 rounded-xl border border-border-subtle bg-muted px-4 py-3 text-[13px] leading-[1.5]">
          <li className="tabular-nums">
            {resetsAt
              ? `The allowance resets at ${formatClock(resetsAt)}, and the batch picks up on its own.`
              : "The allowance resets on its own, and the batch picks up from where it stopped."}
          </li>
          <li>Every table that has already finished stays open and downloadable meanwhile.</li>
          <li>Nothing has been lost, and nothing needs re-uploading.</li>
        </ul>

        <DialogFooter>
          <Button onClick={() => setOpen(false)} className="h-9 rounded-[10px]">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
