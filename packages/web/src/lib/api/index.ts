import { FixtureApi } from "./fixtures"
import { FixtureSeven } from "./fixtureSeven"
import { LiveApi } from "./live"
import type { QuarryApi } from "./contract"

/**
 * NEXT_PUBLIC_FIXTURES=1 runs the whole app on fixtures — no server, no
 * Postgres, no worker. It exists to look at the UI, and nothing outside this
 * file knows which side it got: every screen imports `api` and no screen
 * imports `live` or `fixtures` directly.
 *
 * Next inlines this at build time, so it is a restart to change, and it is
 * undefined under vitest — the tests keep the live wiring they were written on.
 */
export const FIXTURES = process.env.NEXT_PUBLIC_FIXTURES === "1"

/**
 * The seven routes are live; §0.9's surfaces are fixtures. Moving one across
 * is a single line here and no change to any screen.
 */
export const api: QuarryApi = FIXTURES
  ? { ...FixtureApi, ...LiveApi, ...FixtureSeven }
  : { ...FixtureApi, ...LiveApi }

export * from "./contract"
export * from "./types"
export { ApiError } from "./http"
