"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { AppHeader } from "@/components/quarry/AppHeader"
import { ReviewSchemasSkeleton } from "@/components/quarry/ReviewSchemasSkeleton"

/**
 * Shown the instant Review Schemas is pressed, while the route itself is still
 * on its way. Without this file React holds the *old* screen until the new
 * one's payload lands, so the press appears to do nothing for as long as that
 * takes — which is the whole of the wait, spent looking at the wrong screen.
 *
 * The header is the real one, so only the body below it changes.
 */
export default function Loading() {
  const params = useParams<{ requestId: string }>()

  return (
    <>
      <AppHeader userId={null}>
        <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
          {params?.requestId ? (
            <Link
              href={`/request/${params.requestId}`}
              className="shrink-0 text-muted-foreground hover:text-foreground hover:underline"
            >
              Prepare
            </Link>
          ) : (
            <span className="shrink-0 text-muted-foreground">Prepare</span>
          )}
          <span aria-hidden className="text-border">
            /
          </span>
          <span className="truncate font-medium">Review schemas</span>
        </div>
      </AppHeader>

      <ReviewSchemasSkeleton />
    </>
  )
}
