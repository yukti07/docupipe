const KEY = "quarry.introSeen"

/**
 * Whether the intro has already played in this browser.
 *
 * A storage that throws — private mode, blocked site data — reads as *seen*.
 * An intro that cannot record itself must not replay on every single load.
 */
export function hasSeenIntro(): boolean {
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    return true
  }
}

export function markIntroSeen(): void {
  try {
    localStorage.setItem(KEY, "1")
  } catch {
    // Nothing to fall back to, and nothing worth telling anyone about.
  }
}
