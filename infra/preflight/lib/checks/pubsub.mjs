import { PubSub } from "@google-cloud/pubsub"
import { failure } from "../report.mjs"

/**
 * Both topics, both subscriptions, and the two grants that fail silently.
 *
 * Dead-lettering needs the Pub/Sub service agent to hold publisher on the DLQ
 * topic AND subscriber on the source subscription. Miss either and the policy
 * is configured and does nothing — which looks exactly like it working, right
 * up until a poison message cycles forever.
 */

export async function run(report, cfg, state) {
  report.group("Pub/Sub")

  const pubsub = new PubSub({ projectId: cfg.projectId })
  const agent = `serviceAccount:service-${cfg.projectNumber}@gcp-sa-pubsub.iam.gserviceaccount.com`

  const topics = [
    { name: cfg.topicFileUploaded, role: "inspect", url: cfg.inspectServiceUrl },
    { name: cfg.topicConvertRequested, role: "convert", url: cfg.convertServiceUrl },
  ]

  for (const { name, role, url } of topics) {
    if (!name) {
      report.skip(`topic for ${role}`, "topic name not set")
      continue
    }

    const topic = pubsub.topic(name)

    await report.check(`topic ${name} exists`, async () => {
      const [exists] = await topic.exists()
      if (!exists) throw failure("not found", "terraform apply")
      return { detail: role }
    })

    await report.check(`dead-letter topic ${name}-dlq exists`, async () => {
      const [exists] = await pubsub.topic(`${name}-dlq`).exists()
      if (!exists) {
        throw failure(
          "not found",
          "Without a DLQ a poison message is redelivered until the subscription\n" +
            "gives up, and the evidence is lost. See infra/terraform/pubsub.tf.",
        )
      }
      return { detail: "poison messages have somewhere to land" }
    })

    await report.check(`subscription for ${name} is a correct push`, async () => {
      const [subs] = await topic.getSubscriptions()
      if (subs.length === 0) {
        throw failure("no subscription", "terraform apply — nothing will ever be delivered")
      }

      const [meta] = await subs[0].getMetadata()
      const push = meta.pushConfig
      const problems = []

      if (!push?.pushEndpoint) {
        problems.push("it is a PULL subscription; the worker is push-driven")
      } else if (url && !push.pushEndpoint.startsWith(url)) {
        problems.push(`pushes to ${push.pushEndpoint}, expected ${url}`)
      }

      // No token means Cloud Run must allow unauthenticated invocation, which
      // would make the worker an open endpoint.
      if (push?.pushEndpoint && !push.oidcToken?.serviceAccountEmail) {
        problems.push("no OIDC token — the push is unauthenticated")
      }

      if (!meta.deadLetterPolicy?.deadLetterTopic) {
        problems.push("no dead-letter policy")
      }

      const ack = Number(meta.ackDeadlineSeconds ?? 0)
      if (ack < 600) {
        problems.push(
          `ack deadline is ${ack}s; the lease is sized against 600s, so a healthy ` +
            `worker can have its file stolen mid-run`,
        )
      }

      if (problems.length) {
        throw failure(problems.join("; "), "See infra/terraform/pubsub.tf")
      }

      state.subscriptions ??= {}
      state.subscriptions[name] = subs[0].name

      return {
        detail: `→ ${push.pushEndpoint} · OIDC ${push.oidcToken.serviceAccountEmail.split("@")[0]} · ack ${ack}s`,
      }
    })

    await report.check(`dead-letter grants for ${name}`, async () => {
      if (!cfg.projectNumber) return { skip: "GCP_PROJECT_NUMBER not set" }

      const [dlqPolicy] = await pubsub.topic(`${name}-dlq`).iam.getPolicy()
      const canPublish = (dlqPolicy.bindings ?? []).some(
        (b) => b.role === "roles/pubsub.publisher" && (b.members ?? []).includes(agent),
      )

      const subName = state.subscriptions?.[name]
      let canSubscribe = false
      if (subName) {
        const [subPolicy] = await pubsub.subscription(subName).iam.getPolicy()
        canSubscribe = (subPolicy.bindings ?? []).some(
          (b) => b.role === "roles/pubsub.subscriber" && (b.members ?? []).includes(agent),
        )
      }

      const missing = [
        canPublish ? null : `publisher on ${name}-dlq`,
        canSubscribe ? null : `subscriber on the subscription`,
      ].filter(Boolean)

      if (missing.length) {
        throw failure(
          `the Pub/Sub service agent lacks ${missing.join(" and ")}`,
          `Dead-lettering is configured but will SILENTLY DO NOTHING. It needs both:\n` +
            `  gcloud pubsub topics add-iam-policy-binding ${name}-dlq \\\n` +
            `    --member="${agent}" --role="roles/pubsub.publisher"\n` +
            `  gcloud pubsub subscriptions add-iam-policy-binding ${name}-sub \\\n` +
            `    --member="${agent}" --role="roles/pubsub.subscriber"`,
        )
      }

      return { detail: "both grants present" }
    })

    if (cfg.readOnly) {
      report.skip(`publish to ${name}`, "--read-only")
      continue
    }

    await report.check(`publish to ${name}`, async () => {
      // A synthetic file id. The worker looks it up, does not find it, and
      // acks with 200 — which is the designed behaviour for a message that can
      // never succeed, and incidentally proves push delivery end to end.
      const fileId = `preflight_${Date.now()}`
      const id = await topic.publishMessage({
        data: Buffer.from(JSON.stringify({ fileId })),
        attributes: {
          requestTraceId: `preflight-${Date.now()}`,
          preflight: "true",
        },
      })
      return { detail: `message ${id} · the worker will ack it as unknown` }
    }, {
      fix: `Grant roles/pubsub.publisher on ${name} to whoever runs this.`,
    })
  }
}
