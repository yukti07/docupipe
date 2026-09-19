# Batch navigation bar

Status: designed
Date: 2026-09-18
Scope: `packages/web/src/components/quarry/BatchNav.tsx` (new), plus the header slot on the five
batch screens

## 1 · Why

Every screen inside a batch hand-rolls its own navigation into `AppHeader`'s `children` slot. There
is no shared component, and the five screens have settled on four different idioms:

| Route | Screen | Header today |
|---|---|---|
| `/request/:id` (pre-convert) | Prepare | `Your workspace / Prepare` |
| `/request/:id/schemas` | Review schemas | `Prepare / Review schemas` |
| `/request/:id` (post-convert) | Converting | `Converting` \| `Paused` \| `Finished`, plus `StatusSentence` |
| `/request/:id/merge` | Merge | `Back to the batch` + `Combine tables` |
| `/request/:id/table/:schemaId` | One table | the filename alone |

Three defects follow from it.

**The table screen is a dead end.** `table/[schemaId]/page.tsx:75` renders a filename and nothing
else, so the header offers no route back to the batch. The browser's Back button is the only way
out.

**Place and status share one slot.** On the post-convert screen, `Converting` is rendered in exactly
the position `Prepare` occupies on the screen before it. One says where you are; the other says what
the server is doing. Rendering them in the same pixels teaches people to read them as the same kind
of fact.

**The arc is invisible.** Nothing on any screen shows that Prepare → Convert → Results is the shape
of the product, or that Convert is a door that only opens forwards.

## 2 · Goals

- One navigation component, used by all five batch screens.
- The Convert gate is legible: you can see which side of it you are on, and that the near side does
  not come back.
- Location and status occupy separate space and never trade places.
- No new client state. Every step's condition is already computed somewhere.

## 3 · Non-goals

- **Per-file progress does not enter the bar.** Uploading, uploaded, shape-pending and shape-ready
  are states of a *file*, and a batch of forty files is in all four simultaneously. They stay on
  `FileRow` and in `ConvertBar`'s two summary lines.
- `PipelineStrip` is unchanged. It counts files across four *processing* stages and is a different
  instrument from this bar; the two must stay visually distinct.
- The workspace screen (`/`) gets no bar. There is no batch to describe.
- No change to `AppHeader` itself — it already accepts `children`.

## 4 · The four steps

| Step | Label | Ticks when | Links to |
|---|---|---|---|
| 1 | **Files** | `uploadedCount === acceptedCount` | `/request/:id` — pre-convert only |
| 2 | **Schemas** | `allShapesSettled(...)` — every accepted file has a shape, or a reason it has none | `/request/:id/schemas` — pre-convert only |
| 3 | **Convert** | `phase !== "prepare"` | never a link |
| 4 | **Tables** | — terminal, never ticks | `/request/:id` — post-convert only |

These conditions already exist verbatim in `state/batch.tsx` and `state/workspace.tsx`. The bar
computes nothing new.

Step 4 has no ticked state. It is the last step, and whether the batch has finished is the status
line's job — a tick beside `Tables` would be a second, quieter copy of a sentence that is already
on screen saying it better.

**The current step is never a link**, on either side of the gate. It renders as `aria-current` text.

### Why step 2 ticks on server state, not on a click

Review schemas is optional — `ConvertBar` enables Convert whether or not anyone ever opens it. A
step that ticked on visiting the screen would therefore sit permanently un-ticked for the people who
skipped it, which makes the bar read as an unfinished checklist for the commonest path through the
product.

Ticking it on `convertAvailable` instead names a milestone that is true either way: every file has
been read and has a shape waiting, whether or not you went and looked at it.

### Why step 3 is never a link

Convert is the only irreversible moment in the product, and it is a milestone rather than a
destination — there is no `/convert` route and there should not be one. Giving it a step makes the
gate visible; keeping it inert keeps the button in one place. The button stays in `ConvertBar`,
where it already sits beside the counts that justify pressing it.

## 5 · The gate

Once `phase !== "prepare"`, steps 1–3 render greyed and stop being links.

This is not decoration. Schemas are not editable after Convert (`user-flows.md` §6) — work is
already being written against the shape that was approved. A stepper offering a link back to Prepare
would be offering something the product refuses, and the refusal is better expressed as a bar that
plainly goes one way.

After the gate, the only live navigation is step 4 and its tails.

## 6 · Tails

A sub-location appends to the current step as ` / <tail>` rather than becoming a step of its own:

