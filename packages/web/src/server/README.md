# The server layer

Everything behind `src/app/api/`. Nothing here is imported by a component —
every module opens with `import "server-only"`, which makes that a build error
rather than a code-review note.

```
handler.ts        the shared route wrapper: trace id, one envelope, no leaks
env.ts            configuration, read once, never at module scope
session.ts        cookie sign/verify, and resolveUser
validate.ts       body validation and filename safety
failures.ts       failure class -> HTTP status, using lib/failures copy
storage.ts        signed upload URLs; GCS or a local directory
publish.ts        Pub/Sub, or a direct hand-off to the worker locally
db/client.ts      pg pool via the Cloud SQL connector, and transaction()
db/repos.ts       SQL, with explicit row types
services/         uploads · schemas · convert
```

## The seven routes

| Route | Does |
|---|---|
| `POST /api/register` | Upserts the user, seeds their allowance, sets the cookie |
| `POST /api/getSignedUrl` | Creates the request and one signed PUT url per file |
| `POST /api/upload` | Verifies each object, advances to UPLOADED, enqueues inspect |
| `POST /api/polling/schema` | Delta poll: files the client does not already hold |
| `POST /api/updateSchema` | Saves an edit across its apply-to-all scope |
| `POST /api/convert` | **The gate.** Moves ready files to CONVERTING, enqueues them |
| `POST /api/polling/result` | Snapshot: every table, every poll |

Plus `PUT /api/dev/storage/[...key]`, which stands in for the bucket when
`STORAGE_BACKEND=local` and returns 404 otherwise.

## Rules that are structural here, not remembered

**The cookie is the authority; `requestorId` is a claim.** Every route calls
`requireMatchingUser(claimed)`, which compares the body's id against the
session and rejects a mismatch. Without that check, every "does this belong to
you" downstream verifies a value the caller chose. Reads are scoped by
`user_id` in the `WHERE` clause rather than checked after loading, so there is
no path where a row is fetched and the check is forgotten.

**No client is constructed at module scope.** `next build` has no OIDC token
and no database. A client that resolves credentials at import time fails the
build with an error that names credentials rather than timing. `next build`
currently succeeds with *no environment configured at all* — that is the test.

**A state change and its outbox row share a transaction.** Then the publish is
attempted inline, best effort, and a failure is logged and swallowed: the row
is already committed and the worker's sweep will relay it. A transient broker
error must never fail a request the user made.

**`getSignedUrl` returns one entry per name, in the order asked.** The client
matches positionally (`accepted.forEach((file, index) => signedFiles[index])`),
so filtering or reordering silently pairs a file with someone else's URL.
Nothing is rejected on format here: the contract puts pre-flight on the client,
and the real check is the inspect worker sniffing magic bytes — the only thing
that can tell a `.pdf` that is really a ZIP from one that isn't.

**The gate is re-checked server-side.** A greyed-out Convert button is a
courtesy; `convert()` recomputes "every file is SCHEMA_READY or FAILED" itself
and answers 409 with a count. Settled means ready **or** failed, so one
unreadable file never holds thirty-eight good ones hostage.

**Two schema edits exist, and the server enforces it.** `updateSchemas`
compares against `original_fields`: a renamed field is a new key plus a missing
one, and both are rejected. Every entry in the call must share the edited
schema's original `shape_hash`, and the whole call fails if one does not —
never a partial apply.

**No raw exception reaches a client.** `handler.ts` catches everything;
anything unrecognised becomes `internal` and the detail goes to the log.

## Local development

`STORAGE_BACKEND=local` swaps two things and nothing else:

- `signUpload` returns a URL pointing at `/api/dev/storage/...` instead of a
  signed GCS URL — same two-step flow, same headers, same confirm call.
- `publish` POSTs a synthetic Pub/Sub envelope straight to the worker, shaped
  so the worker cannot tell the difference and parses it with the same code.

So `docker compose up` runs the whole pipeline with no cloud account.

## What is deliberately not here

The five surfaces `contract.ts` marks as fixtures. Four of them need tables
that do not exist yet (`records`, `field_values`, `blocks`, `merges`).
`getMergeGroups` is the exception — `file_schemas.shape_hash` and
`file_schema_results` already hold everything it returns, so it is the one that
could be built today.
