const NUM = new Intl.NumberFormat("en-GB")

export const formatCount = (n: number) => NUM.format(n)

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/** "about 14 min left" — deliberately vague, because a false precision reads as a promise. */
export function formatEta(seconds: number | null): string | null {
  if (seconds === null || seconds < 0) return null
  if (seconds < 60) return "less than a minute left"
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `about ${mins} min left`
  return `about ${Math.round(mins / 60)} hr left`
}

/**
 * "September 20, 2026 · 10:42 AM" — when a batch was dropped.
 *
 * The full date rather than a relative one: a workspace is a list of things
 * you did, and "2 days ago" stops being an answer the moment there are two of
 * them from the same week. The time is on it because more than one batch a day
 * is the normal case, and it is the only thing that tells them apart.
 */
export function formatStamp(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ""
  const date = at.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
  const time = at.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })
  return `${date} · ${time}`
}

/** "14:32" — a resume time is a clock time, never a countdown. */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
}
