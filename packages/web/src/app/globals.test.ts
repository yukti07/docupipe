import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

// Read from the package root, not from import.meta.url — under the jsdom
// environment that url is served over http and node:fs refuses it.
const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8")

describe("design tokens", () => {
  it("uses the canvas accent, not the superseded blue", () => {
    expect(css).toContain("--primary: oklch(0.52 0.11 172)")
    expect(css).not.toContain("0.17 258")
  })

  it.each(["--review", "--error", "--paused", "--review-cell", "--canvas"])(
    "defines %s",
    (token) => {
      expect(css).toMatch(new RegExp(`${token}:`))
    },
  )

  it("exposes the status colours to tailwind", () => {
    expect(css).toContain("--color-review: var(--review)")
    expect(css).toContain("--color-paused: var(--paused)")
  })
})
