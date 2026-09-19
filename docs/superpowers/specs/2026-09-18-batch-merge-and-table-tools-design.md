# Batch discards, merging, spreadsheet export and table tools

Date: 2026-09-18

Seven changes across Prepare, Combine tables, the results list and the table
screen. They are grouped into one spec because four of them meet at the same
place: what counts as "a table in this batch" once tables can be merged.

---

## 1. Discarding a file that won't convert

**Today.** A file that uploads but yields no schema lands in `WontConvertPanel`,
which names it and explains why. There is nothing to press. `FileActions` offers
"Discard them", but only for uploads that *failed to land* — a file that landed
and then failed schema detection is not in `retryableCount`, so no discard
appears. Prepare also has no link back to the workspace.

**Change.**

- New endpoint `POST /api/discard`, body `{ userId, requestId, fileIds[] }`.
  It sets `files.deleted_at = now()` for files that belong to that user and
  request, and answers `{ status: "ok", discarded, remaining }` where
  `remaining` counts the request's files that are still live.
  Every existing read already filters `deleted_at IS NULL`
  (`repos.listFiles`, the schema poll's file query, `tables.getTable`), so the
  discard propagates to every device without touching those queries.
- `WontConvertPanel` gains a Discard button per entry and a
  "Discard all N" in its header.
- `useBatch` gains `discardFiles(fileIds)`: it calls the endpoint, and on
  success removes those files from `files` and from `wontConvert`.
- Discarding the last live file in a batch removes the workspace card and
  returns to `/`, exactly as `discardFailed` already does.
- Prepare's header gains a "Your workspace" breadcrumb link, matching the
  pattern the merge page already uses.

**Not in scope.** Deleting the stored object from the bucket. `deleted_at` is
the boundary the rest of the app already respects; object lifecycle is a
separate job.

## 2. "All N at once" → "All at once"

`UpdateOthersControl.tsx` renders `All {count} at once.` inside the
"Update all matching tables" item. The item's own title already says "all", and
the count is repeated from the line above it. Drop the number.
`SchemaEditor.test.tsx:219` asserts the old string and changes with it.

## 3. Spreadsheet download

**Today.** "Download all" writes one CSV or TSV *file* per table.

**Change.** The format toggle gains a third option, **Spreadsheet**: one `.xlsx`
containing one worksheet per table.

- `lib/xlsx.ts` builds the workbook with `exceljs`, lazily imported inside the
  download handler so it is not in the initial bundle.
- Sheet names are derived from the table's file name, truncated to Excel's 31
  characters, stripped of `[ ] : * ? / \`, and de-duplicated with a numeric
  suffix.
- Cell semantics match `toCsv` exactly. A value that was **not found exports as
  an empty cell, never as a zero**. Cells are written as text, except fields
  typed `number` or `currency` whose display parses cleanly as a number — those
  are written as numbers so the sheet is usable. No formula-escaping is needed:
  `exceljs` writes a string value as a string, not as a formula.
- A merged table is one sheet, and carries its `source_file` column as the
  first column — the same column the CSV and the table screen show.

## 4. Merging tables

This is the substantial one. `getMergeGroups` and `createMerge` currently have
no route at all: both are in `NotBuilt` in `live.ts` and reject with
`not_implemented`. That is why Merge does nothing.

### Behaviour

A batch has, say, 4 tables sharing shape A, 10 sharing shape B, and the user
merges 4 of A and 2 of B in one submit. They get **1 + 1 + 8 = 10** tables:
each merge replaces its members in the results list, and everything not
selected is untouched.

### Data model

New Prisma migration, two tables:

```
table_merges         id (mrg_*), request_id, user_id, name, created_at
table_merge_members  merge_id, file_schema_id (unique), ord
```

`file_schema_id` is unique across the whole table, so a table can be in at most
one merge. Both cascade from `requests`.

### Endpoints

| Route | Body | Answer |
|---|---|---|
| `POST /api/merge/groups` | `{ userId, requestId }` | `{ groups: MergeGroup[], merges: ExistingMerge[] }` |
| `POST /api/merge` | `{ userId, requestId, merges: [{ name, schemaIds[] }] }` | `{ ok: true, merges: [{ mergeId, name, rowCount, tableCount }], tablesAfter }` or `{ ok: false, failure, conflicts }` |
| `POST /api/merge/delete` | `{ userId, requestId, mergeId }` | `{ status: "ok" }` |

`groups` covers only tables that are `DONE` and not already in a merge, grouped
by the shape they have **now** (current fields, not `original_fields`).

One submit carries several merges, which is what the 4-of-A-and-2-of-B example
needs. The whole submit is one transaction: if any group is invalid, nothing is
written.

Server-side validation, each producing a conflict rather than a 500: every
schema id belongs to this user and request; every one is `DONE`; no id appears
twice across the submitted groups; none is already in a merge; every group has
at least two members; and every member of a group has the same current shape
(same field keys, same types, order-independent). The shape check is the same
one the screen enforces, so a refusal is a bug, not a normal outcome.

`/api/merge/delete` exists so the results list is not a one-way door.

### Folding merges into the results

`pollResult` loads the request's merges. Member entries are dropped from `files`
and one synthetic entry per merge replaces them:

```
fileId: mergeId, schemaId: mergeId, fileName: <merge name>, stage: "DONE",
rowCount: Σ members, fieldCount: |fields|, toCheckCount: Σ members
```

`counts.done` counts a merge as one table; `rowsSoFar` is unchanged, because
the same rows are being counted either way. This is what makes the results
list, the pipeline strip, "Download all" and Spreadsheet all agree without any
of them knowing about merges.

### Opening a merged table

`/api/table` recognises a `mrg_` id and unions its members' rows in member
order. `TableRow` gains an optional `sourceFile`, and `TableData` a `merged`
flag; the table screen passes `sourceColumn` when `merged` is set, which
`DataTable` already supports. CSV and xlsx pick the column up the same way.

**Known limitation, carried over.** `getTable` refuses a file that holds more
than one table, because the worker's record tables have no per-table
discriminator. A merge whose member comes from such a file fails the same way,
with the same sentence. Fixing that is a worker change and is out of scope here.

### Screen

`MergePicker` is rewritten. The current "one shape at a time" rule — ticking a
table closes every other shape — is exactly what stops the 4-of-A-and-2-of-B
case, and it goes.

- Each group holds its own selection and its own name box, defaulting to the
  group's name.
- A group with fewer than two tables still shows, still explains itself, still
  takes no ticks.
- A footer summarises the whole submit before it is pressed: "3 merges from 9
  tables · 10 tables after this", and one button saves all of them.
- Merges that already exist are listed above the groups with an Undo.
- On success the screen returns to the batch, where the results list now shows
  the merged tables.

## 5. The schema panel and the pencil

**Reported.** Pressing outside the panel closes it, which is right; pressing a
row's pencil should just show that row's schema in the panel. It should behave
the same on Review schemas.

`SplitPane`'s outside-press handler closes on `pointerdown`, and the pencil
opens on `click`, so opening another row currently depends on a close and a
reopen landing in the right order. Rather than rely on that, the control that
opens the panel opts out of the outside-press check: `SchemaEditButton` and
`SchemaGroupCard` carry `data-panel-open`, and the handler ignores a press that
lands inside one. Opening a row then becomes one state change.

Review schemas has no outside-press close at all today, deliberately: its panel
holds unsaved edits. It gains one, **suppressed while the editor holds an
unsaved draft** — the screen already tracks that as `draftOn`. The original
reason is kept, and the request is met.

## 6. Sorting and column filters

Sorting already works — every header is a sort button, and `DataTable.test.tsx`
covers it. It stays as it is, and the work here is filtering.

`DataTable` already registers `columnFilteringFeature`, `createFilteredRowModel`
and an `includesString` filter function on every column. Nothing drives them.

- A funnel button joins the sort button in each header and opens a small
  popover with a text box: rows are kept where that column contains the text,
  case-insensitively.
- Filters compose with each other and with the existing search box.
- Active filters appear as chips above the table, each removable, with a
  "Clear all".
- The no-rows empty state names whichever of search and filters is responsible,
  rather than always blaming the search.

Filter state lives in `DataTable` with an optional controlled prop, matching how
`globalFilter` is already handled.

---

## Testing

- `discard`: service test for ownership scoping and for the remaining count;
  panel test that a discard removes the row.
- `xlsx`: unit tests on sheet naming (truncation, illegal characters,
  duplicates) and on not-found exporting as an empty cell.
- merge: service tests for the multi-group submit, for every refusal above, and
  for `pollResult` folding members into one entry with the counts still summing
  to the table total. Picker test for the 4-of-A-and-2-of-B selection.
- panel: tests that pressing the pencil of another row moves the panel, and
  that Review schemas does not close over an unsaved draft.
- table: filter tests for one column, two columns composed, composition with
  search, and clearing.

## Order of work

1. "All at once" copy (one line, unblocks nothing, costs nothing)
2. Discard endpoint and panel
3. Column filters
4. Panel / pencil behaviour
5. Merge: migration → endpoints → `pollResult` folding → merged `getTable` → picker
6. Spreadsheet download (last: it wants merges folded in to be worth testing)
