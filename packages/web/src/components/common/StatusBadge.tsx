import { AlertTriangle, Check, CircleX, Loader2, Pause } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type StatusVariant = "success" | "review" | "error" | "paused" | "neutral" | "working"

const STYLES: Record<StatusVariant, string> = {
  success: "bg-muted text-secondary-foreground",
  review: "bg-review-bg text-review",
  error: "bg-error-bg text-error-strong",
  paused: "bg-paused-bg text-paused-strong",
  neutral: "bg-muted text-muted-foreground",
  working: "bg-primary text-primary-foreground",
}

const ICONS: Partial<Record<StatusVariant, typeof Check>> = {
  success: Check,
  review: AlertTriangle,
  error: CircleX,
  paused: Pause,
  working: Loader2,
}

export function StatusBadge({
  variant,
  children,
  className,
}: {
  variant: StatusVariant
  children: ReactNode
  className?: string
}) {
  const Icon = ICONS[variant]
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-medium",
        STYLES[variant],
        className,
      )}
    >
      {Icon && (
        <Icon
          aria-hidden
          className={cn("size-3", variant === "working" && "animate-spin")}
          strokeWidth={2}
        />
      )}
      {children}
    </span>
  )
}
