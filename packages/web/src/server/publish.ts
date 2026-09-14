import "server-only"

import { env } from "./env"

/**
 * Handing a message to the worker.
 *
 * This is the FAST PATH ONLY. The outbox row is already committed by the time
 * anything here runs, so a failure is logged and swallowed: the worker's
 * scheduled sweep relays anything still PENDING.
 *
 * That is the whole point of the outbox — a transient Pub/Sub error must not
 * fail a request the user made, and must not need a retry loop of its own.
 */

export type Message = {
  topic: string
  payload: { fileId: string }
  attributes: Record<string, string>
}

async function publishToPubSub(message: Message): Promise<void> {
  const { PubSub } = await import("@google-cloud/pubsub")
  const cfg = env()
  if (!cfg.projectId) throw new Error("GCP_PROJECT_ID is required to publish")

  await new PubSub({ projectId: cfg.projectId })
    .topic(message.topic)
    .publishMessage({
      data: Buffer.from(JSON.stringify(message.payload)),
      attributes: message.attributes,
    })
}

/**
 * Local: there is no broker, so hand the envelope straight to the worker.
 *
 * Shaped exactly like a Pub/Sub push so the worker cannot tell the difference,
 * and so the local path exercises the same parsing code as the deployed one.
 */
async function publishLocally(message: Message): Promise<void> {
  const body = {
    message: {
      data: Buffer.from(JSON.stringify(message.payload)).toString("base64"),
      attributes: message.attributes,
      messageId: `local-${Date.now()}`,
    },
    subscription: "projects/local/subscriptions/dev",
  }

  const response = await fetch(`${env().workerUrl}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  })

  // 409 means another delivery holds the lease, which is a correct outcome and
  // not a publish failure.
  if (!response.ok && response.status !== 409) {
    throw new Error(`worker returned ${response.status}`)
  }
}

/**
 * Publish, best effort. Returns the ids that made it, so the caller can mark
 * exactly those rows PUBLISHED and leave the rest for the sweep.
 */
export async function publishAll(
  messages: { outboxId: number; message: Message }[],
): Promise<number[]> {
  const local = env().storageBackend === "local"
  const delivered: number[] = []

  await Promise.all(
    messages.map(async ({ outboxId, message }) => {
      try {
        await (local ? publishLocally(message) : publishToPubSub(message))
        delivered.push(outboxId)
      } catch (error) {
        // Deliberately not rethrown. The row stays PENDING and the sweep will
        // retry it with backoff; failing the API call here would throw away
        // work the user asked for over a transient broker error.
        console.warn(
          JSON.stringify({
            severity: "WARNING",
            message: "inline publish failed; left for the sweep",
            outboxId,
            topic: message.topic,
            error: error instanceof Error ? error.message : String(error),
          }),
        )
      }
    }),
  )

  return delivered
}
