import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function PageHeader({
  breadcrumb,
  title,
  subtitle,
  actions,
  className,
}: {
  breadcrumb?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4 px-6 py-5", className)}>
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1 text-[12px] text-muted-foreground">{breadcrumb}</div>}
        <h1 className="truncate text-[22px] font-semibold tracking-[-0.02em] text-foreground">
          {title}
        </h1>
        {subtitle && <div className="mt-1 text-[13px] text-subtle-foreground">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
