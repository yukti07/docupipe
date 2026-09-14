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

/** "14:32" — a resume time is a clock time, never a countdown. */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
}
