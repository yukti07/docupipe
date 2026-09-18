import { AlertTriangle, Check, CircleX, Loader2, Pause } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type StatusVariant = "success" | "review" | "error" | "paused" | "neutral" | "working"

/** A pill for a state that is simply true; bare text for one that needs reading. */
export type StatusAppearance = "pill" | "bare"

const STYLES: Record<StatusVariant, string> = {
  success: "bg-muted text-secondary-foreground",
  review: "bg-review-bg text-review",
  error: "bg-error-bg text-error-strong",
  paused: "bg-paused-bg text-paused-strong",
  neutral: "bg-muted text-muted-foreground",
  working: "bg-primary text-primary-foreground",
}

const BARE: Record<StatusVariant, string> = {
  success: "text-primary",
  review: "text-review",
  error: "text-error-strong",
  paused: "text-paused-strong",
  neutral: "text-muted-foreground",
  working: "text-primary",
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
  appearance = "pill",
  icon,
  children,
  className,
}: {
  variant: StatusVariant
  appearance?: StatusAppearance
  /** A state with a mark of its own — a queued file, say — brings its icon here. */
  icon?: typeof Check
  children: ReactNode
  className?: string
}) {
  const Icon = icon ?? ICONS[variant]
  const bare = appearance === "bare"
  // A state that brings its own loader spins whatever tone it is in — a queued
  // file is muted rather than "working", and still has something in hand.
  const spinning = Icon === Loader2
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 font-medium",
        bare
          ? cn("text-[12.5px]", BARE[variant])
          : cn("rounded-md px-2.5 text-[11.5px]", STYLES[variant]),
        className,
      )}
    >
      {Icon && (
        <Icon
          aria-hidden
          className={cn(
            bare ? "size-3.5" : "size-3",
            // Bare, the icon carries the colour and the words stay readable.
            bare && variant === "error" && "text-error",
            spinning && "animate-spin",
          )}
          strokeWidth={2}
        />
      )}
      {children}
    </span>
  )
}
