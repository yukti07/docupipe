"use client"

import { createContext, useContext, type ReactNode } from "react"
import { useBatch, type UseBatch } from "@/state/batch"

/**
 * One batch state per request, for every screen inside it.
 *
 * Both Prepare and Review schemas are views of the same upload and the same
 * set of shapes, and each used to build its own: two reducers, two schema
 * polls, and two calls to `takeStagedFiles` — which hands the dropped files
 * over exactly once. The second screen to mount therefore got nothing and fell
 * back to the files already confirmed, so moving between them mid-upload
 * showed fewer files than were dropped and counted them wrong, while the
 * uploads carried on dispatching into a reducer nobody was rendering.
 */
const BatchContext = createContext<UseBatch | null>(null)

export function BatchProvider({
  requestId,
  userId,
  /** False on the screens that have no use for shapes — a table, or Merge. */
  pollSchemas,
  children,
}: {
  requestId: string
  userId: string | null
  pollSchemas: boolean
  children: ReactNode
}) {
  const batch = useBatch(requestId, userId, { pollSchemas })
  return <BatchContext.Provider value={batch}>{children}</BatchContext.Provider>
}

export function useBatchContext(): UseBatch {
  const value = useContext(BatchContext)
  if (!value) throw new Error("useBatchContext must be used inside a BatchProvider")
  return value
}
