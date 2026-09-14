import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** One short true sentence. No illustration — a cartoon lowers the register. */
export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string
  body?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-14 text-center", className)}>
      <p className="text-[15px] font-medium text-foreground">{title}</p>
      {body && <p className="max-w-prose text-[13px] text-muted-foreground">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
