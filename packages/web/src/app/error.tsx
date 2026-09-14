"use client" // Error boundaries must be Client Components

import { useEffect } from "react"
import { ErrorState } from "@/components/common/ErrorState"

/**
 * The admission that something got past us. If a user sees this screen, the
 * failure taxonomy is missing an entry — it is not a general-purpose error page.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      {/* The raw message is deliberately not rendered — it is not written for anyone to read. */}
      <ErrorState
        title="Something broke here"
        body="This one is on us, and it isn't something you did. Nothing already converted has been lost."
        onRetry={retry}
        backHref="/"
      />
    </main>
  )
}
