"use client"

import { Check, Copy, Link2 } from "lucide-react"
import Link from "next/link"
import { useState, useSyncExternalStore, type ReactNode } from "react"
import { AllowanceMeter } from "@/components/quarry/AllowanceMeter"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  allowanceServerSnapshot,
  allowanceSnapshot,
  subscribeAllowance,
  type Allowance,
} from "@/lib/allowance"
import { workspaceLink } from "@/lib/session"
import { cn } from "@/lib/utils"

export function AppHeader({
  userId,
  allowance,
  children,
  className,
}: {
  userId: string | null
  /** Live figure from the current result poll. Falls back to the last one seen. */
  allowance?: Allowance | null
  children?: ReactNode
  className?: string
}) {
  // The last figure the server sent, read straight out of the store rather
  // than copied into state on mount.
  const remembered = useSyncExternalStore(
    subscribeAllowance,
    allowanceSnapshot,
    allowanceServerSnapshot,
  )
  const shown = allowance ?? remembered

  return (
    <header
      className={cn(
        "flex h-[58px] shrink-0 items-center gap-4 border-b border-border-subtle bg-card px-6",
        className,
      )}
    >
      <Link
        href="/"
        className="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="grid size-6 place-items-center rounded-[7px] bg-primary text-[12px] font-semibold text-primary-foreground">
          Q
        </span>
        <span className="text-[14px] font-semibold tracking-[-0.01em]">Quarry</span>
      </Link>

      <div className="min-w-0 flex-1">{children}</div>

      {shown && (
        // The meter reports; raising the cap is offered beside the pause it
        // would relieve, not on every screen.
        <AllowanceMeter used={shown.used} limit={shown.limit} resetsAt={shown.resetsAt} />
      )}

      <WorkspaceLink userId={userId} />
    </header>
  )
}

function WorkspaceLink({ userId }: { userId: string | null }) {
  const [copied, setCopied] = useState(false)
  const link = userId ? workspaceLink(userId, origin()) : ""

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={!userId}
          className="h-8 gap-1.5 rounded-lg text-[12.5px]"
        >
          <Link2 aria-hidden className="size-3.5" />
          Workspace link
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[330px] rounded-xl p-4">
        <p className="text-[13px] font-medium">This workspace lives in this browser.</p>
        <p className="mt-1 text-[12.5px] leading-[1.5] text-muted-foreground">
          Copy its link to reach it from another one. The link carries the whole workspace, so
          anyone who holds it can open every batch in it.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            readOnly
            value={link}
            aria-label="Workspace link"
            onFocus={(e) => e.currentTarget.select()}
            className="h-8 min-w-0 flex-1 rounded-lg border border-border-subtle bg-muted px-2 font-mono text-[11.5px] text-subtle-foreground"
          />
          <Button size="sm" onClick={copy} className="h-8 gap-1.5 rounded-lg text-[12.5px]">
            {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function origin(): string {
  return typeof window === "undefined" ? "" : window.location.origin
}
