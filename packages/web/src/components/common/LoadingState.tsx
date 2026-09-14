import { cn } from "@/lib/utils"

type LoadingStateProps = {
  /** Required. There is no spinner in this product that does not say what it is doing. */
  label: string
  value?: number
  of?: number
  className?: string
}

export function LoadingState({ label, value, of, className }: LoadingStateProps) {
  const determinate = typeof value === "number" && typeof of === "number" && of > 0
  const pct = determinate ? Math.min(100, Math.max(0, (value / of) * 100)) : 0

  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2 text-[13px] text-subtle-foreground">
        {!determinate && (
          <span
            aria-hidden
            className="size-3.5 animate-spin rounded-full border-[1.5px] border-border border-t-primary"
          />
        )}
        <span>{label}</span>
        {determinate && (
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {value} of {of}
          </span>
        )}
      </div>
      {determinate && (
        <div
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={of}
          aria-label={label}
          className="h-[5px] w-full overflow-hidden rounded-full bg-border-subtle"
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}
