# playbook.md

The long-form companion to [`../decisions.md`](../decisions.md). That file is the scannable table —
every call in four columns, each row holding the decision as it stands today. This one is the argument
behind each row: the reasoning in full, the tradeoffs named out loud, and the things I got wrong on
the first pass.

Read `decisions.md` to see *what* was decided. Read this to see *why*, and what it cost.

Entries here are **append-only and chronological**, which is the one thing the table deliberately
doesn't do. Where a decision was later reversed, the original entry stays exactly as written and a
second entry marked *(revised)* follows it — so `D17` appears twice, once as the Tika sidecar and once
as the JS libraries that replaced it. Reading them in order is reading the actual history.

Each entry: **what I chose → what else I seriously considered → why, and what I gave up → what
I deliberately cut.**

> Name note: "Quarry" — you quarry structured stone out of raw rock. The repo directory is still
> `react_DocumentConverter` from the first `mkdir`; renaming it is cosmetic and not worth a commit yet.

---

## Day 0 — 2026-09-11 — Framing and scope

### D1 · Scope on depth of capability, not on an industry vertical

**Chose.** Quarry is domain-agnostic on input. The scope boundary is a *specific hard capability* —
a resilient, self-aware extraction pipeline — rather than a *specific industry*.

**Considered.**
- A vertical: pharma regulatory documents, sales-CRM call notes, legal contracts.
- A single document type: invoices only, or resumes only.
- No boundary at all: "structure anything for anyone."

**Why, and what I gave up.** A vertical would make my differentiator *domain knowledge*, which costs
a day hunting for representative documents I don't have, and which a reviewer outside that industry
cannot verify. A single document type — invoices — is the most common answer to a brief like this and
reads as generic. And "structure anything" isn't a scope: it gives me no basis to say *no* to a feature
on day 3, which is exactly when I'll need one.

The tradeoff I'm accepting is real: with no vertical I get no domain accuracy wins. No drug-name
ontology, no invoice-specific heuristics, no "I know the third table on page 2 is always the summary."
A tuned vertical extractor will beat Quarry on that vertical's documents. I'm trading per-document
accuracy for a defensible boundary and a capability that generalizes.

**Cut.** Any domain-specific normalization (ontologies, code-system lookups, currency tables beyond
ISO-4217 parsing).

### D2 · The user is a person with a pile of lookalike documents and no engineering team

**Chose.** Primary user: someone holding **20–500 documents that share a shape**, who needs them as
rows in a table, and who cannot write a script. An ops analyst with 200 invoices. A researcher with
80 papers. A support lead with 300 tickets. A CRM admin with 150 call recordings.

**Considered.** (a) Developers — ship an API/SDK first. (b) Enterprises — multi-tenant, SSO, audit.
(c) One-document-at-a-time consumer use ("read this PDF for me").

**Why, and what I gave up.** The *pile* is what creates the pain. One document you just read yourself;
a developer with 200 writes a script in an afternoon. The person with 200 and no script is genuinely
stuck, and it is also the only user for whom the hard parts of this system — rate-limit budgeting,
partial failure, per-document status — are *felt* rather than theoretical. Choosing the pile is what
makes D6–D9 load-bearing instead of decoration.

Giving up the developer-first framing means no public API in v1, which is the thing that would make
this most extensible. Accepted: an API with no proven extraction quality behind it is not worth much.

**Cut.** Auth beyond a lightweight session, multi-tenancy, role-based access, team sharing.

### D3 · "Queryable" means typed columns plus full-text — not semantic search

**Chose.** Extracted fields become **typed Postgres columns** the user can filter, sort and aggregate,
plus **Postgres full-text search** over the raw extracted text so a document can still be found by
phrase when no field captured it.

**Considered.** (a) Structured filtering only. (b) Adding pgvector embeddings for semantic search.
(c) Natural-language → SQL over the user's own schema.

**Why, and what I gave up.** Embeddings solve *discovery over prose* — "find documents about late
payment penalties." That is a different job from the one Quarry does, which is *precision over fields*.
Adding a vector index to a 5-day build buys a nice demo moment and no product value, and it pulls in a
second index to keep in sync with the extraction pipeline. Postgres FTS is already in the datastore
I'm running, costs one column and one trigger, and covers the honest version of the need: "the field
extraction missed it, let me grep."

