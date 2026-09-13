# App Context

Single context file for design and build work. Longer detail lives in
[`product-spec.md`](product-spec.md), [`feature-priorities.md`](feature-priorities.md),
[`user-flows.md`](user-flows.md), [`screen-inventory.md`](screen-inventory.md),
[`ui-design-spec.md`](ui-design-spec.md) and
[`component-inventory.md`](component-inventory.md).

---

## What we're building

**Quarry** turns a pile of documents into tables you can trust. You upload a folder; each file is
read on its own and tells you what its table looks like; you correct that shape; you press Convert;
tables come back one file at a time, each one openable the moment it's done.

Two things make it different from every other extract-to-a-table tool.

**You see the shape before you commit.** Each file's schema is inferred as soon as it uploads and
shown on a per-file Preview / Edit button. Nothing is converted until you press Convert.

**Every value can show you where it came from** — the page with the spot boxed, the moment in the
recording, the row in the spreadsheet. Values that failed an automatic check are marked amber with
a plain reason. Values that genuinely weren't in the document say **"not found"** rather than
leaving a blank or a zero to misinterpret.

Turning documents into a table is a commodity — a dozen products do it. The differentiator is that
**a wrong number you can't spot is worse than no number at all**, and nothing else in this market
takes that seriously. The evidence panel, the honest failure messages, and seeing each file's shape
up front are the product. The tables are just what it outputs.

---

## Target user

One person with 20–500 documents, who cannot write code. An ops or finance analyst with 200 supplier
invoices; a researcher with 80 papers; a support lead with 300 emails.

They are accountable for the numbers. If the total is wrong, it's their name on it — so *"how do I
check this?"* matters to them more than *"how fast is it?"*

---

## Primary workflow

```
Upload & Schema  →  Convert  →  Processing  →  Merge  →  Insights (P1)
```

**Schema is per file, not per batch.** Each file is read on its own and gets its own shape. A file
holding three tables gets three schemas, edited independently. Nothing is averaged across the batch
and nothing is merged unless the user asks.

**Convert is the only gate.** Before it, the user is correcting shapes. After it, results stream
back per file — document 4 is readable while document 40 is still transcribing. Schemas freeze at
Convert; nothing is editable during processing.

**Validation is not a user step.** Checks run automatically during processing. Their only visible
output is the marked cells, which show their reason inline in the table.

---

## The five rules that are easy to get wrong

1. **Exactly two schema edits exist: change a field's type, and add a field.** No rename, no delete,
   no description. The schema describes what is in the document; renaming would make the table
   disagree with its own source. Don't render greyed-out rename/delete controls either.
2. **Apply-to-all matches on the *original* inferred schema**, not the current one — same field
   names and types, order-independent.
3. **Convert enables when every file has uploaded *and* settled its schema** (ready **or** failed).
   A file whose schema couldn't be read is carried as a failure, not a blocker.
4. **Merge is exact and explicit.** Same field names, same types. Never automatic, never widening,
   never subsetting. A failed check names the table, the field and the disagreement.
5. **Every disabled control says what would enable it**, in text, not only in a tooltip.

---

## Core features

### P0

- Upload one file, many files, or a folder — text, CSV, Excel, JSON, PDF, scanned PDF, Word, images, audio
- Reject impossible files instantly, with the reason, per file
- **Infer a schema per file** as soon as it uploads; a multi-table file produces several
- **Preview / Edit per file** — button disabled until that file's schema is ready
- **Two edit operations only** — change a field's type, add a field
- **Review schemas** — all schemas at once, enabled as soon as any one is ready
- **Apply to all** — propagate onto files whose original schema matched exactly, listed before it commits
- **Convert** — the one gate; freezes schemas
- Honest live processing status — done / waiting / to check / failed, in one sentence
- **Each file's table opens the moment that file finishes.** No waiting for the batch
- Tables with sort, filter and search
- **"not found"** instead of blank or zero
- Cells marked when an automatic check fails, with a plain-English reason inline
- **Evidence on any cell** — click it, see the source with the exact spot highlighted. Read-only
- **Merge** — explicit, exact-match, with a conflict message that names the field
- Plain-English message and next step for every failure class
- Hitting a processing limit shows as a **pause with a time**, not an error
- Download per file in one click; Download all to CSV / Excel behind an honest summary

### P1

Insights (charts + written findings, every finding citing its rows) · live machine view · audio ·
full-text search · per-file retry · "waking up" cold-start state · opt-in demo batch

### P2

Keyboard review queue and value corrections · "corrected" cell state · chart-this-column · dark mode ·
saved schemas · re-run a batch · stale-row marking · second-opinion cross-check · cross-document
outlier detection · natural-language questions

---

## Screens

| ID | Screen | Priority |
|---|---|---|
| S01 | Workspace — landing and batch list in one | P0 |
| S02 | Upload & Schema — files up, shapes back, Convert | P0 |
| S03 | Schema editor — per-file panel, and the all-files view | P0 |
| S04 | Processing — per-file status, finished files usable immediately | P0 |
| S05 | Machine view | P1 |
| S06 | File result — one file's table, and merged tables | P0 |
| S07 | Evidence — side panel inside S06, read-only | P0 |
| S08 | Download — per file, and Download all | P0 |
| S09 | Merge — picker and compatibility check | P0 |
| S10 | Insights — charts and cited findings | P1 |
| S11 | Review queue — keyboard loop | P2 |
| S12 | Settings — processing cap, little else | P1 |
| S13 | Demo | P1 |
| S14 | Not found | P0 |
| S15 | Something broke | P0 |

