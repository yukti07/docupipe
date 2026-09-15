import type { ComponentProps, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type GatedButtonProps = Omit<ComponentProps<typeof Button>, "disabled"> & {
  /**
   * Present means gated. The string is both the on-screen explanation and part
   * of the accessible name — a tooltip alone is invisible on touch and to most
   * assistive tech, which is exactly where the gating logic matters most.
   */
  reason?: string | null
  children: ReactNode
  reasonClassName?: string
  /**
   * The reason is already written somewhere on screen — print it beside the
   * button and it is said twice. It stays in the accessible name either way.
   */
  hideReason?: boolean
}

export function GatedButton({
  reason,
  children,
  className,
  reasonClassName,
  hideReason,
  ...props
}: GatedButtonProps) {
  const gated = Boolean(reason)

  const button = (
    <Button
      {...props}
      disabled={gated}
      aria-disabled={gated || undefined}
      aria-label={gated ? `${textOf(children)} — ${reason}` : undefined}
      className={cn("h-10 rounded-[10px] px-4 text-sm font-medium", className)}
    >
      {children}
    </Button>
  )

  if (!gated || hideReason) return button

  return (
    <div className="flex items-center gap-3">
      <span className={cn("text-xs text-muted-foreground", reasonClassName)}>{reason}</span>
      {button}
    </div>
  )
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(" ").trim()
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: ReactNode } }).props.children)
  }
  return ""
}
