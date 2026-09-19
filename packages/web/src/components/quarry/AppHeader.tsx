import { Layers } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function AppHeader({
  children,
  className,
}: {
  children?: ReactNode
  className?: string
}) {
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
        {/* Stacked layers: a pile of documents read into one table. */}
        <span className="grid size-7 place-items-center rounded-[9px] bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(16,40,34,0.18)]">
          <Layers aria-hidden className="size-4" strokeWidth={2.1} />
        </span>
        <span className="text-[15px] font-semibold tracking-[-0.015em]">Quarry</span>
      </Link>

      <div className="min-w-0 flex-1">{children}</div>
    </header>
  )
}
