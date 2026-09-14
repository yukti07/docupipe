import { describe, expect, it } from "vitest"
import { formatBytes, formatClock, formatCount, formatEta } from "./format"

describe("formatCount", () => {
  it("groups thousands, because the allowance meter reads 1,840 and not 1840", () => {
    expect(formatCount(1840)).toBe("1,840")
  })
})

describe("formatBytes", () => {
  it("reports nothing as bytes rather than as 0.0 KB", () => {
    expect(formatBytes(0)).toBe("0 B")
  })

  it("switches unit at the 1024 boundary and not before", () => {
    expect(formatBytes(1023)).toBe("1023 B")
    expect(formatBytes(1024)).toBe("1.0 KB")
  })

  it("drops the decimal once the number is big enough not to need it", () => {
    expect(formatBytes(15 * 1024)).toBe("15 KB")
  })
})

describe("formatEta", () => {
  it("returns null when there is no estimate, so callers render nothing", () => {
    expect(formatEta(null)).toBeNull()
  })

  it("never says 0 min", () => {
    expect(formatEta(59)).toBe("less than a minute left")
  })

  it("is deliberately vague in minutes and in hours", () => {
    expect(formatEta(840)).toBe("about 14 min left")
    expect(formatEta(7200)).toBe("about 2 hr left")
  })
})

describe("formatClock", () => {
  it("renders a resume time as a clock time", () => {
    expect(formatClock("2026-09-15T14:32:00Z")).toMatch(/^\d{2}:\d{2}$/)
  })
})
