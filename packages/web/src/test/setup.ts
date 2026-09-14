import "@testing-library/jest-dom/vitest"
import { afterAll, afterEach, beforeAll, vi } from "vitest"
import { server } from "./msw/server"

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => {
  server.resetHandlers()
  localStorage.clear()
  vi.useRealTimers()
})
afterAll(() => server.close())

// jsdom implements neither, and both are used by the panels and the table.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia

window.HTMLElement.prototype.scrollIntoView ??= () => {}

// Radix's select and popover drive themselves off the pointer capture API,
// which jsdom does not implement at all.
window.HTMLElement.prototype.hasPointerCapture ??= () => false
window.HTMLElement.prototype.setPointerCapture ??= () => {}
window.HTMLElement.prototype.releasePointerCapture ??= () => {}

// jsdom has no layout engine, so Radix's collision handling gets zeroes.
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver

window.DOMRect ??= class {
  constructor(
    readonly x = 0,
    readonly y = 0,
    readonly width = 0,
    readonly height = 0,
  ) {}
  readonly top = 0
  readonly left = 0
  readonly right = 0
  readonly bottom = 0
  static fromRect() {
    return new window.DOMRect()
  }
  toJSON() {
    return {}
  }
} as unknown as typeof DOMRect
