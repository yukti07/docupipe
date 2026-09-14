import { FixtureApi } from "./fixtures"
import { LiveApi } from "./live"
import type { QuarryApi } from "./contract"

/**
 * The seven routes are live; §0.9's surfaces are fixtures. Moving one across
 * is a single line here and no change to any screen.
 */
export const api: QuarryApi = { ...FixtureApi, ...LiveApi }

export * from "./contract"
export * from "./types"
export { ApiError } from "./http"