No sign-in screen. No validation screen. No "describe your table" screen. No batch-level Columns
step.

---

## Components

**Reuse existing components wherever possible. Do not create a new component if an existing one can
satisfy the requirement.** The full catalogue is [`component-inventory.md`](component-inventory.md)
— check it before writing any new component.

Three layers, each depending only downward:

| Layer | What | Where |
|---|---|---|
| **Primitives** | shadcn/ui — install with the CLI, never hand-edit | `src/components/ui/` |
| **Common** | Generic pieces that know nothing about documents | `src/components/common/` |
| **Domain** | Quarry-specific — cells, evidence, schemas, batches, failures | `src/components/quarry/` |

Before building anything new: check the inventory → can a shadcn primitive do it? → can it be
composed from existing pieces? → only then write one, and add it to the inventory in the same change.

**Extract a component on its third use, not its first.** Two similar bits of markup is a
coincidence; three is a component.

**Four components carry most of the product:**

- `DataCell` — four states (`value` · `not-found` · `marked` · `failed-row`), plus `corrected` at
  P2. Used in every table
- `EvidencePanel` + `EvidenceView` — one interface, five views dispatched by locator type, so a new
  format means a new view and nothing else changes
- `SchemaEditor` — the per-file panel, the all-files view and the merge picker's cards all render
  the same shape
- `FailureMessage` — the single place a failure class becomes text. Rendering `error.message`
  directly anywhere is a bug

**Two more make rules structural rather than remembered:**

- `LoadingState` — requires a label, so a wordless spinner can't be written
- `GatedButton` — requires a reason when disabled, so an unexplained dead control can't be written

**`FileRow` is one component on two screens** — Preview / Edit on S02, View and Download on S04.
One trailing slot, not two components.

**Never create:** a second badge (use `StatusBadge` variants) · a bare spinner (use `LoadingState`)
· a disabled button with no reason (use `GatedButton`) · a rename or delete control on a schema
field (the operation doesn't exist) · a toast for an error (errors persist, toasts don't) · a
one-off cell renderer (use a `DataCell` state) · a second table for merged results · your own colour
values (use the tokens).

---

## Design principles

1. **Colour carries meaning, never decoration.** Amber means *check this*. Red means *this failed*.
   Blue-grey means *paused*. They are never borrowed for emphasis.
2. **It's an instrument, not a dashboard.** Calm, precise, legible under pressure. One accent
   colour, warm neutrals, generous space around dense data.
3. **Evidence is always one click away**, from any cell — not just marked ones.
4. **No bare spinners.** Always say what's happening, and how much is left where we know.
5. **Every disabled control explains itself.** Four actions in this product are gated.
6. **Never show an affordance that doesn't work.** No greyed rename on a schema field.
7. **Motion only where it teaches.** The evidence highlight drawing itself, and a file row gaining
   its buttons the moment it finishes.
8. **Numbers use tabular figures**, always. Ragged columns hide errors.
9. **Say the true thing**, even when it's unflattering. "4 failed" beats a clean interface that
   quietly dropped four documents.
10. **The keyboard does everything.** Everywhere is keyboard-complete; the review queue at P2 will be
    keyboard-first.

---

## Important UX decisions

- **No accounts.** A workspace exists from the first visit — anonymous session cookie, no sign-up.
- **Nothing is pre-loaded into the user's workspace.** The demo batch is opened deliberately, never
  sitting there as data they didn't upload.
- **No starter schema templates.** The system always reads the file first and proposes its shape.
- **The schema belongs to the file, not the batch.** Nothing is averaged across a pile.
- **Results stream per file.** A finished file is openable and downloadable immediately; there is no
  moment where the batch goes quiet and then hands everything over at once.
- **Nothing is editable after Convert** — not schemas, not values.
- **Partial results are a result.** 182 good rows out of 200 is presented as a usable outcome.
- **Running out of daily quota is a pause, not an error.** It happens routinely, loses nothing, and
  gets a calm colour and a resume time.
- **Retries that succeed are invisible.** The user never hears about a problem the system fixed.
- **Merging never happens on its own**, and the compatibility check is exact.
- **Evidence is a side panel, never a modal** — the cell and its source must be visible together —
  and it is read-only until the review queue lands at P2.
- **Insights findings must cite their rows.** Enforced in the component, not in a prompt.
- **Confidence is never a percentage.** Evidence and a plain reason, or nothing.

---

## Technical context

| | |
|---|---|
| **Frontend** | Next.js 16 (App Router), TypeScript, Tailwind v4, shadcn/ui, TanStack Table, pdf.js, Recharts. Lives in `packages/web` |
| **Backend** | Next route handlers **are** the API — same app, types shared natively, no codegen step |
| **Worker** | Separate Python service (adapters, OCR, model calls). Triggered by `POST /drain`, not resident |
| **API** | Route handlers under `src/app/api/`. Live progress over SSE |
| **Data** | Postgres — typed columns plus `jsonb`. Alembic owns the schema; TypeScript introspects it |
| **Auth** | None. Anonymous signed-cookie session, created on first visit |
| **Fonts** | Geist Sans and Geist Mono, already installed |

**One pipeline note that shapes the UI:** schema inference runs **per file, before Convert**, as its
own short stage. Extraction runs after. That split is why S02 can show a shape while nothing has
been converted yet, and it is the single most important thing to get right in the backend for this
design to work at all.

---

## Current scope

**Build only P0.**

Do not implement P1 or P2 features unless explicitly asked. If a P1 feature seems necessary to make
a P0 feature work, say so and ask rather than building it.
