import { FailureMessage } from "@/components/quarry/FailureMessage"
import type { Failure } from "@/lib/api/types"
import { formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Files that settled without a shape. They are named here rather than hidden,
 * and they do not block Convert — they are carried through as failures.
 */
export function WontConvertPanel({
  entries,
  className,
}: {
  entries: { fileId: string; fileName: string; failure: Failure }[]
  className?: string
}) {
  if (entries.length === 0) return null

  return (
    <section className={cn("rounded-xl border border-border-subtle bg-card p-4", className)}>
      <h3 className="text-[13px] font-medium">
        {formatCount(entries.length)} {entries.length === 1 ? "file" : "files"} won&apos;t convert
      </h3>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        These carry on as failures rather than holding up the rest. Convert stays available.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {entries.map((entry) => (
          <li key={entry.fileId}>
            <p className="truncate font-mono text-[12px]">{entry.fileName}</p>
            <FailureMessage failure={entry.failure} className="mt-1" />
          </li>
        ))}
      </ul>
    </section>
  )
}
