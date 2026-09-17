import { FixtureApi } from "./fixtures"
import { FixtureSeven } from "./fixtureSeven"
import { LiveApi, NotBuilt } from "./live"
import type { QuarryApi } from "./contract"

/**
 * Which backend the app talks to. Nothing outside this file knows which one it
 * got: every screen imports `api`, and no screen imports `live` or `fixtures`
 * directly.
 *
 *   npm run fixtures:off      the real backend, and nothing invented
 *   npm run fixtures:on       sample data everywhere — no server at all
 *   npm run fixtures:mixed    the real backend, with sample data for the four
 *                             surfaces that have no route yet
 *
 * Next inlines these at build time, so the flags are read once when the bundle
 * is built — `next dev` restarts itself when `.env.local` changes, which is
 * what makes the switch feel instant.
 */
export const FIXTURES = process.env.NEXT_PUBLIC_FIXTURES === "1"

/**
 * The four surfaces with no route yet serve sample data instead of refusing.
 *
 * This is what the app did unconditionally before, and it is still the only way
 * to look at those screens against a real batch. It is opt-in now because the
 * default should not be handing someone rows that are not theirs. It is on in
 * the test run, where the fixture *is* the thing under test.
 */
const FIXTURE_FALLBACK = process.env.NEXT_PUBLIC_FIXTURE_FALLBACK === "1"

/**
 * **Fixtures:** all twelve surfaces are sample data. Postgres, the worker and
 * the bucket are all absent, and nothing on screen belongs to anyone.
 *
 * **Live:** the eight routes are real. The other four have no route yet, so by
 * default they refuse with a sentence that says so — see `NotBuilt` in
 * `live.ts` — and only fall back to sample data when asked to. Sample rows
 * served under a real batch are indistinguishable from the user's own, which is
 * a worse failure than an honest one.
 */
export const api: QuarryApi = FIXTURES
  ? { ...FixtureApi, ...FixtureSeven }
  : { ...(FIXTURE_FALLBACK ? FixtureApi : NotBuilt), ...LiveApi }

export * from "./contract"
export * from "./types"
export { ApiError, toFailure } from "./http"
