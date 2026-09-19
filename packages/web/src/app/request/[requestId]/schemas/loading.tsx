"use client"

import { useParams } from "next/navigation"
import { AppHeader } from "@/components/quarry/AppHeader"
import { BatchNav } from "@/components/quarry/BatchNav"
import { ReviewSchemasSkeleton } from "@/components/quarry/ReviewSchemasSkeleton"

/**
 * Shown the instant Review Schemas is pressed, while the route itself is still
 * on its way. Without this file React holds the *old* screen until the new
 * one's payload lands, so the press appears to do nothing for as long as that
 * takes — which is the whole of the wait, spent looking at the wrong screen.
 *
 * The header is the real one, so only the body below it changes. The rail is
 * already on Schemas: the press that landed here is what moves it, and showing
 * it still on Files would walk it backwards a frame before it caught up.
 */
export default function Loading() {
  const params = useParams<{ requestId: string }>()

  return (
    <>
      <AppHeader>
        {params?.requestId && (
          <BatchNav
            requestId={params.requestId}
            current="schemas"
            done={{ files: true, schemas: false }}
            phase="prepare"
          />
        )}
      </AppHeader>

      <ReviewSchemasSkeleton />
    </>
  )
}
