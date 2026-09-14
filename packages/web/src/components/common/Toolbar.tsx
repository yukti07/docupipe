import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function Toolbar({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div role="toolbar" aria-label={label} className={cn("flex items-center gap-2", className)}>
      {children}
    </div>
  )
}
