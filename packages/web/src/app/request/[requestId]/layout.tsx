"use client"

import { usePathname } from "next/navigation"
import { use, useEffect, useState } from "react"
import { ensureSession } from "@/lib/session"
import { BatchProvider } from "@/state/batchContext"

/**
 * Everything under one request shares one batch state.
 *
 * Shapes are only polled for on the two screens that are about them. A table
 * and the merge picker live past the gate, where nothing is still being read,
 * and a poll there would be a request per five seconds for an answer no
 * screen renders.
 */
export default function RequestLayout({
  children,
  params,
}: LayoutProps<"/request/[requestId]">) {
  const { requestId } = use(params)
  const [userId, setUserId] = useState<string | null>(null)
  const pathname = usePathname()

  useEffect(() => {
    void ensureSession().then(setUserId)
  }, [])

  // Named the other way round on purpose: a screen added under a request
  // should poll by default, and a new one that does not need shapes is a
  // cheap mistake to spot. The reverse goes unnoticed.
  const pastTheGate = pathname.endsWith("/merge") || pathname.includes("/table/")

  return (
    <BatchProvider requestId={requestId} userId={userId} pollSchemas={!pastTheGate}>
      {children}
    </BatchProvider>
  )
}