NL→SQL is genuinely attractive and I may revisit it on day 5 (see open question O4 in [`spec.md` §11](spec.md#11-open-questions)) — but only as a
layer on top of a query API that already works, never as the primary interface. A natural-language
box as the *only* way to query is a trust disaster when it silently returns the wrong rows.

**Cut.** pgvector, embeddings, RAG, chat-over-your-documents.

### D4 · Three of four candidate use cases survive — as adapters, not as products

**Chose.** Supported input: **PDF (digital and scanned), images, office documents, plain text/email,
CSV/JSON/XML, and audio.** One product, several adapters.

**Considered.** Building four separate flows for the four use cases I'd sketched: CRM call audio,
research PDFs (plus portal scraping), API payload analysis, and support-email sentiment.

**Why, and what I gave up.** Those four aren't four products — they're two axes. *Input modality*
(how do I get text and position out of this artifact) and *output shape* (one row per document, many
rows per document, or themes across documents). Audio→rows, PDF→rows and email→themes are the same
pipeline with a different adapter and a different schema. Treating them as one product with pluggable
adapters is what makes the third one cost a day instead of a week.

**Cut, with reasons:**
- **Video.** Large files, an ffmpeg dependency, frame sampling, and OCR-on-frames is a separate
  quality problem with its own failure modes. Audio covers the actual user need (call notes).
- **Portal scraping.** This is *acquisition*, not structuring. It drags in terms-of-service questions,
  auth flows and selectors that rot, and deepens nothing about the stated problem. A user can already
  print a page to PDF.
- **"Understand how my APIs are wired" from JSON/XML.** JSON is *already* structured; the work there is
  schema and relationship discovery over code, which is static analysis, not document understanding —
  and an LLM is the wrong primary tool for it. JSON/XML stay supported as *input formats* (a small
  adapter), but that use case is a different company.

---

## Day 0 — Architecture

### D5 · One canonical intermediate representation: `Block[]`

**Chose.** Every adapter converges on the same structure before anything else runs:

```ts
type Block = {
  id: string
  text: string
  kind: 'heading' | 'paragraph' | 'table_cell' | 'list_item' | 'utterance' | 'record_field'
  locator: Locator        // modality-specific, structurally uniform
}

type Locator =
  | { type: 'page';   page: number; bbox: [number, number, number, number] }
  | { type: 'audio';  speaker: string | null; start: number; end: number }
  | { type: 'text';   part: string; offset: number; length: number }
  | { type: 'record'; path: string }   // JSONPath-ish
  | { type: 'none' }                   // adapter could not supply a position
```

Everything downstream — chunking, extraction, validation, verification, the review UI — sees only
`Block[]`. Nothing downstream knows what a PDF is.

**Considered.** (a) Passing raw text plus a page number, which is what most pipelines do.
(b) Adopting an existing document model (Tika's XHTML output, `unstructured`'s element schema, or
Docling's document model) rather than defining my own.

**Why, and what I gave up.** The reason to pay for a custom IR is that it makes **provenance universal**.
Every extracted value stores the block IDs it came from; rendering that evidence is then one
implementation per locator type rather than one per modality. In a PDF it highlights a region on page 3.
In audio it plays 4:12–4:20 and you hear the rep say it. That is the same mechanism, and it's only
the same mechanism because the locator is a uniform shape.

Adopting an existing model would have been less code, but every one of them is document-shaped — none
has a notion of "this claim came from these three spans," and none accommodates audio timestamps in
the same field as page coordinates. I'd have ended up wrapping it anyway.

What I gave up: a custom IR is a thing to maintain, and the adapters have to do real work to produce
good `bbox` values. Where an adapter can't produce a locator (Tika's text output for a `.doc`, for
instance) it emits `{ type: 'none' }` and the UI says "source position unavailable" rather than lying.

**Cut.** Reading-order recovery, table stitching across page boundaries, merged-cell handling,
de-skewing rotated scans. This was a serious candidate for the hard problem to own and I rejected it:
entire companies exist to do only this, and I would be rebuilding Textract and losing. Quarry *uses*
those engines and is honest about where they fail.

### D6 · The pipeline is a durable state machine, not a function call chain

**Chose.** `stage` is a **column on the document row**, not a position in a call stack. The worker loop
is: claim a document, advance it exactly one stage, commit, release. Stages:

`detect → extract → chunk → infer → validate → verify → commit`

**Considered.** (a) A synchronous request that does the whole pipeline and returns the result — the
obvious first design, and the one my first architecture sketch implied. (b) An in-memory job queue
(BullMQ, or a `Promise` pool) with progress pushed over WebSocket.

**Why, and what I gave up.** Resume-after-crash is not implementable in either alternative, and it was
the first thing I said I wanted. If the pipeline is a call chain, a crash during `infer` loses
everything back to upload — including the extraction work and the tokens already spent. With `stage`
as a column, a restarted worker re-claims that document *at* `infer`. The same column gives me
per-document status for honest degradation and a natural place to record which stage failed and why.

The cost is that every stage boundary must serialize its output to the database, which means more
writes and a schema for intermediate state. For documents of the size I'm targeting that is cheap, and
it buys observability I'd otherwise have to build separately.

### D7 · The queue is Postgres, not Redis or SQS

**Chose.** `SELECT … FOR UPDATE SKIP LOCKED` over the documents table.

**Considered.** (a) Redis + BullMQ. (b) AWS SQS, since I have credits. (c) A managed queue
(Inngest, Trigger.dev, QStash) — all of which have usable free tiers.

**Why, and what I gave up.** `SKIP LOCKED` is a genuinely correct queue with safe concurrent claim
semantics, and it keeps me to **one datastore**. Two datastores means two things to provision in
`docker compose`, two things a reviewer has to have running, two consistency stories, and a whole class
of bug where the job row and the queue message disagree about reality. Postgres also gives me the thing
a real queue makes hard: I can `JOIN` the queue against the data.

SQS was the closest call, since the credits make it effectively free for me. I rejected it because it
would make the project un-runnable without an AWS account, which directly damages the setup
experience (D16).

What I gave up: Postgres-as-queue does not scale the way SQS does, and waiting for work costs me a
`LISTEN/NOTIFY` or a short sleep loop rather than a blocking receive. At the throughput one worker
handles, neither matters.

### D8 · Uploads go browser → blob store directly, never through the API

**Chose.** The browser asks the API for a presigned URL, `PUT`s the file straight to the blob store,
and the API only ever sees a **file key**.

**Considered.** `multipart/form-data` to an API route that streams to storage — the normal thing.

**Why.** I checked the deployment constraints before designing, and found a wall: **Vercel caps request
bodies at 4.5 MB on every plan, including paid.** Function duration on Hobby is 60s by default. A 30 MB
scanned PDF or a 40-minute audio file cannot go through an API route at all. Presigned upload removes
the ceiling entirely, keeps large payloads off my compute, and is how production systems do this
regardless of platform.

The tradeoff is more moving parts in the upload flow — the client does two round trips, and I need a
`pending` blob state so an abandoned upload doesn't leave an orphan row. Worth it; the alternative is
an architecture that fails on a real document.

**Cut.** Resumable/chunked upload (tus, S3 multipart). A single `PUT` with a retry covers files of the
size I'm targeting; chunked upload is the right answer at 1 GB and irrelevant at 40 MB.

### D9 · Model access goes through a router, and no code names a vendor

**Chose.** A `ModelProvider` interface behind a router that tracks each provider's remaining
rate-limit budget and falls through an ordered chain on exhaustion or failure. Primary **Gemini free
tier**, overflow **Bedrock** (AWS credits), fallback **Groq**.

**Considered.** Calling one provider's SDK directly — my first sketch literally had a box labelled
"GPT / GPT-OSS" — or using an aggregator (OpenRouter, the Vercel AI SDK, LiteLLM) as the abstraction.

**Why, and what I gave up.** Provider switching was on my must-have list, and a box with a model name
in it cannot switch. More importantly, the *binding constraint on this project is requests-per-day,
not price* — every free tier is rate-limited, so exhaustion is the normal operating condition rather
than an edge case. That has to be a first-class concept in the router, and no aggregator models my
per-user budget ledger for me.

Gemini is primary for one concrete reason: it accepts **PDFs and images natively**, which deletes an
entire OCR subsystem from the critical path. It's also a permanent rate-limited tier rather than
burn-down trial credits.

One honest caveat recorded here: Google **no longer publishes per-model free-tier numbers** in its
public docs — they're only visible in the AI Studio dashboard for your own account. So the router's
budget config is read from environment variables I set from my own dashboard, not from a hardcoded
table copied off a blog post that will be stale within a quarter.

**Cut.** Using an aggregator as the primary abstraction (adds a dependency and a single point of
failure between me and every model), and any attempt at automatic cost-optimal model selection. The
chain is explicit and ordered.

### D10 · An explicit validate → coerce → repair stage between the model and the database

**Chose.** A distinct pipeline stage that takes the model's raw JSON and either lands it in the
schema's types or fails it with a reason. Deterministic coercion first (`"4,200.00 USD"` → `4200.00`
plus `currency: "USD"`; five date formats → ISO-8601), then **exactly one** repair retry that sends the
validation error back to the model, then give up and mark the field unresolved.

**Considered.** Trusting the provider's structured-output / JSON-mode guarantee. Retrying until it
parses. Parsing loosely and storing everything as text.

**Why, and what I gave up.** Structured output guarantees you get *syntactically* valid JSON matching a
shape. It does not give you a number when the document says "four thousand two hundred," it does not
disambiguate `31/01/2026` from `01/31/2026`, and it will happily return a confidently wrong value for a
field that isn't in the document at all. This stage is where extraction quality actually lives, and my
first architecture sketch had no box for it — the arrow went straight from "LLM PROCESSING" to
"NORMALIZED JSON," which hid the hardest part of the job.

Capping repair at one retry is a deliberate spend limit: unbounded retries against a rate-limited free
tier is how you burn a day's quota on one malformed document.

### D11 · Provenance is core. Calibrated confidence is cut.

**Chose.** Every extracted value stores the block IDs it came from, and the UI can show you that
evidence. Alongside it, a **rule-based** `needs_review` flag from deterministic verification — do line
items sum to the stated total, is the date inside a plausible range, is the currency consistent across
fields, did two independent extractors disagree.

**Considered.** A full calibrated-confidence model: per-field probability, logprob-derived where
available, validated against a labelled set and plotted on a reliability curve.

**Why, and what I gave up.** Provenance and rule-based verification get roughly 80% of the value for
maybe 20% of the effort, *because* the `Block` IR (D5) already carries locators — the expensive part is
already paid for. Calibration is the research-shaped part: it needs a labelled evaluation set I don't
have and a day I can't spare, and an uncalibrated number rendered as "87% confident" is worse than no
number at all, because it invites trust it hasn't earned.

So Quarry shows evidence and a binary "I'd check this one," not a false precision. The honest version
of the feature.

**Deferred, not cut** (in priority order, if days 4–5 allow): schema inference from a document pile
(cluster the pile, propose columns per cluster); second-opinion cross-checking via Textract against
the LLM, where *disagreement* is the confidence signal.

---

## Day 0 — Stack and infrastructure

### D15 · TypeScript end to end, in one monorepo

**Chose.** React + Vite + TypeScript on the front, Node + Fastify + TypeScript on the back, one pnpm
workspace, shared types package.

**Considered.** A Python backend (FastAPI) with a React front end — the conventional choice for
anything document- or ML-adjacent, and where the better libraries live (`pdfplumber`, `unstructured`,
`docling`, local `whisper`, pandas).

**Why, and what I gave up.** The decisive factor is that Quarry is a **schema-driven** application, and
in TypeScript the schema is *one definition with four uses*: the user's field list compiles to a Zod
schema, which (1) generates the JSON Schema sent to the model, (2) performs the coercion and validation
in D10, (3) produces the TypeScript types the API and worker share, and (4) types the front-end table.
In a split-language stack that definition exists twice and drifts. For this particular app that isn't a
convenience argument, it's an architecture argument.

What I lose is the Python document ecosystem, and I'm covering it deliberately: **Tika** (D17) for broad
format extraction, **Gemini's native PDF handling** (D9) instead of a local OCR stack, and **Whisper via
Groq's API** rather than local inference. No Python needed, one language for a reviewer to read.

Secondary reason, stated honestly: one language is the right call for a 5-day build graded on whether
the code is something you'd hand to a teammate.

### D16 · `docker compose up` must work with zero cloud accounts

**Chose.** Every external dependency sits behind an interface with a local implementation. Blob storage
→ S3 *or* local disk. Models → cloud providers *or* a recorded-fixture provider. Transcription →
Groq/Transcribe *or* fixtures. A stranger clones the repo, runs one command, and gets a working app
with sample documents already loaded.

**Considered.** Building directly against AWS, since I have credits — S3, RDS, SQS, Textract,
Transcribe, App Runner. It would genuinely be faster to build, and it gives me a real always-on worker,
which is the one thing free tiers withhold.

**Why, and what I gave up.** Setup experience is explicitly graded, and an app that needs an AWS account
with six provisioned services **cannot be run by a stranger in one shot**. There's a second, less
obvious cost: AWS is a time sink, and IAM/VPC/security-group work can eat a full day out of five with
nothing to show a reviewer.

So AWS is used where it buys something I can't get free, and nowhere else: **Transcribe** for speaker
diarization (D19), **Textract** as a cross-checking second opinion, and a container for the always-on
worker. Postgres is **Neon** rather than RDS — serverless, branching, and no VPC to fight.

What I gave up: the fixture-based local mode is extra code, and it can drift from real provider
behaviour. Mitigated by running the golden-file suite against both.

### D17 (superseded) · Apache Tika, as a sidecar container

**Chose.** Tika Server as its own container, called over its REST API, for the long tail of formats
(`.docx`, `.xlsx`, `.pptx`, `.doc`, `.rtf`, `.odt`, `.msg`, `.eml`, and several hundred more).

**Considered.** Per-format JS libraries (`mammoth`, `xlsx`, `pdf-parse`) — no JVM, smaller image, but a
dependency per format and a quality cliff on anything unusual. Or `unstructured`/Docling, which would
have meant reintroducing Python and undoing D15.

**Why, and what I gave up.** Tika's format coverage is not reproducible by hand in five days, and a
sidecar keeps the JVM entirely out of my application process — the API stays a small Node image and
Tika's memory profile is somebody else's problem.

The honest cost, and it's a real one: **the JVM makes this stack undeployable on serverless.** No
Vercel functions, no Cloudflare Workers for that stage. I was already committed to a long-running
worker for D6, so this cost was largely pre-paid — but it does mean a container platform is now
mandatory rather than preferred, and Tika is the single largest thing in `docker compose`.

Tika output often carries no position information, which degrades provenance for those formats. Handled
per D5: emit `{ type: 'none' }` and say so in the UI.

### D19 (superseded) · Speaker diarization via AWS Transcribe

**Chose.** For audio, AWS Transcribe with `ShowSpeakerLabels`, falling back to Groq's Whisper
(transcription only, no speaker labels) when credits or the service are unavailable.

**Considered.** Whisper alone — which transcribes well and has **no concept of who is speaking**. Or
`pyannote` for diarization, which is the good open option and needs Python plus a GPU.

**Why.** For the call-notes use case, *who said it* is most of the meaning: "they weren't happy with the
pricing" is a different fact depending on whether the rep or the customer said it. I had written this
off as the hard part I'd have to be publicly honest about failing — until the AWS credits turned it
into a configuration flag instead of a research project. This is the clearest single win from having
credits.

When the fallback path is taken, utterances carry `speaker: null` and the UI shows the transcript
without attribution rather than guessing. Degrade honestly.

**Cut.** Video (per D4), any local ASR, and emotion/sentiment-from-audio-tone.

### D20 · The output is a queryable table. Not a dashboard.

**Chose.** Extraction produces rows. The UI is a data grid over those rows, plus a review queue for
anything flagged, plus the evidence panel.

**Considered.** My first sketch ended in three boxes: Charts, Tables, Insights.

**Why.** "Charts" and "Insights" are two more products, and "Insights" in particular is a box that
expands without limit — there is no state in which it is finished. A table you can trust, filter and
export is a complete product; a chart on top of a table you can't trust is decoration on a liability.
Export to CSV/JSON is the escape hatch: anyone who wants a chart already has Excel.

**Cut.** Charts, dashboards, "insights," scheduled reports, alerting.

---

---

## Day 0 (later) — Stack lock

D1–D20 were written before the stack was picked line by line. Reviewing a conventional "AI SaaS
prototype" stack against the design surfaced three rows that would have broken the build outright,
and about ten missing rows sitting directly in the critical path. The tell: the generic stack
describes a *dashboard app*. Quarry is a *pipeline*.

The three that would have broken it, recorded because near-misses are worth more than clean wins:

1. **Next.js as the backend** → no long-running worker → no resume-after-crash. The first thing I
   said I wanted, gone.
2. **Vercel as deployment** → cannot host the worker *or* a JVM sidecar. I'd have discovered this on
   day 4.
3. **OpenAI named in the architecture** → no provider switching and no free tier, contradicting two
   stated constraints at once.

### D18 · The frontend is a static SPA built with Vite, not SSR

**Chose.** A Vite single-page app that builds to a folder of static files, talking to the API over
HTTP and SSE.

**Considered.** Next.js with SSR, using Route Handlers or Server Actions as the backend — which is
what the generic stack proposed, on the argument that it "gives you backend capabilities too."

**Why, and what I gave up.** That argument is the trap. Route handlers are request-scoped: they wake
on a request, run, and die. A worker is a `while(true)` loop that claims jobs from a queue and never
returns. You cannot build one out of the other, so Next gives you the *illusion* of a backend and you
end up building the worker separately anyway — having paid for the framework twice.

SSR also buys nothing here on its own merits. Every page sits behind a session, renders private data,
has zero SEO value, and is highly interactive. Server-rendering would produce an empty table and then
fetch everything on the client regardless.

The practical payoff: a static build is `index.html` plus JS and CSS, which any free static host will
serve on a global CDN with a real HTTPS URL.

**Cut.** Server Actions on the pipeline path specifically — they're await-the-result RPC, and the
whole model here is enqueue-and-poll.

**On Vite specifically.** This was left open for a while, because the architectural case above is
satisfied by Next with `output: 'export'` too — the API and worker are separate processes either way,
and on a five-day clock familiarity is a legitimate tiebreaker against elegance. Settled on Vite: once
Route Handlers and Server Actions are off the table, nothing in Next is actually being used, and
carrying a framework for the parts you've disabled is a cost with no matching benefit.

### D21 (revision 1) · The worker runs inside the API process, behind an env var

**Chose.** One Node process. `startWorkerLoop()` runs after `server.listen()` when `RUN_WORKER=true`.

**Considered.** A separate always-on worker service, which is what D6 originally implied and what
you'd do in production.

**Why, and what I gave up.** Free tiers charge for background workers and don't charge for web
services. One service is one deploy, $0, and a single set of logs. Splitting them later is one
environment variable — the code does not change, because the claim loop never cared what process it
was in.

What I gave up is independent scaling: the worker's CPU burn now competes with request handling in
the same 512 MB. At one worker and a few hundred documents that's theoretical. Saying it's the wrong
shape for a real system is worth more than pretending it isn't.

### D22 · Drizzle, not Prisma

**Chose.** Drizzle ORM with plain-SQL migrations.

**Considered.** Prisma (the generic stack offered "Prisma or Drizzle" without picking), or raw `pg`.

**Why.** D7 needs `SELECT … FOR UPDATE SKIP LOCKED`, and Prisma makes raw SQL awkward enough that the
most load-bearing query in the system becomes a fight. Prisma also adds a codegen step to the setup
path — which is a graded criterion — and ships a heavy client. Drizzle is SQL-shaped, so a reviewer
reading `migrations/` reads SQL rather than a DSL.

### D7 (expanded) · Postgres, and the honest case against Mongo and MySQL

**Chose.** Postgres does four jobs: the data, the queue, the job state, and full-text search.

**Considered.** MongoDB and MySQL 8.

**Why, and what I gave up.** *Against Mongo:* Mongo is right when every document has a different
shape — but the entire product is "take things of different shapes and make them one shape." The
output is tabular and typed on purpose; `SUM(total) GROUP BY vendor` *is* the product. Two specifics
beyond that: Mongo has no `SKIP LOCKED`, so the queue degrades into hand-rolled status flags with a
race condition waiting in it; and the provenance model is relational — a row has fields, a field
cites blocks, a block belongs to a document. That's joins.

The honest argument *for* Mongo is that user-defined schemas mean the column set varies per batch.
The answer is `jsonb`: Postgres does documents too. Postgres is the superset; Mongo doesn't do
relational.

*Against MySQL:* much closer, and it would genuinely work — `SKIP LOCKED` exists there too. Postgres
wins on four specifics rather than on taste: `jsonb` with GIN indexes is far stronger than MySQL's
JSON, full-text search is built in and good, `LISTEN/NOTIFY` lets the worker wake instantly instead
of polling, and array columns (`block_ids text[]`) match the provenance model directly. Free
serverless Postgres is also easier to come by than free MySQL.

### D18 (detail) · Tailwind + shadcn/ui + TanStack Table + pdf.js

**Chose.** Tailwind for styling, shadcn/ui for components, TanStack Table for the grid, pdf.js for
rendering document pages.

**Considered.** shadcn's own table alone; a commercial grid (AG Grid); Material UI.

**Why.** Radix underneath shadcn means real keyboard navigation for free, and the review queue (§3.7
of the spec) is explicitly a keyboard loop — that's not a styling concern, it's the feature. shadcn's
table is presentational; 500 rows with sort, filter and virtualization needs a real table library.
pdf.js is load-bearing rather than a nicety: the evidence panel has to draw a highlight box at a
bbox on page 3, which means rendering the page ourselves.

**Cut.** AG Grid (heavy, and the licence question isn't worth it), Material UI (fighting a design
system costs more than composing one).

### D14 · SSE for live progress, not WebSocket

**Chose.** Server-sent events from the `run_events` table.

**Considered.** WebSocket; client polling on an interval.

**Why.** Progress is strictly one-directional, server → client, which is exactly SSE's shape. It's
plain HTTP, so it survives free-tier proxies, needs no second protocol in the stack, and reconnects
on its own. Polling would work but produces a choice between staleness and load, and there's no
reason to accept either.

The nice second-order effect: because the stream is backed by an events *table* rather than in-memory
pubsub, the user sees exactly the same timeline the developer reads in the logs, and it survives a
refresh.

### D2 (extended) · Anonymous signed-cookie session, no login

**Chose.** A `user_id` created on first visit and stored in a signed cookie. No email, no password,
no account.

**Considered.** Clerk or Supabase Auth — which the generic stack listed as "only if you have time."

**Why.** This is deliberately *less* than the obvious answer, not a shortcut. Something has to own
the budget ledger and the batches, and that's the entire requirement. Auth as a feature is already
out of scope (D2). Meanwhile a sign-up wall in front of first run directly damages a graded
criterion — a reviewer who has to create an account before seeing anything has already had a worse
experience than one who doesn't. No sign-up is a feature, not a gap.

### D23 (revision 1) · Vitest + Testcontainers + Playwright, with a fixture model provider

**Chose.** Unit and property tests in Vitest, queue and crash-recovery tests against a **real
Postgres** in Testcontainers, end-to-end in Playwright, and a fixture provider that replays recorded
model responses.

**Considered.** Mocking the database; unit tests only; running against live providers in CI.

**Why.** `SKIP LOCKED` concurrency **cannot be mocked** — the property under test is that two workers
racing for one row get different rows, and that's a database behaviour, not application logic. A mock
would test my belief about Postgres rather than Postgres. Same for lease expiry and reclaim.

The fixture provider is what makes the suite run offline with no API key and no spend, which matters
twice: CI stays deterministic, and a stranger who clones the repo can run the tests without signing
up for anything. Recorded responses are refreshed against live providers on demand, never in CI.

---

## Day 0 (later) — The post-AWS rebuild

The AWS credits turned out to belong to a **work account**, and this is a personal interview project.
Using an employer's credits for it isn't a line worth crossing, so they're out — and three decisions
die with them. Writing the reversals is better than quietly rewriting history.

The surprise is that the free constraint makes the architecture *more* interesting, not less. One
part of it is genuinely better.

### D16 (revision 1) · A 100% free stack, and why the free tier's worst property is the best demo

**Chose.** Static host (Cloudflare Pages or equivalent) for the SPA, Render's free tier for one
container running API + worker, Supabase for Postgres and file storage, Gemini's free tier for
models, Groq for transcription. Total cost $0, four or five sign-ups, about thirty minutes.

**Considered.** AWS on the credits: S3 + CloudFront for the front end, App Runner or a `t4g.small`
EC2 box running the same `docker compose`, RDS or Neon for Postgres, Transcribe and Textract. At
~$12–15/month for the box it would have left ~$130 for models, and it buys the one thing free tiers
withhold: an always-on worker.

**Why, and what I gave up.** The ownership problem settles it on its own. Beyond that, the free path
costs exactly three things, and two of them are fine:

1. **Format coverage shrinks** — no JVM, so no Tika (D17). Acceptable and written down.
2. **Acoustic speaker labels are gone** — the real loss at the time, and the reason for the revised D19 below.
3. **The service sleeps after 15 minutes idle**, with a ~50 s cold start.

That third one looked like the worst of them and turned out to be the best thing on the list.
**Sleep is just a crash, and D6 already survives crashes.** If the service falls asleep while
document 87 of 200 is mid-extraction, nothing is lost: `stage` is a column, so when the next request
wakes the process the worker re-claims document 87 *at the stage it was in* and carries on. That is
demonstrable in ten seconds — close the tab, come back, watch it resume — and most submissions can't
do it. A platform limitation became the live proof of the architecture's central claim.

The other payoff: the deployed box runs the same `docker compose` as a laptop, so dev and prod are
the same thing and "works on my machine" stops being a category of risk.

**Cut.** AWS entirely — Bedrock, Transcribe, Textract, S3, RDS, App Runner. Everything else is a
like-for-like swap, which is only possible because every vendor already sits behind an interface per
D16. That principle survives the reversal completely intact; it's now the deployed shape too, not
just the local one.

### D17 (revision 1) · Per-format JS libraries instead of Tika

**Chose.** `pdfjs` for PDF text and positions, `mammoth` for `.docx`, `xlsx` for spreadsheets,
`mailparser` for `.eml` — roughly eight formats, all in-process.

**Considered.** Keeping the Tika sidecar from D17.

**Why, and what I gave up.** Purely a resource ceiling. A JVM idles at 300–500 MB before doing any
work; the free tier gives 512 MB total, which also has to hold Node, the API and the worker. It does
not fit — this is arithmetic, not preference.

| | Tika (JVM) | JS libraries |
|---|---|---|
| Formats | ~1,000 | ~8 |
| Idle RAM | 300–500 MB | ~0 (already in Node) |
| Fits the free tier | ✗ | ✓ |

What I gave up is the long tail: `.doc`, `.odt`, `.rtf`, `.msg`, and the several hundred rare formats
Tika handles well. The eight that remain — PDF, images, `.docx`, `.xlsx`, CSV/JSON, `.eml`, audio —
cover everything the four use cases in D4 actually produce.

One accidental improvement: `pdfjs` gives us a real text layer with positions, where Tika frequently
gave none. Provenance for PDFs gets *better* under this reversal; it's only the rare formats that
lose, and those now fail with `format_unsupported` and a real message rather than degrading to
`{type:'none'}`.

### D20 (revised) · Charts and animations are back — as pipeline observability

**Chose.** Un-cut D20's blanket ban. Two things go back in, in priority order: a **live pipeline
visualization**, and ordinary "chart this column" on the results table.

**Considered.** Holding the line on D20. Or putting back ordinary dashboard charts with no reframe.

**Why, and what I gave up.** Two reasons, one of them a correction to my own reasoning.

The first is a straight product argument that D20 got wrong. My objection to the resilience bet has
always been that it's *invisible* — a reviewer cannot see provider switching, budget accounting, or a
batch parking on quota and resuming. But you can **draw** it: documents flowing through the seven
stages, the provider chain with one link greyed out because its quota is spent, throughput over time,
the queue draining. That isn't decoration on a liability, which is what D20 correctly objected to.
It's the invisible half of the build made visible, and it's a chart nobody else submitting this will
have thought to build.

The second is about who is building it. Cutting the strongest skill of a UI-strong builder in order
to protect an architecture is a bad trade, and D20 made it without noticing.

**What survives from D20:** "insights", scheduled reports and alerting stay cut — those are the parts
that expand without limit. And two conditions keep this from eating the build: plain CSS transitions
first with Motion added on day 4–5, and the pipeline chart is day-4 work while data charts are day-5.
Animation polish never takes time from the pipeline.

The animations that earn their place, specifically: rows re-sorting as documents finish (which makes
"4 done, 40 transcribing" legible at a glance), and the evidence panel sliding in while the highlight
box draws itself on the page — that one *teaches* the connection between a cell and its source.

### D9 (revised) · The router chain becomes Gemini free → Groq → fixtures

**Chose.** Gemini's free tier primary, Groq as fallback, the fixture provider for tests and offline
runs.

**Considered.** Bedrock (Claude Haiku) primary on credits with Gemini as the post-credits fallback —
which was the plan for about an hour, and was genuinely better on the merits.

**Why, and what I gave up.** Bedrock is an AWS service, so it goes with D16. What that costs is
concrete and worth recording, because it was attractive:

- **Native PDF input** with no OCR step, capped at 100 pages per request — exactly what the `chunk`
  stage exists for.
- **Built-in citations.** Enabling citations returns the `cited_text` and the page number it came
  from — *provenance handed over by the model*, which would have strengthened D11 significantly.
- **Batch API at 50% off**, asynchronous, which is already the shape of this pipeline, plus prompt
  caching that would hit on every document because the schema and instructions are byte-identical
  across a batch.
- Cost was never the constraint: ~1.2¢ for a 5-page PDF, well under a cent with caching and batch.
  $160 is thousands of documents. The two-month expiry was the real limit even before ownership
  settled it.

Gemini keeps the one property that mattered most: it **reads PDFs and images natively**, which
deletes an entire OCR subsystem from the critical path, and its free tier is permanent rather than
burn-down trial credits. That matters for a submission — if a reviewer opens the URL three months
from now, a burn-down account is dead and a free tier still answers.

One honest caveat: Google no longer publishes per-model free-tier numbers in its public docs; they're
visible only in the AI Studio dashboard for your own account. So the router's budget config is read
from environment variables I set from my own dashboard, not from a hardcoded table copied off a blog
post that will be stale within a quarter (open question **O2**).

---

## Day 0 — Decisions that were made in the spec but never logged here

These were settled while writing `docs/spec.md` and deserve entries of their own.

### D12 · The failure taxonomy is a first-class artifact

**Chose.** A closed set of failure classes, each with an example, a defined response, and the exact
sentence the user reads. No unclassified error reaches the UI.

**Considered.** Conventional error handling — try/catch, log it, show "something went wrong," retry
on failure.

**Why.** This is the core bet of the build, and it's the difference between *graceful* degradation
and *honest* degradation. Graceful means the app doesn't crash. Honest means the user is told which
of their 200 documents didn't work, why, and what to do about it — "This PDF is password protected.
Remove the password and re-upload" rather than a red toast.

The single most important line in the taxonomy: **quota exhaustion is not an error.** On a free tier
it's the normal operating state, so the batch parks with a resume time and the UI says
*"Daily model quota used up. Resuming at 14:32."* An architecture that treats its normal state as an
exception will lie to the user every day.

**Cut.** Retrying everything. Non-retryable classes (`format_*`, `provider_refused`) dead-letter
immediately — retrying a password-protected PDF four times is just burning quota to reach the same
answer.

### D23 (detail) · The nasty-document corpus is built on day 1, before features

**Chose.** ~20 deliberately hostile fixtures committed before any feature work, each with a golden
expectation — and for several of them **the correct expectation is a specific failure class**.

**Considered.** Building the corpus as features land; testing the happy path first and adding edge
cases later.

**Why.** A system whose entire thesis is partial failure cannot be validated by happy-path tests.
Writing down "the correct result for this file is `format_corrupt`, and the user should read *this
sentence*" is what turns D12 from a design document into something executable — and it's the part
most people skip, because it feels like testing the thing that doesn't work.

Building it first also means the failure taxonomy is discovered from real files rather than imagined
at a whiteboard. The `.docx` renamed to `.pdf` is in there because that's a thing people actually do.

### D13 · Schemas are versioned; rows remember which version produced them

**Chose.** A schema carries a version. Every extracted row records the schema version it was produced
under, and the UI marks rows as stale when their schema has moved on.

**Considered.** Mutating schemas in place; or re-extracting the whole batch on any schema change.

**Why.** Editing a field label must not silently invalidate 200 rows, and it must not silently
*re-run* them either — re-extraction costs real quota on a rate-limited tier, which the user would be
spending without being asked. Marking staleness is cheap, honest, and leaves the decision where it
belongs.

### D19 (revision 1) · Whisper transcribes, the model infers who was speaking

**Chose.** Groq Whisper produces timestamped utterances. A second model call then segments those
utterances into speaker turns and labels the roles from *what is said*. Every label the UI renders is
marked **"speaker inferred from context."**

**Considered.** (a) Acoustic diarization via AWS Transcribe — the original D19, gone with D16.
(b) Degrading honestly: timestamped text, `speaker: null`, and a UI note that attribution wasn't
available. (c) `pyannote`, the good open-source option, which needs Python and a GPU and would undo
D15 for one feature.

**Why, and what I gave up.** Whisper is excellent at *what was said* and has no concept of *who said
it* — the two are separate problems and only one of them has a free solution. For the call-notes use
case that gap is most of the meaning: "they weren't happy with the pricing" is a different fact
depending on whether the rep or the customer said it, and a transcript that can't tell you which is
barely more useful than the audio file.

So rather than drop the use case or ship an unattributed wall of text, infer the turns from content.
"So what would this cost us?" is obviously the customer. "Let me walk you through the tiers" is
obviously the rep. It costs one extra model call on a transcript that's already in hand, and it is a
genuine solution to the hard part using a different tool than the one everybody reaches for.

What I gave up is accuracy on the cases where content doesn't disambiguate — two people discussing
the same thing in the same register, or a three-way call. The mitigation is the labelling, and it's
load-bearing: this is **not** diarization, it is never presented as diarization, and where the
inference is weak the utterance carries `speaker: null` rather than a confident guess. That is the
same posture as D11 — show what you actually know, and say plainly where the knowledge stops.

**Cut.** Any acoustic approach, local ASR, and emotion-from-tone (per D4 and D19).

---

## Day 0 (later) — The Python turn

Three long side-conversations about the problem space converged on a stack recommendation that kept
moving - full-stack Next.js, then a .NET API with a Python worker, then all-Python. The last one
stuck, and it reverses more of this file than any previous change: D15, D17, D19, D21 and D22, plus a
piece of D9.

The trigger wasn't a benchmark. It was that once the adapter list was final, the dependency list read
as Python - PyMuPDF, python-docx, openpyxl, pandas, pytesseract - and it is a bad idea to fight your
own dependency list in a five-day build.

### D15 (revised) · Python on the backend, TypeScript only in the browser

**Chose.** FastAPI for the API, a separate Python worker, Pydantic as the schema engine. React and
TypeScript survive in the frontend and nowhere else.

**Considered.** TypeScript end to end with one shared Zod package - the original D15, held for as
long as the adapter list was still open. And a .NET API with a Python worker, which leverages existing
skills but pays for two languages without buying anything the split doesn't already give you.

**Why, and what I gave up.** The original argument for TypeScript was never "TS is better" - it was
*one definition with four uses*: the user's field list compiles to a Zod schema which generates the
model's JSON Schema, performs coercion, types the backend, and types the grid. That argument does not
die under Python, it shrinks. **Pydantic does three of the four.** JSON Schema generation, coercion
and validation (D10), and backend types all come from one Pydantic model exactly as they did from one
Zod schema.

The fourth use is what I actually gave up. The frontend's types now come from FastAPI's OpenAPI
output via a generator, which is a build step and a genuine drift surface - the thing
TypeScript-everywhere uniquely didn't have. The mitigation is unglamorous and sufficient: generate in
CI, fail the build on a diff.

The second loss is subtler and worth recording because it will cost an afternoon: **PDF work now
happens in two engines.** PyMuPDF extracts bboxes server-side; pdf.js draws them in the browser. Two
coordinate systems that have to agree, and when a highlight lands four pixels off on a rotated page
that seam is where the bug lives. Mitigation: store bboxes as **fractions of page width and height**
rather than raw points, so the renderer never needs to know what units the extractor used.

What the reversal buys: one language across API and worker, the document ecosystem where it actually
lives, and - honestly - a stack the person building it will move faster in.

### D17 (revision 2) · Python per-format libraries, with MarkItDown as a named escape hatch

**Chose.** PyMuPDF, python-docx, openpyxl, pandas and the standard-library `email` module. MarkItDown
is written down as the escape hatch, not installed.

**Considered.** Tika (gone two reversals ago), the TypeScript library set (gone with D15),
**Unstructured** as the foundation, and MarkItDown *as* the foundation rather than the fallback.

**Why, and what I gave up.** Unstructured is the closest conceptual match to Tika and escapes the JVM
- but not the deployment complexity: its full install wants LibreOffice, Poppler, Tesseract and
Pandoc. You trade a Java runtime for four system packages, which is not obviously a trade.

MarkItDown is the better idea and the wrong foundation. One Python dependency that converts most
things to Markdown is genuinely useful, but building *on* it means every format is as good as
MarkItDown's worst-case output, and PDF is the format we care most about. So it goes in the file as a
named fallback: when a real user file arrives in a format the explicit list doesn't cover, reach for
MarkItDown instead of writing a new adapter or apologising. Escape hatches written down in advance
are worth more than escape hatches discovered at 2am on day 4.

One genuine upgrade from the TypeScript set: **PyMuPDF is better than pdfjs at text-with-bbox**, and
bbox quality is exactly what D5's provenance is built on.

### D24 · Images take two passes, because the two tools return different things

**Chose.** Tesseract runs in `extract` and produces `Block[]` with word-level bounding boxes. The
vision model then reads the same image in `infer` for meaning.

**Considered.** Tesseract alone, with the model never seeing the image. The vision model alone -
which is what D9 originally claimed, "deletes an entire OCR subsystem from the critical path." And a
cloud document-AI service: Textract, Azure Document Intelligence, Google Document AI.

**Why, and what I gave up.** D9's claim was right about *meaning* and wrong about *position*. A vision
model takes the image in the same request as the schema and reads it directly - no OCR service, no
second key, no extra hop. But it returns text, not coordinates, and asking a model for bounding boxes
gets you plausible numbers rather than correct ones.

Tesseract is the mirror image: word boxes with pixel accuracy, and no understanding of what it read.

Running both costs one local CPU pass per image and buys the thing that would otherwise be the
weakest surface in the product. Without it, a scanned invoice - the single most likely file a user
uploads - is the one document type where clicking a cell says *"source position unavailable."* With
it, scans highlight exactly like digital PDFs.

Two things made this affordable that weren't true when Tesseract was first cut: the hosting target is
now a container platform where a system package is one Dockerfile line, and Tesseract is free in
**quota** as well as in money - and quota, not money, is the scarce resource (D9).

**Cut.** Cloud document-AI services. They're better than Tesseract at forms and tables, but they cost
money, add an account to the setup path, and buy accuracy on a dimension D5 already declined to
compete on.

### D19 (revision 2) · Hosted Whisper only

**Chose.** Groq's hosted Whisper. No local model.

**Considered.** Local `faster-whisper` as the no-key path; and `pyannote`, which became *technically*
reachable the moment the stack turned Python.

**Why, and what I gave up.** Local Whisper pulls 1-2 GB of dependencies for a modality that isn't the
core of the product, and it's slow on CPU. pyannote was rejected earlier for needing "Python and a
GPU" - Python arrived, the GPU didn't, and a HuggingFace token plus a heavy model download is a lot
of setup friction for a feature D19 already solves differently.

The cost is precise and worth stating: **audio is now the one modality with no offline path.**
`docker compose up` can transcribe nothing without a Groq key, so the fixture provider has to cover
audio for D16's zero-account property to hold. That's a test-fixture obligation, not a caveat to
gloss over.

### D21 (revision 2) · The worker is a separate service again

**Chose.** API and worker are separate processes, deployed separately from one repo.

**Considered.** The single process behind a `RUN_WORKER` flag - which was correct for exactly as long
as the target was a free tier that bills background workers.

**Why.** That constraint is gone, and the original shape was always the right one: transcription and
extraction take minutes, request handling takes milliseconds, and they have completely different
scaling and restart profiles. Sharing a process means a 40-minute audio file competes with every API
call.

This costs two deploys instead of one and a shared package both must install. It's cheap because D6
already made it possible - the two services share no memory, only rows.

### D22 (revised) · SQLAlchemy Core + Alembic

**Chose.** SQLAlchemy Core with raw SQL where it matters, Alembic for migrations.

**Considered.** Drizzle (gone with D15), the full SQLAlchemy ORM, raw `asyncpg` with hand-written
migrations, and Prisma or Tortoise.

**Why.** Identical reasoning to the Drizzle choice it replaces: D7 needs
`SELECT ... FOR UPDATE SKIP LOCKED`, so the data layer has to make raw SQL comfortable rather than
something to route around. Core does; the full ORM adds a mapping layer the most important query in
the system would have to fight through. Alembic migrations read as SQL.

### D23 (revision 2) · The same test strategy, in pytest

**Chose.** pytest with Hypothesis for the coercion property tests, testcontainers-python for the
queue and crash-recovery tests, Playwright for end to end. The fixture provider and the day-1 corpus
are unchanged.

**Why there is nothing more to say.** Every argument in revision 1 was about *what* has to be tested
and why it can't be mocked, not about the runner. `SKIP LOCKED` still needs a real Postgres;
testcontainers exists for Python. Golden files over the corpus are golden files in any language.

One addition the language change forces: the generated frontend types are now a test surface of their
own. CI regenerates them from the OpenAPI schema and fails on a diff, because D15 traded a compile-time
guarantee for a build step and an untested build step is not a guarantee at all.

### D16 (revision 2) · The principle survives; the target is deliberately open

**Chose.** Keep the interface discipline. Defer the deployment target - final candidates are AWS with
**only S3 and ECS**, or GCP.

**Why this is safe rather than lazy.** D16 has now survived three vendor reversals - AWS out, free
tiers in, free tiers out - and cost hours rather than days each time, because blob storage, models and
transcription each sit behind an interface with a local implementation. Deferring the target is
exercising that property rather than avoiding a decision, and both candidates are container platforms,
so the deployed shape is identical either way.

The one thing it *does* block is day 1's "deployed URL live" goal, which is why it's O7 and dated.

### D4 (revised) · Video is deferred, not rejected

**Chose.** Video stays out of v1, but as a deferral with a known path - FFmpeg extracts the audio
track and hands it to the existing audio adapter - rather than a rejection.

**Why the distinction matters.** The original cut listed video alongside portal scraping, and those
aren't the same kind of "no." Scraping is out because it's a *different problem* (acquisition, not
structuring) and would still be wrong with unlimited time. Video is out because it's *more of the same
problem* at a worse cost-to-value ratio right now. Recording it as deferred keeps the adapter
interface honest about what it has to accommodate later.

---

## Day 0 (later) — The Next turn, and the shape of a split runtime

The Python decision lasted about a day. What changed it wasn't a technical objection to FastAPI — it
was noticing that the *worker* is the only part that genuinely needs Python, and that once the API is
free to be TypeScript, putting it in Next deletes a contract instead of generating one.

So: **Next.js on Vercel for UI and API, Python worker on Cloud Run.** Two runtimes, two platforms,
meeting only in Postgres. That is a real cost and this section is mostly about paying it honestly.

### D15 (revision 2) · Next for the API, Python for the worker

**Chose.** Next.js route handlers are the API. The Python worker keeps every adapter.

**Considered.** TypeScript end to end (the original), Python end to end (yesterday's decision), and
.NET + Python.

**Why, and what I gave up.** The adapter list forces Python somewhere — PyMuPDF, Tesseract,
python-docx, openpyxl, pandas. It does not force Python *everywhere*. And once the API can be
TypeScript, UI and API share types natively: no OpenAPI generation, no codegen step, no CI diff check.
The drift surface I introduced yesterday is gone.

It is replaced by a different one, smaller but sharper. **Three things now exist in both languages:**
the field-type system (D13), the failure taxonomy (D12), and the shape of verification results. None
is large. All three are product semantics rather than plumbing, which is exactly the kind of
duplication that drifts without anyone noticing — a field type added in Python that the grid renders
as an empty cell is the bug class D12 exists to prevent.

The mitigation is not clever, it is just explicit: those three are enumerated in `decisions.md`, in
§4 of the spec, and in a test that asserts both sides agree. Duplication you have written down is
survivable; duplication you have forgotten is not.

One thing I will not dress up. A real part of this decision is that the person building it moves
faster in TypeScript and the whole visible surface now lives there. That is a velocity argument, not
an architecture argument, and it is a legitimate one on a five-day clock — it is just worth labelling
correctly rather than reverse-engineering a technical justification for it.

### D25 · The worker is triggered, not resident

**Chose.** The worker exposes `POST /drain`. It claims documents and advances stages until the queue
is empty or a time budget expires, then returns. The API pings it after an upload; Cloud Scheduler
pings it every few minutes regardless.

**Considered.** A resident `while True` loop with Cloud Run `min-instances=1` and CPU always allocated
— about $10–15/month and the loop behaves exactly as D6 originally imagined. Cloud Run Jobs on a
schedule. Pub/Sub push.

**Why, and what I gave up.** Cloud Run throttles a container's CPU to near zero outside a request.
A resident loop doesn't crash there — it *stalls*, and resumes in bursts whenever some unrelated
request arrives. You would upload ten documents, watch one finish, and spend an hour debugging a queue
that is working perfectly.

Draining inside a request uses the platform the way it is built, scales to zero, and gets a 60-minute
ceiling to work inside. And it is safe for exactly one reason: **D6.** A drain cut off halfway through
a batch loses nothing, because `stage` is a column — the next drain re-claims each document at the
stage it reached. This is the third time that decision has paid for something it wasn't designed for.

The scheduled ping is the part that is easy to skip and shouldn't be. D12 parks batches on quota
exhaustion with a resume time, and **nobody is uploading anything at 14:32.** Without a heartbeat,
parked work waits for a coincidence.

What I gave up: a warm instance. The first document after idle waits 5–20 seconds while an image
carrying Tesseract and its language data starts. D6 makes that safe; the UI makes it legible by saying
*waking up* rather than showing a stalled bar.

### D14 (revised) · SSE that survives being cut

**Chose.** Every event carries the `run_events` row id, and `GET /batches/:id/events?since=<id>`
replays anything missed.

**Why.** A serverless function is killed at its duration cap. Our stream is meant to stay open for the
eight minutes a batch takes, so it *will* be cut, repeatedly and by design.

The fix is standard SSE and costs almost nothing: set `id:` on each event, and the browser resends it
as `Last-Event-ID` when `EventSource` reconnects on its own. The handler reads that header and replays
from the events table. A hard failure becomes an invisible reconnect.

What makes this cheap is that the events table already existed (D6) for reasons unrelated to
transport. Replay-by-cursor was available the whole time; the serverless cap is just what made it
necessary. The same endpoint now also serves a page refresh, which we needed anyway.

### D22 (revision 2) · Alembic owns the schema; TypeScript introspects

**Chose.** Alembic is the single owner of the database schema. SQLAlchemy Core in the worker. The Next
side generates its query types by reading the live database, and never declares a table.

**Considered.** Drizzle owning it with Python following; both tools managing it; raw SQL with
hand-written types on both sides.

**Why, and what I gave up.** Two migration tools pointed at one database is a well-known way to lose a
column: each derives "what the schema should be" from models in its own language, so a column added by
one looks like drift to the other, and the next autogenerated migration proposes dropping it.

Alembic wins the ownership because the worker does every hard write — blocks, field values,
provenance, run events, stage transitions — and because `SELECT … FOR UPDATE SKIP LOCKED` has to be
comfortable rather than something to route around.

The cost is a three-step ritual on every schema change: write the migration, run it, regenerate the
TypeScript types. **Step three fails silently when skipped** — not a compile error, a blank cell in the
UI found by clicking around. Mitigation: make it one scripted command that runs with the migration, so
forgetting requires effort.

### D16 (revision 3) · Vercel and Cloud Run

**Chose.** Vercel for the Next app, Cloud Run for the worker, and the local-implementation discipline
unchanged.

**Considered.** One container platform for both, which has no serverless limits and one console. AWS
S3 + ECS. The earlier all-free-tier stack. AWS on employer credits.

**Why, and what I gave up.** Vercel is the shortest path from a Next repo to a live URL with preview
deploys, and **presigned uploads mean its body-size cap never applies** — the objection that killed
Vercel two revisions ago was answered by a decision made for unrelated reasons (D8). Cloud Run gives
the worker a real container for Tesseract and a long request ceiling for D25.

What it costs is a list, not a vibe, and each item has a named answer: duration caps cut the stream
(D14), serverless connection churn needs a pooler (D7), two consoles hold the secrets, regions must be
co-located or every query crosses an ocean, and **local development stops predicting production
entirely** — none of these three failure modes reproduces under `docker compose`.

That last one is the real price, and it converts the plan's "deploy on day 1" rule from good practice
into a requirement. Every one of these is a day-1 discovery or a day-4 disaster.

### D26 · Tabular headers are reconciled, not read literally

**Chose.** When a CSV or spreadsheet arrives, the model maps its column headers onto the user's schema
before any rows are read. One call per file. The mapping is stored and rendered in the evidence panel
like any other claim.

**Considered.** Reading headers literally, which is what the adapter did. Fuzzy string matching on
header names. A hand-mapping UI where the user drags columns onto fields.

**Why, and what I gave up.** This came out of a long side-discussion about what "semi-structured"
actually means, and the observation stuck: the interesting half of semi-structured data isn't JSON, it
is **tabular data with unstandardised headers**. One vendor sends `Name, Email, Phone`; another sends
`Customer Name, Email ID, Mobile`. Both are perfectly clean CSVs. They mean the same thing and they do
not combine.

Reading literally means those two files produce two incompatible sets of rows — which fails the
product's own premise on the *easiest* file type it supports, and CSV is the format a reviewer will
certainly try.

String matching doesn't rescue it. `Mobile` and `phone` share no substring; `Email ID` and `email` only
match if you already know to strip the noise word. The cases where matching works are the cases nobody
needed help with.

What makes this nearly free is that the signal already exists. Every field carries a `description`
written in plain language to steer extraction (§3.2) — "the person's contact email" is exactly what is
needed to decide that `Email ID` belongs there. The feature costs one model call per file and no new
concepts.

**Cut.** The hand-mapping UI. D2's user cannot write a script; asking them to map forty columns onto
forty fields is the same wall wearing different clothes. Also cut: reconciling *values* across
vendors — units, currencies, regional date order — beyond the coercion D10 already performs. That is
normalization at a depth this build hasn't earned.

One consequence worth stating: a header mapping is a guess, so it is treated like every other guess in
this system. It is recorded, shown as evidence, and correctable. The alternative — silently deciding
that `Mobile` is the email column — is precisely the class of quiet wrongness D11 exists to prevent.

---

## Where I changed my mind

Five decisions were reversed after they were first written. `decisions.md` shows only the outcome —
the superseded choice sits in that row's *Alternatives* column. The full story is above, in the pairs
of entries:

| Decision | Original entry | Revised entry | Cause |
|---|---|---|---|
| **D4** - video | Cut alongside portal scraping | Deferred, with a known path | Two different kinds of "no" were sharing a row |
| **D9** - the router chain | Bedrock primary on AWS credits | Gemini free -> Groq -> fixtures | Bedrock is AWS, and the credits are an employer's |
| **D14** - progress | Plain SSE | SSE with replayable event ids | A serverless API cuts long responses by design |
| **D15** - language | TypeScript end to end | Python end to end -> Next API + Python worker | The adapter list forces Python in the worker; nothing forces it in the API |
| **D16** - hosting | AWS: S3, RDS, App Runner | Free tiers -> open -> Vercel + Cloud Run | Reversed three times. The *interface* principle survived all three, which is the point |
| **D17** - extraction | Apache Tika as a JVM sidecar | TS libraries -> Python libraries + MarkItDown | First a 512 MB ceiling, then the language change |
| **D18** - frontend | Vite SPA | Next.js app serving UI and API | Followed D15; the O5 question assumed Next's backend was the draw, and in the end it was |
| **D19** - audio | AWS Transcribe, acoustic diarization | Hosted Whisper + turns inferred from content | No acoustic diarization on a free stack; local models not worth 2 GB |
| **D20** - charts | Cut entirely | Back, as pipeline observability | Reversed at the user's call, with a reframe that makes them load-bearing |
| **D21** - worker | Separate service | One process behind a flag -> separate service again | Round-tripped: a free-tier constraint imposed it, a container target removed it, and Vercel made it mandatory |
| **D22** - data layer | Drizzle | SQLAlchemy Core -> Alembic owns, TypeScript introspects | Followed D15, twice |
| **D24** - images | "No OCR subsystem at all" (part of D9) | Tesseract for position, model for meaning | D9 was right about meaning and wrong about position |

Open questions live in [`spec.md` §11](spec.md#11-open-questions).

---

## Appendix — concepts these decisions lean on

Short definitions for the terms that carry weight above.

| Term | What it means here |
|---|---|
| **Worker** | A program with no URL that runs in a loop: claim a document, advance one stage, save, repeat. The API is the waiter; the worker is the kitchen. Same TypeScript, a second `npm run` script |
| **Daemon** | A program that stays running rather than being woken by a request. Our worker is one. Serverless platforms give you *functions* — wake, run, die — so you cannot run `while(true)` on them. That's why Vercel and Lambda can't host it: wrong shape, not too small |
| **SPA vs SSR** | SSR builds finished HTML per request (good for blogs, SEO). An SPA ships one HTML file plus JS and renders in the browser, fetching from the API. Ours is a SPA — private data, no SEO, highly interactive (D18) |
| **Zod** | TypeScript types vanish at runtime, so they cannot check data arriving from a model or an API. Zod describes a shape as an actual runtime value. One Zod schema produces four things that then cannot drift: the JSON Schema sent to the model, the coercion and validation, the API/worker types, and the React table's types. This is the whole argument for D15 |
| **OCR** | Turning a *picture* of text into text. Needed when a PDF is a scan rather than a digital file with a text layer. We never build one: Gemini reads PDFs and images directly (D9) |
| **JVM** | The Java runtime. Relevant for exactly one reason — Apache Tika is Java, and a JVM idles at 300–500 MB, which doesn't fit a 512 MB free tier (D17) |
| **`SKIP LOCKED`** | A Postgres clause that lets one worker claim a row while others skip past it instead of blocking. It is what makes the documents table a correct queue (D7), and it cannot be mocked in tests (D23) |
| **Lease** | `claimed_until` on the document row. A worker that dies without releasing its claim has its documents reclaimed when the lease expires. Crash recovery with no extra machinery |
| **`docker compose`** | A text file listing the pieces the app needs, started locally with one command. It uploads nothing — deployment is a separate path from a git push. It exists so a reviewer can run the whole project in one shot, which is graded (D16) |
| **Presigned URL** | A time-limited URL that lets the browser `PUT` a file straight into blob storage without the file passing through the API (D8) |
| **SSE** | Server-sent events: a one-way HTTP stream from server to browser that reconnects itself. Simpler than WebSocket and the right shape for progress (D14) |
