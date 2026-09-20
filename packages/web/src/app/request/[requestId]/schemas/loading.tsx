"use client"

import { useParams } from "next/navigation"
import { AppHeader } from "@/components/quarry/AppHeader"
import { BatchNav } from "@/components/quarry/BatchNav"
import { PendingSchemaCard } from "@/components/quarry/PendingSchemaCard"

/**
 * Shown the instant Review Schemas is pressed, while the route itself is still
 * on its way. Without this file React holds the *old* screen until the new
 * one's payload lands, so the press appears to do nothing for as long as that
 * takes — which is the whole of the wait, spent looking at the wrong screen.
 *
 * It is the real screen's own opening state, card for card: the same heading
 * over the same pending cards the page itself shows before its first poll
 * answers. Nothing on it moves when the route arrives — the cards simply start
 * turning into schemas.
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

      <div
        role="status"
        aria-label="Opening the schemas in this batch"
        className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 px-6 py-6"
      >
        <h1 className="text-[19px] font-semibold tracking-[-0.015em]">Reading your schemas</h1>
        <div className="flex flex-col gap-2.5">
          {[0, 1, 2].map((index) => (
            <PendingSchemaCard key={index} index={index} />
          ))}
        </div>
      </div>
    </>
  )
}
