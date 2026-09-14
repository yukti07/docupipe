import { CircleX } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** Page-level failure. Always carries a real action — a dead end is never a state. */
export function ErrorState({
  title,
  body,
  onRetry,
  backHref,
  backLabel = "Back to your workspace",
  className,
}: {
  title: string
  body: string
  onRetry?: () => void
  backHref?: string
  backLabel?: string
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        "mx-auto flex max-w-lg flex-col items-center gap-3 rounded-xl border border-error-border bg-error-bg px-6 py-12 text-center",
        className,
      )}
    >
      <CircleX aria-hidden className="size-5 text-error" strokeWidth={1.9} />
      <p className="text-[15px] font-medium text-error-strong">{title}</p>
      <p className="max-w-prose text-[13px] text-error-strong/85">{body}</p>
      <div className="mt-2 flex items-center gap-2">
        {onRetry && (
          <Button onClick={onRetry} className="h-9 rounded-[10px]">
            Try again
          </Button>
        )}
        {backHref && (
          <Button asChild variant="outline" className="h-9 rounded-[10px] bg-card">
            <Link href={backHref}>{backLabel}</Link>
          </Button>
        )}
      </div>
    </div>
  )
}
