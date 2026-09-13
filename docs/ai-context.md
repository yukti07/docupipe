# App Context

Single context file for design and build work. Longer detail lives in
[`product-spec.md`](product-spec.md), [`feature-priorities.md`](feature-priorities.md),
[`user-flows.md`](user-flows.md), [`screen-inventory.md`](screen-inventory.md),
[`ui-design-spec.md`](ui-design-spec.md) and
[`component-inventory.md`](component-inventory.md).

---

## What we're building

**Quarry** turns a pile of look-alike documents into a spreadsheet you can trust. You upload a
folder of invoices, papers, receipts, emails or recordings; the system reads them, works out what
columns the table should have, extracts the values, and gives you a table you can sort, filter and
export.

The part that matters is the second half. Every value in the table can show you exactly where it
came from — the page with the spot boxed, the moment in the recording, the row in the spreadsheet.
Values that failed an automatic check are marked for you to look at. Values that genuinely weren't
in the document say **"not found"** rather than leaving a blank or a zero to misinterpret.

Turning documents into a table is a commodity — a dozen products do it. The differentiator is that
**a wrong number you can't spot is worse than no number at all**, and nothing else in this market
takes that seriously. The evidence panel, the review loop, and honest failure messages are the
product. The table is just what it outputs.

---

## Target user

One person with 20–500 documents that share a shape, who cannot write code. An ops or finance
analyst with 200 supplier invoices; a researcher with 80 papers; a support lead with 300 emails.

They are accountable for the numbers. If the total is wrong, it's their name on it — so *"how do I
check this?"* matters to them more than *"how fast is it?"*

---

## Primary workflow

```
Upload  →  Columns  →  Process  →  Results  →  Review  →  Export
```

**Columns** is auto-detected — the system reads the files and proposes the table shape; the user
edits it if they want. There is no form asking the user to describe their table.

**Validation is not a user step.** Checks run automatically during processing. Their only visible
output is the handful of marked cells, which is what Review handles.

---

## Core features

### P0

- Upload one file, many files, or a folder — text, CSV, Excel, JSON, PDF, scanned PDF, Word, images, audio
- Reject impossible files instantly, with the reason, per file
- **Auto-detect the columns**, including merging different header names across spreadsheets
  (`Customer Name` / `client` / `Cust_Nm` → one column), with editing
- Honest live processing status — done / waiting / to check / failed, in one sentence
- Results shown when the batch reaches a terminal state: finished, paused, or all-remaining-failed
- Table with sort and filter
- **"not found"** instead of blank or zero
- Cells marked when an automatic check fails, with a plain-English reason
- **Evidence on any cell** — click it, see the source with the exact spot highlighted
- Plain-English message and next step for every failure class
- Hitting a processing limit shows as a **pause with a time**, not an error
- Export to CSV / Excel with honest counts

### P1

Keyboard review queue (build first) · live machine view · column-merge review card · audio ·
full-text search · per-file retry · "waking up" cold-start state · opt-in demo batch

### P2

Charts on user data · dark mode · saved column sets · re-run a batch · stale-row marking ·
second-opinion cross-check · cross-document outlier detection · natural-language questions

---

## Screens

| ID | Screen | Priority |
|---|---|---|
| S01 | Workspace — landing and batch list in one | P0 |
| S02 | Upload | P0 |
| S03 | Columns — the auto-detected proposal | P0 |
| S04 | Processing | P0 |
| S05 | Machine view | P1 |
| S06 | Results — the table | P0 |
| S07 | Evidence — side panel inside Results | P0 |
| S08 | Review — keyboard loop | P1 |
| S09 | Export | P0 |
| S10 | Settings — processing cap, little else | P1 |
| S11 | Demo | P1 |
| S12 | Not found | P0 |
| S13 | Something broke | P0 |

No sign-in screen. No validation screen. No "describe your table" screen.

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
| **Domain** | Quarry-specific — cells, evidence, batches, failures | `src/components/quarry/` |

