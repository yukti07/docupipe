import { cn } from "@/lib/utils"

/** Shows a key, or a sequence of them: Esc, Enter, Shift then Tab. */
export function KeyHint({ keys, className }: { keys: string | string[]; className?: string }) {
  const list = Array.isArray(keys) ? keys : [keys]
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {list.map((key) => (
        <kbd
          key={key}
          className="rounded-[5px] border border-border-subtle bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}