| Screen | Step | Tail |
|---|---|---|
| `/merge` | 4 | `Merge` |
| `/table/:schemaId` | 4 | the filename |

Promoting Schemas to a step removes it as a tail, so every remaining tail hangs off step 4. This is
what closes the table screen's dead end: the filename becomes the tail of a step that links home.

## 7 · Component

```ts
// packages/web/src/components/quarry/BatchNav.tsx
BatchNav({
  requestId: string,
  current: 1 | 2 | 3 | 4,
  done: { files: boolean; schemas: boolean },
  /** Greys and unlinks steps 1–3. */
  converted: boolean,
  /** "Merge", or a filename. Rendered after `current`. */
  tail?: ReactNode,
})
```

Deliberately without state of its own. Each screen computes its props, because the two halves of the
batch read from different sources — `useBatch` before the gate, `useResultPolling` after — and a
component that reached for both would have to know which half it was in.

Per-screen props:

| Screen | `current` | `converted` | `tail` |
|---|---|---|---|
| Prepare | `1` while uploads are in flight, else `2` while shapes are pending, else `3` | `false` | — |
| Review schemas | `2` | `false` | — |
| Converting / Finished | `4` | `true` | — |
| Merge | `4` | `true` | `Merge` |
| One table | `4` | `true` | filename |

The merge and table screens are reachable only after the gate, so they pass `converted: true` and
`done: { files: true, schemas: true }` as constants rather than fetching batch state to prove it.

## 8 · StatusSentence moves

`StatusSentence` currently shares the 58px header with the location word. A four-step bar and a
sentence will not both fit, so the sentence moves out of the header and into `<main>`, directly
above `PipelineStrip` — beside the counts it is describing.

`PausedBanner` is unaffected; it is already in `<main>`.

## 9 · What is deleted

The bespoke crumb markup in the `AppHeader` children of all five screens:

- `request/[requestId]/page.tsx` — both the `Prepare` block and the `Converting` block
- `request/[requestId]/schemas/page.tsx`
- `request/[requestId]/merge/page.tsx` — including its `Back to the batch` link, which the bar
  subsumes
- `request/[requestId]/table/[schemaId]/page.tsx` — the bare filename becomes a tail

## 10 · Naming

Three words replaced, and the reasoning behind each:

| Was | Now | Why |
|---|---|---|
| `Prepare` | **Files** | Describes the screen rather than your intent. You are looking at a list of files. |
| `Review schemas` | **Schemas** | A step is a place, not an instruction. The verb belongs on the button that opens it. |
| `Finished` / `Converting` / `Paused` as a location | **Tables** | These are statuses. They move to the status line; the place is the tables. |

`Merge` keeps its name. `Combine tables` on the merge screen becomes redundant once the bar says
`Tables / Merge`, and is dropped.

## 11 · Testing

| Test | Asserts |
|---|---|
| `BatchNav.test.tsx` — pre-convert | Steps 1–2 link; step 3 is not a link; step 4 is inert |
| `BatchNav.test.tsx` — post-convert | Steps 1–3 render without links; step 4 links to the batch |
| `BatchNav.test.tsx` — tail | A tail renders after the current step and is not itself a link |
| `BatchNav.test.tsx` — ticks | `done.schemas` ticks step 2 with no navigation having occurred |
| Existing screen tests | Unchanged — none of them assert on the header markup |

The route home from the table screen is covered by the `tail` cases above rather than by a
page-level test. `TableScreen.test.tsx` has no page harness (it only covers `MarkedCellNav`), and
standing msw up for the table route to re-assert a link the component test already pins would buy
coverage of the wiring, not of the behaviour.

## 12 · Fitting the header

The bar shares a 58px header with the allowance meter and the workspace link, which leaves it about
330px at a 900px window. Four labelled steps plus the rules between them do not fit in that, and the
overflow paints over the meter.

Two things give way, in order of how little they carry:

| Below `lg` | Why |
|---|---|
| The rules between steps | Decoration. The markers already read as a sequence without them. |
| The step labels, but **only when there is a tail** | The tail is the most specific thing on its screen — the file you opened. Where none exists, the labels keep the room. |

Labels give way as `sr-only`, not `display: none`, so they stay in the accessibility tree and the
bar reads the same aloud at every width.

## 13 · Accessibility

The bar is a `<nav aria-label="Batch">` containing an ordered list. The current step carries
`aria-current="step"`. Steps that are not links are plain text, not disabled buttons — a disabled
control in the tab order is a promise of an action that will never arrive.

Greyed steps 1–3 after the gate are readable text at `--text-muted`, not reduced opacity.
