"use client"

import { CloudOff, RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"
import type { Failure } from "@/lib/api/types"
import { cn } from "@/lib/utils"

/**
 * Live updates dropping out is not a failure of the batch, so it does not read
 * as one. It says it is reconnecting and keeps the last known state on screen —
 * and says *offline* rather than implying what is showing is current.
 */
export function ConnectionStatus({
  failure,
  className,
}: {
  failure: Failure | null
  className?: string
}) {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    update()
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])

  if (!failure && !offline) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center gap-2.5 rounded-[10px] border border-paused-border bg-paused-bg px-3.5 py-2.5 text-[12.5px] text-paused-strong",
        className,
      )}
    >
      {offline ? (
        <CloudOff aria-hidden className="size-4 shrink-0" strokeWidth={1.9} />
      ) : (
        <RefreshCw aria-hidden className="size-4 shrink-0 motion-safe:animate-spin" strokeWidth={1.9} />
      )}
      <p>
        {offline
          ? "You're offline. What's on screen is the last thing we heard — it may have moved on since."
          : "Reconnecting. The last known state is still shown below."}
      </p>
    </div>
  )
}
