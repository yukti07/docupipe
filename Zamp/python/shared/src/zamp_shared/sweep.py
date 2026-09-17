"""The sweep: the only recovery path either half of this system has.

Two jobs, both driven by Cloud Scheduler once a minute against
`POST /internal/sweep` on each worker.

  1. Relay the outbox. The backend writes a `request_outbox` row inside the
     same transaction as the state change it announces, then publishes
     best-effort and swallows any error — which is correct, because a broker
     blip must not fail a request the user made. Nothing else ever retries
     that publish. Without this relay, a file whose publish failed sits at
     UPLOADED forever and no part of the system notices.

  2. Reclaim expired leases. A worker that dies mid-file leaves the row
     claimed. Once the lease runs out the file goes back to the stage it came
     from and is re-enqueued, or — if it has used up its attempts — is failed
     explicitly rather than retried forever.

Both are safe to run concurrently on every instance: the claim statements use
`FOR UPDATE SKIP LOCKED`, so overlapping sweeps take disjoint work.
"""

from __future__ import annotations

import logging

from .repositories import Database, FileRepository, OutboxRepository

log = logging.getLogger(__name__)

#: Which topic a reclaimed file goes back to, per the stage it was reset to.
_TOPIC_FOR_STAGE = {"UPLOADED": "file_uploaded", "INSPECTING": "file_uploaded", "CONVERTING": "convert_requested"}


def run_sweep(database: Database, publisher, *, topic_file_uploaded: str, topic_convert_requested: str,
              outbox_batch_size: int = 100, reap_batch_size: int = 100,
              outbox_max_attempts: int = 10) -> dict[str, int]:
    outbox, files = OutboxRepository(database), FileRepository(database)
    counts = {"published": 0, "failed": 0, "dead": 0, "reclaimed": 0, "requeued": 0}

    for row in outbox.claim_pending(outbox_batch_size):
        payload = row["payload"] if isinstance(row["payload"], dict) else {}
        attributes = {"requestId": str(row["request_id"]), "outboxId": str(row["id"])}
        if row.get("file_id"): attributes["fileId"] = str(row["file_id"])

        try:
            message_id = publisher.publish(row["topic"], payload, attributes)
            outbox.mark_published(row["id"])
            counts["published"] += 1
            log.info("relayed outbox row", extra={"outboxId": row["id"], "topic": row["topic"], "messageId": message_id})
        except Exception as exc:  # noqa: BLE001 - one bad row must not stop the sweep
            detail = f"{type(exc).__name__}: {exc}"
            # Terminal only after the retry budget is spent. Failing on the
            # first error would throw away work over a transient broker fault.
            if row["attempts"] >= outbox_max_attempts:
                outbox.mark_dead(row["id"], detail)
                counts["dead"] += 1
                log.error("outbox row is dead", extra={"outboxId": row["id"], "error": detail})
            else:
                outbox.mark_failed(row["id"], detail)
                counts["failed"] += 1

    topics = {"file_uploaded": topic_file_uploaded, "convert_requested": topic_convert_requested}
    for reclaimed in files.reap_expired(reap_batch_size):
        counts["reclaimed"] += 1
        topic = topics[_TOPIC_FOR_STAGE[reclaimed["stage"]]]
        try:
            # Through the outbox, not straight to the broker: a re-enqueue that
            # is published but not recorded is the same lost job the outbox
            # exists to prevent.
            outbox.enqueue(request_id=reclaimed["request_id"], topic=topic,
                           payload={"fileId": reclaimed["id"]}, file_id=reclaimed["id"])
            counts["requeued"] += 1
        except Exception as exc:  # noqa: BLE001
            log.error("could not re-enqueue a reclaimed file",
                      extra={"fileId": reclaimed["id"], "error": str(exc)})

    if any(counts.values()): log.info("sweep", extra=counts)
    return counts