Before building anything new: check the inventory → can a shadcn primitive do it? → can it be
composed from existing pieces? → only then write one, and add it to the inventory in the same change.

**Extract a component on its third use, not its first.** Two similar bits of markup is a
coincidence; three is a component.

**Four components carry most of the product:**

- `DataCell` — five states (`value` · `not-found` · `marked` · `corrected` · `failed-row`), used in
  both the table and review
- `EvidencePanel` + `EvidenceView` — one interface, five views dispatched by locator type, so a new
  format means a new view and nothing else changes
- `FailureMessage` — the single place a failure class becomes text. Rendering `error.message`
  directly anywhere is a bug
- `LoadingState` — requires a label, which is what makes "no bare spinners" structural rather than a
  rule people have to remember

**Never create:** a second badge (use `StatusBadge` variants) · a bare spinner (use `LoadingState`)
· a toast for an error (errors persist, toasts don't) · a one-off cell renderer (use a `DataCell`
state) · your own colour values (use the tokens).

---

## Design principles

1. **Colour carries meaning, never decoration.** Amber means *check this*. Red means *this failed*.
   Blue-grey means *paused*. They are never borrowed for emphasis.
2. **It's an instrument, not a dashboard.** Calm, precise, legible under pressure. One accent
   colour, warm neutrals, generous space around dense data.
3. **Evidence is always one click away**, from any cell — not just marked ones.
4. **No bare spinners.** Always say what's happening, and how much is left where we know.
5. **Motion only where it teaches.** The evidence highlight drawing itself is the one animation
   that earns its cost.
6. **Numbers use tabular figures**, always. Ragged columns hide errors.
7. **Say the true thing**, even when it's unflattering. "4 failed" beats a clean interface that
   quietly dropped four documents.
8. **The keyboard does everything.** Review is keyboard-first; everything else is keyboard-complete.

---

## Important UX decisions

- **No accounts.** A workspace exists from the first visit — anonymous session cookie, no sign-up.
- **Nothing is pre-loaded into the user's workspace.** The demo batch is opened deliberately, never
  sitting there as data they didn't upload.
- **No starter schema templates.** The system always proposes columns by reading the files first.
- **Confidence is a count, never a percentage** — *"found in 47 of 50 files"*. A model-reported
  "94%" invites trust it hasn't earned, so it is never shown.
- **Results appear all at once**, when the batch reaches a terminal state. No half-filled table
  building itself row by row.
- **Partial results are a result.** 182 good rows out of 200 is presented as a usable outcome.
- **Running out of daily quota is a pause, not an error.** It happens routinely, loses nothing, and
  gets a calm colour and a resume time.
- **Retries that succeed are invisible.** The user never hears about a problem the system fixed.
- **Corrections stay visibly corrected.** A person's edit never blends silently into machine output.
- **Correct by drawing a box** on the source page instead of retyping the value, where a position is
  known.
- **Evidence is a side panel, never a modal** — the cell and its source must be visible together.

---

## Technical context

| | |
|---|---|
| **Frontend** | Next.js 16 (App Router), TypeScript, Tailwind v4, shadcn/ui, TanStack Table, pdf.js. Lives in `packages/web` |
| **Backend** | Next route handlers **are** the API — same app, types shared natively, no codegen step |
| **Worker** | Separate Python service (adapters, OCR, model calls). Triggered by `POST /drain`, not resident |
| **API** | Route handlers under `src/app/api/`. Live progress over SSE |
| **Data** | Postgres — typed columns plus `jsonb`. Alembic owns the schema; TypeScript introspects it |
| **Auth** | None. Anonymous signed-cookie session, created on first visit |
| **Fonts** | Geist Sans and Geist Mono, already installed |

---

## Current scope

**Build only P0.**

Do not implement P1 or P2 features unless explicitly asked. If a P1 feature seems necessary to make
a P0 feature work, say so and ask rather than building it.
