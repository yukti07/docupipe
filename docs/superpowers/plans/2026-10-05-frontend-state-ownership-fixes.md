# Frontend State Ownership Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three verified correctness bugs and two structural problems in the batch → schema → conversion → result state flow, so the screens stop disagreeing with the server.

**Architecture:** Every change is inside `packages/web/src`. No database migration, no API contract change, no infrastructure change. The pattern throughout is the same: a value that the server already owns is either being thrown away, computed locally from the wrong source, or defined in more than one place. Each task moves one of those back to a single source of truth.

**Tech Stack:** Next.js 16 (App Router, client components), React 19, TypeScript, Vitest + Testing Library (jsdom), MSW.

---

## ⚠️ Repository rule: do NOT commit

**This repository's `CLAUDE.md` forbids automatic `git add` / `git commit` / `git rm`.** The user reviews and commits manually.

Every task therefore ends with a **Checkpoint** step instead of a commit step. At a checkpoint: stop, report what changed, and let the user review. Do not stage files. Do not run `git rm` — use `rm` if a file must be deleted.

---

## Background: what was verified, and how

All five items were confirmed by running throwaway tests against the real modules before this plan was written. Those tests were deleted; Task 5 lands the most valuable one permanently.

| Item | Finding | Evidence |
|---|---|---|
| Task 1 | `updateTargetsFor` offers apply-to-many targets that `updateSchemas` rejects | Server throws `"didn't start with the same shape"`; the source schema's own edit rolls back with the batch |
| Task 2 | Discard removes a file from the reducer but not from `localStorage` | After a fresh mount the file returns as an unactionable row; `acceptedCount` stays too high forever |
| Task 3 | `batchPatch` overwrites `fileCount` with a table count | One 3-sheet workbook → card reads "3 files". Already documented in `BatchCard.test.tsx:118-122` |
| Task 4 | Two independent `useBatch` instances; `takeStagedFiles` is destructive | Second screen to mount gets `null` staged files and under-counts |
| Task 5 | Three definitions of "this file has settled", two of which disagree | Harmless only because of a worker invariant the frontend never states |

**A finding that was investigated and REJECTED:** an earlier draft claimed a file could settle into `emptyTables` alone and hang the schema poll. It cannot. `Zamp/python/schema-detector/src/app/pipeline/schema_pipeline.py:131` does `if not versions: raise DomainError(...)`, which fails the whole *file*, and `pollSchemas` short-circuits on `file.stage === "FAILED"` before reading any schema row. Task 5 exists to keep that invariant true, not to fix a live bug.

---

## File Structure

| File | Change | Responsibility after the change |
|---|---|---|
| `packages/web/src/lib/schema.ts` | Modify | `SchemaState` carries the server's `shapeHash`; `updateTargetsFor` gates on it; new `settledFileIds` is the one definition of "settled" |
| `packages/web/src/lib/schema.test.ts` | Modify | Covers the new gate; two tests whose premise is now wrong are rewritten |
| `packages/web/src/state/batchFiles.ts` | Modify | Gains `forgetFile` — a per-file counterpart to `forgetFiles` |
| `packages/web/src/state/batchFiles.test.ts` | Modify | Covers `forgetFile` |
| `packages/web/src/state/batch.tsx` | Modify | `toSchemaState` keeps `shapeHash`; `discardFiles` prunes storage; `settledShapes` uses `settledFileIds` |
| `packages/web/src/state/batch.discard.test.tsx` | Create | Proves a discarded file does not come back on a fresh mount |
| `packages/web/src/state/result.tsx` | Modify | `batchPatch` stops writing `fileCount` |
| `packages/web/src/state/result.test.tsx` | Modify | Covers the removal |
| `packages/web/src/components/quarry/BatchCard.tsx` | Modify | Omits the file count when there is none, like it already does for tables and rows |
| `packages/web/src/components/quarry/BatchCard.test.tsx` | Modify | Covers the omission |
| `packages/web/src/state/batchContext.tsx` | Create | One `useBatch` per request, shared by the two screens that need it |
| `packages/web/src/app/request/[requestId]/layout.tsx` | Create | Mounts the provider; owns the session read for the whole request subtree |
| `packages/web/src/app/request/[requestId]/page.tsx` | Modify | Reads the shared batch instead of building its own |
| `packages/web/src/app/request/[requestId]/schemas/page.tsx` | Modify | Same, plus uses `settledFileIds` |
| `packages/web/src/server/services/schemas.settled.test.ts` | Create | Regression guard for the worker invariant Task 5 depends on |

---

## Task 1: Gate apply-to-many on the server's own shape hash

The server already sends `shapeHash` on every table (`TableSchema.shapeHash` in `lib/api/types.ts:83`, written by `toTableSchema` in `server/services/schemas.ts:176`, and present in the fixtures too). `toSchemaState` receives it and drops it. Picking it up is the whole fix.

**Why `shapeHash` and not `original`:** after a reload, `toSchemaState` re-seeds `original` from the server's *current* (possibly edited) fields, so `original` cannot be trusted for this. `shapeHash` is the worker's hash of the genuinely original fields and is never rewritten by `updateSchemaFields`.

**Files:**
- Modify: `packages/web/src/lib/schema.ts:57-68` (`SchemaState`), `packages/web/src/lib/schema.ts:228-250` (`updateTargetsFor`)
- Modify: `packages/web/src/state/batch.tsx:101-113` (`toSchemaState`)
- Test: `packages/web/src/lib/schema.test.ts`

- [ ] **Step 1: Give the test helper a shape hash, so existing tests keep compiling**

In `packages/web/src/lib/schema.test.ts`, replace the `state` helper (currently at lines 28-37):

```ts
const state = (
  schemaId: string,
  fields: SchemaField[],
  current = fields,
  // The server's hash of the ORIGINAL fields. On a freshly loaded schema that
  // is the hash of `fields`, which is what almost every case here is.
  hash = shapeHash(fields),
): SchemaState => ({
  fileId: `file_${schemaId}`,
  fileName: `${schemaId}.pdf`,
  filePath: `requests/r/${schemaId}.pdf`,
  schemaId,
  tableLabel: "table 1",
  version: 1,
  shapeHash: hash,
  original: fields,
  current,
})
```

- [ ] **Step 2: Write the failing tests for the new gate**

In `packages/web/src/lib/schema.test.ts`, inside `describe("updateTargetsFor", ...)`, add these three tests at the end of the block (just before its closing `})`):

```ts
  it("leaves out a table whose ORIGINAL shape differs, however well the names match", () => {
    // The server keys apply-to-all on the original shape hash and rejects the
    // whole write when two entries disagree — taking the source's own edit
    // down with it. Offering this target is offering a dead button.
    const source = state("sch_1", INVOICE)
    const otherTypes = state("sch_2", [
      f("invoice_number", "text"),
      f("invoice_date", "date"),
      f("total", "text"),
    ])
    expect(updateTargetsFor([source, otherTypes], source)).toEqual([])
  })

  it("leaves out a table that reached this shape by hand from a different one", () => {
    // Same fields today, different documents underneath. The server says no.
    const source = state("sch_1", INVOICE)
    const grown = state(
      "sch_2",
      [f("invoice_number", "text"), f("invoice_date", "date")],
      INVOICE,
    )
    expect(updateTargetsFor([source, grown], source)).toEqual([])
  })

  it("still offers a table short of a field the SOURCE added by hand", () => {
    // Both documents read the same way, so they share a hash; the gap is a
    // field this edit is bringing. The server accepts exactly this.
    const source = state("sch_1", INVOICE, addField(INVOICE, "supplier", "text"))
    const twin = state("sch_2", INVOICE)

    const targets = updateTargetsFor([source, twin], source)
    expect(targets.map((t) => t.schema.schemaId)).toEqual(["sch_2"])
    expect(targets[0].added).toEqual(["supplier"])
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd packages/web && npx vitest run src/lib/schema.test.ts
```

Expected: TypeScript errors on `shapeHash` not existing in `SchemaState`, and the first two new tests failing because `updateTargetsFor` still offers those targets.

- [ ] **Step 4: Add `shapeHash` to `SchemaState`**

In `packages/web/src/lib/schema.ts`, replace the `SchemaState` type (lines 57-68):

```ts
/** One editable schema, held per (fileId, schemaId). */
export type SchemaState = {
  fileId: string
  fileName: string
  filePath: string
  schemaId: string
  tableLabel: string
  version: number
  /**
   * The server's hash of the fields the DOCUMENT came with — never recomputed
   * here. `updateSchemas` keys apply-to-all on it, and it is the only thing
   * that survives a reload: `original` below is re-seeded from whatever the
   * server currently holds, so after an edit it is no longer original at all.
   */
  shapeHash: string
  /** What the document said, so an edited field can say what it used to be. */
  original: SchemaField[]
  current: SchemaField[]
}
```

- [ ] **Step 5: Gate `updateTargetsFor` on it**

In `packages/web/src/lib/schema.ts`, replace `updateTargetsFor` (lines 228-250) in full:

```ts
/**
 * The tables this one can be pushed onto: the ones the server would accept in
 * the same write, minus the ones this shape would take a field away from.
 *
 * The first rule is the server's, not ours. `updateSchemas` requires every
 * entry in a call to share the edited schema's ORIGINAL shape hash, and
 * rejects the whole write otherwise — including the edit to the table the user
 * is actually on. Matching on field names alone offered targets that could
 * never be saved, which is a button that only ever loses work.
 *
 * `added` is the fields this write would bring that the target does not have —
 * they arrive empty. Since both sides share an original shape, a gap can only
 * be a field this edit added by hand.
 */
export function updateTargetsFor(all: SchemaState[], source: SchemaState): UpdateTarget[] {
  const keys = source.current.map((f) => f.key)
  const wanted = new Set(keys)

  return all
    .filter((schema) => schema.schemaId !== source.schemaId)
    .filter((schema) => schema.shapeHash === source.shapeHash)
    .flatMap<UpdateTarget>((schema) => {
      const theirs = new Set(schema.current.map((f) => f.key))
      if ([...theirs].some((key) => !wanted.has(key))) return []
      const added = keys.filter((key) => !theirs.has(key))
      return added.length > 1 ? [] : [{ schema, added }]
    })
    .sort(
      (a, b) =>
        a.added.length - b.added.length || a.schema.fileName.localeCompare(b.schema.fileName),
    )
}
```

- [ ] **Step 6: Carry the hash through from the poll**

In `packages/web/src/state/batch.tsx`, replace `toSchemaState` (lines 101-113):

```ts
function toSchemaState(entry: SchemaEntry): SchemaState | null {
  if (entry.status !== "ready" || !entry.schema || !entry.schemaId) return null
  return {
    fileId: entry.fileId,
    fileName: entry.fileName,
    filePath: entry.filePath,
    schemaId: entry.schemaId,
    tableLabel: entry.schema.tableLabel,
    version: entry.schema.version,
    shapeHash: entry.schema.shapeHash,
    original: entry.schema.fields,
    current: entry.schema.fields,
  }
}
```

- [ ] **Step 7: Fix the two existing tests whose premise is now wrong**

Two tests in `describe("updateTargetsFor", ...)` assert the old rule. Replace them.

Replace the test currently titled `"offers a table short of one field, and names the field it would gain"` (lines 69-76) with:

```ts
  it("offers a table short of one field, and names the field it would gain", () => {
    // Same original shape, so the server accepts the pair. The gap is the
    // field this edit is adding.
    const source = state("sch_1", INVOICE, addField(INVOICE, "supplier", "text"))
    const twin = state("sch_2", INVOICE)

    const targets = updateTargetsFor([source, twin], source)
    expect(targets.map((t) => t.schema.schemaId)).toEqual(["sch_2"])
    expect(targets[0].added).toEqual(["supplier"])
  })
```

Replace the test currently titled `"matches on the fields as they are now, which is what the push would write"` (lines 90-100) with:

```ts
  it("matches on the fields as they are now, within one original shape", () => {
    // sch_2 lost nothing and gained nothing, so the write is exact.
    const source = state("sch_1", INVOICE)
    const twin = state("sch_2", INVOICE)
    expect(updateTargetsFor([source, twin], source)[0].added).toEqual([])
  })
```

Replace the test currently titled `"puts the exact matches first"` (lines 102-112) with:

```ts
  it("puts the exact matches first", () => {
    const source = state("sch_1", INVOICE, addField(INVOICE, "supplier", "text"))
    const short = state("sch_2", INVOICE)
    const exact = state("sch_3", INVOICE, addField(INVOICE, "supplier", "text"))

    expect(updateTargetsFor([source, short, exact], source).map((t) => t.schema.schemaId)).toEqual([
      "sch_3",
      "sch_2",
    ])
  })
```

- [ ] **Step 8: Run the schema tests**

```bash
cd packages/web && npx vitest run src/lib/schema.test.ts
```

Expected: PASS, all tests in the file.

- [ ] **Step 9: Fix the one other file that builds a `SchemaState`**

`components/quarry/SchemaEditor.test.tsx` has the only other literal. Replace its `schema` helper (lines 18-28):

```tsx
const schema = (over: Partial<SchemaState> = {}): SchemaState => ({
  fileId: "file_7a4",
  fileName: "invoice-1045.pdf",
  filePath: "requests/r/invoice-1045.pdf",
  schemaId: "sch_31",
  tableLabel: "table 1",
  version: 1,
  shapeHash: shapeHash(FIELDS),
  original: FIELDS,
  current: FIELDS,
  ...over,
})
```

Add `shapeHash` to that file's import from `@/lib/schema`.

- [ ] **Step 10: Run the full suite and the type check**

```bash
cd packages/web && npx vitest run && npx tsc --noEmit
```

Expected: all test files pass; `tsc` prints nothing. If `tsc` names any other file building a `SchemaState`, add `shapeHash` there the same way — from the server value if one is in scope, or `shapeHash(fields)` in a fixture.

- [ ] **Step 11: Checkpoint**

Stop. Report: `lib/schema.ts`, `lib/schema.test.ts`, `state/batch.tsx` changed. Do not stage or commit — the user does that.

---

## Task 2: Forget a discarded file from browser storage

`discardFiles` removes the file from the reducer but leaves it in `quarry.batch.<id>.files`. On the next mount it returns as a row with `stage: "uploaded"`, no shape and no failure — in neither `schemas` nor `wontConvert`, so `WontConvertPanel` is empty and there is no control to remove it. `acceptedCount` keeps counting it, so "every file has settled" can never become true.

**Files:**
- Modify: `packages/web/src/state/batchFiles.ts` (add `forgetFile` next to `forgetFiles`)
- Modify: `packages/web/src/state/batch.tsx:543-558` (`discardFiles`)
- Test: `packages/web/src/state/batchFiles.test.ts`, and a new `packages/web/src/state/batch.discard.test.tsx`

- [ ] **Step 1: Write the failing unit test for `forgetFile`**

Append to `packages/web/src/state/batchFiles.test.ts`, inside the existing top-level `describe` block if there is one, otherwise at the end of the file:

```ts
describe("forgetFile", () => {
  const file = (fileId: string) => ({
    fileId,
    fileName: `${fileId}.pdf`,
    fileLocation: `${fileId}.pdf`,
    size: 10,
    filePath: `p/${fileId}`,
    expiresAt: "2099-01-01T00:00:00Z",
  })

  it("drops only the named files and leaves the rest", () => {
    rememberFiles("req_1", [file("f_1"), file("f_2"), file("f_3")])
    forgetFile("req_1", ["f_2"])
    expect(readRememberedFiles("req_1").map((f) => f.fileId)).toEqual(["f_1", "f_3"])
  })

  it("drops the file from the unreadable set too", () => {
    // A discard is offered for exactly the files that landed here, so leaving
    // the id behind would keep a deleted file influencing the results screen.
    rememberFiles("req_1", [file("f_1"), file("f_2")])
    rememberUnreadable("req_1", ["f_2"])
    forgetFile("req_1", ["f_2"])
    expect(readUnreadable("req_1")).toEqual([])
  })

  it("clears the map rather than leaving a husk when the last file goes", () => {
    rememberFiles("req_1", [file("f_1")])
    forgetFile("req_1", ["f_1"])
    expect(readRememberedFiles("req_1")).toEqual([])
    expect(localStorage.getItem("quarry.batch.req_1.files")).toBeNull()
  })

  it("does nothing for a request it holds nothing for", () => {
    expect(() => forgetFile("req_unknown", ["f_1"])).not.toThrow()
  })
})
```

Update the import at the top of `packages/web/src/state/batchFiles.test.ts` to include the new names:

```ts
import {
  forgetFile,
  forgetFiles,
  readRememberedFiles,
  readUnreadable,
  rememberFiles,
  rememberUnreadable,
} from "./batchFiles"
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/web && npx vitest run src/state/batchFiles.test.ts
```

Expected: FAIL — `forgetFile is not a function` / TypeScript error on the import.

- [ ] **Step 3: Implement `forgetFile`**

In `packages/web/src/state/batchFiles.ts`, insert this immediately **above** the existing `forgetFiles` function (which is at line 94):

```ts
/**
 * Take specific files out of what this browser remembers.
 *
 * The counterpart to a discard. Without it the row comes back on the next
 * load — the server has soft-deleted the file so no poll will ever mention it
 * again, which leaves a row with no shape, no failure and no way to remove it,
 * and an accepted-file count that can never settle.
 *
 * Both maps, because a discard is offered for exactly the files the unreadable
 * set is made of.
 */
export function forgetFile(requestId: string, fileIds: string[]) {
  if (fileIds.length === 0) return
  const dropped = new Set(fileIds)
  try {
    const kept = readRememberedFiles(requestId).filter((file) => !dropped.has(file.fileId))
    if (kept.length === 0) localStorage.removeItem(keyFor(requestId))
    else localStorage.setItem(keyFor(requestId), JSON.stringify(kept))

    const unreadable = readUnreadable(requestId).filter((id) => !dropped.has(id))
    if (unreadable.length === 0) localStorage.removeItem(unreadableKeyFor(requestId))
    else localStorage.setItem(unreadableKeyFor(requestId), JSON.stringify(unreadable))
  } catch {
    // Losing the prune costs a stale row after a refresh, not the discard.
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd packages/web && npx vitest run src/state/batchFiles.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write the failing integration test**

Create `packages/web/src/state/batch.discard.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render } from "@/test/render"
import { api } from "@/lib/api"
import type { SchemaPollResponse } from "@/lib/api/types"
import { useBatch, type UseBatch } from "@/state/batch"
import { readRememberedFiles, readUnreadable } from "@/state/batchFiles"

/**
 * A discarded file is soft-deleted on the server, so no later poll mentions
 * it. If this browser keeps remembering it, the next load puts it back as a
 * row nothing can ever answer for.
 */

const REQ = "req_1"

const remembered = (fileId: string, fileName: string) => ({
  fileId,
  fileName,
  fileLocation: fileName,
  size: 10,
  filePath: `p/${fileId}`,
  expiresAt: "2099-01-01T00:00:00Z",
})

/** What the server says once the discard has gone through. */
const afterDiscard = (): SchemaPollResponse => ({
  userId: "usr_1",
  requestId: REQ,
  pending: 0,
  convertAvailable: true,
  convertBlockedReason: null,
  files: [],
})

let latest: UseBatch
function Probe() {
  latest = useBatch(REQ, "usr_1")
  return null
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

const seed = () => {
  localStorage.setItem(
    `quarry.batch.${REQ}.files`,
    JSON.stringify([remembered("f_good", "good.pdf"), remembered("f_bad", "scan.pdf")]),
  )
  localStorage.setItem(`quarry.batch.${REQ}.unreadable`, JSON.stringify(["f_bad"]))
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.spyOn(api, "pollSchemas").mockResolvedValue(afterDiscard())
})

describe("discarding a file", () => {
  it("takes it out of what this browser remembers", async () => {
    seed()
    vi.spyOn(api, "discardFiles").mockResolvedValue({
      status: "ok",
      discarded: 1,
      remaining: 1,
    })

    render(<Probe />)
    await flush()
    expect(latest.files.map((f) => f.fileId)).toEqual(["f_good", "f_bad"])

    await act(async () => {
      await latest.discardFiles(["f_bad"])
    })

    expect(latest.files.map((f) => f.fileId)).toEqual(["f_good"])
    expect(readRememberedFiles(REQ).map((f) => f.fileId)).toEqual(["f_good"])
    expect(readUnreadable(REQ)).toEqual([])
  })

  it("does not bring it back on a fresh mount", async () => {
    seed()
    vi.spyOn(api, "discardFiles").mockResolvedValue({
      status: "ok",
      discarded: 1,
      remaining: 1,
    })

    const first = render(<Probe />)
    await flush()
    await act(async () => {
      await latest.discardFiles(["f_bad"])
    })
    first.unmount()

    render(<Probe />)
    await flush()
    expect(latest.files.map((f) => f.fileId)).toEqual(["f_good"])
    expect(latest.acceptedCount).toBe(1)
  })

  it("keeps the file when the server refuses the discard", async () => {
    seed()
    vi.spyOn(api, "discardFiles").mockRejectedValue(new Error("nope"))

    render(<Probe />)
    await flush()
    await act(async () => {
      await latest.discardFiles(["f_bad"])
    })

    // A discard that failed and looked like it worked is the worse outcome.
    expect(latest.files.map((f) => f.fileId)).toEqual(["f_good", "f_bad"])
    expect(readRememberedFiles(REQ).map((f) => f.fileId)).toEqual(["f_good", "f_bad"])
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

```bash
cd packages/web && npx vitest run src/state/batch.discard.test.tsx
```

Expected: the first two tests FAIL — `readRememberedFiles` still returns `["f_good", "f_bad"]`, and the remount shows two files. The third test passes already.

- [ ] **Step 7: Prune storage on a successful discard**

In `packages/web/src/state/batch.tsx`, replace the `discardFiles` callback (lines 543-558):

```ts
  const discardFiles = useCallback<UseBatch["discardFiles"]>(
    async (fileIds) => {
      if (!userId || fileIds.length === 0) return state.files.length
      try {
        const response = await api.discardFiles(userId, requestId, fileIds)
        // Before the dispatch, because what this browser remembers is a
        // projection of what the server holds: the file is gone from there
        // now, and a reload that brought it back would show a row with no
        // shape, no failure and nothing on screen able to remove it.
        forgetFile(requestId, fileIds)
        dispatch({ type: "discarded-files", fileIds })
        return response.remaining
      } catch {
        // The row stays. A discard that failed and looked like it worked would
        // put the file back on the next poll with no explanation.
        return state.files.length
      }
    },
    [requestId, state.files.length, userId],
  )
```

Then update the import at `packages/web/src/state/batch.tsx:17-22` to pull in `forgetFile`:

```ts
import {
  forgetFile,
  readRememberedFiles,
  rememberFiles,
  rememberUnreadable,
  type RememberedFile,
} from "@/state/batchFiles"
```

- [ ] **Step 8: Run both test files to verify they pass**

```bash
cd packages/web && npx vitest run src/state/batchFiles.test.ts src/state/batch.discard.test.tsx
```

Expected: PASS, all tests in both files.

- [ ] **Step 9: Run the full suite**

```bash
cd packages/web && npx vitest run && npx tsc --noEmit
```

Expected: all pass, `tsc` silent.

- [ ] **Step 10: Checkpoint**

Stop. Report: `state/batchFiles.ts`, `state/batchFiles.test.ts`, `state/batch.tsx` changed; `state/batch.discard.test.tsx` created. Do not stage or commit.

---

## Task 3: Stop labelling a table count as a file count

`batchPatch` overwrites `WorkspaceBatch.fileCount` with `data.files.length`, and `ResultPollResponse.files` is one entry per **table** with merges collapsed (`server/services/convert.ts:205`). `BatchCard` prints that as "N files".

**Why no new `tableCount` field:** the card already prints a table count from `summary.tables`, and `batchPatch` already sets it. Adding a second table count would be the same fact stored twice — the exact thing this work is removing. The `fileCount` overwrite exists so a batch learned from a shared link has *some* number; the honest answer is that this browser does not know the file count, and the card already omits parts it has no number for.

**Files:**
- Modify: `packages/web/src/state/result.tsx:122-128` (`batchPatch`)
- Modify: `packages/web/src/components/quarry/BatchCard.tsx:80-86` (`contents`)
- Test: `packages/web/src/state/result.test.tsx`, `packages/web/src/components/quarry/BatchCard.test.tsx`

- [ ] **Step 1: Write the failing test for `batchPatch`**

Append to `packages/web/src/state/result.test.tsx`, at the end of the file:

```tsx
describe("batchPatch", () => {
  it("does not touch the file count — `files` is one entry per TABLE", () => {
    // One three-sheet workbook comes back as three entries. Writing that into
    // fileCount made the card read "3 files" for a single dropped file.
    const data = response({
      status: "COMPLETED",
      counts: { queued: 0, extracting: 0, filling: 0, done: 3, failed: 0 },
      files: [
        { fileId: "f_1", fileName: "books.xlsx", schemaId: "sch_0", stage: "DONE", rowCount: 5 },
        { fileId: "f_1", fileName: "books.xlsx", schemaId: "sch_1", stage: "DONE", rowCount: 7 },
        { fileId: "f_1", fileName: "books.xlsx", schemaId: "sch_2", stage: "DONE", rowCount: 2 },
      ],
    })

    expect(batchPatch(data)).not.toHaveProperty("fileCount")
  })

  it("still reports the tables, the rows and the phase", () => {
    const data = response({
      status: "COMPLETED",
      counts: { queued: 0, extracting: 0, filling: 0, done: 3, failed: 1 },
      rowsSoFar: 14,
    })
    const patch = batchPatch(data)

    expect(patch.phase).toBe("done")
    expect(patch.summary?.tables).toBe(3)
    expect(patch.summary?.rows).toBe(14)
    expect(patch.summary?.failed).toBe(1)
  })
})
```

Add `batchPatch` to the existing import from `./result` at the top of `packages/web/src/state/result.test.tsx`:

```tsx
import {
  batchPatch,
  PAUSED_POLL_MS,
  RESULT_POLL_MS,
  RESULT_WARMUP_MS,
  RESULT_WARMUP_POLL_MS,
  useResultPolling,
} from "./result"
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/web && npx vitest run src/state/result.test.tsx
```

Expected: FAIL on the first new test — the patch has `fileCount: 3`.

- [ ] **Step 3: Remove the overwrite**

In `packages/web/src/state/result.tsx`, replace the opening of `batchPatch`'s returned object (lines 122-128) so the `fileCount` line is gone and the comment explains why:

```ts
  return {
    // Deliberately no fileCount. `data.files` is one entry per TABLE, with
    // merges collapsed into one — so writing its length here told a card for
    // one three-sheet workbook that it held three files, and told a merged
    // batch it had lost some. The file count is the drop's own, written once
    // when the batch was made; a batch this browser learned about from a
    // shared link has no honest file count and the card says nothing instead.
    phase:
```

Leave the rest of the function exactly as it is.

- [ ] **Step 4: Run it to verify it passes**

```bash
cd packages/web && npx vitest run src/state/result.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Write the failing test for the card**

In `packages/web/src/components/quarry/BatchCard.test.tsx`, add this test inside the existing top-level `describe` block, after the test titled `"counts files, tables and rows once the batch has them"`:

```tsx
  it("says nothing about files for a batch it has no file count for", () => {
    // A batch learned from a shared `?w=` link: this browser never saw the
    // drop, so it has no file count. "0 files" would be a claim, not a gap.
    render(
      <BatchCard
        batch={{ ...base, fileCount: 0, summary: { tables: 3, rows: 140 } }}
      />,
    )
    expect(screen.getByText("3 tables · 140 rows")).toBeVisible()
    expect(screen.queryByText(/0 files/)).not.toBeInTheDocument()
  })
```

- [ ] **Step 6: Run it to verify it fails**

```bash
cd packages/web && npx vitest run src/components/quarry/BatchCard.test.tsx
```

Expected: FAIL — the card renders `"0 files · 3 tables · 140 rows"`.

- [ ] **Step 7: Omit the files part when there is no count**

In `packages/web/src/components/quarry/BatchCard.tsx`, replace the `contents` function (lines 80-86):

```tsx
function contents(batch: WorkspaceBatch): string {
  const { tables = 0, rows = 0 } = batch.summary
  const parts: string[] = []
  // A batch opened from a shared link was never dropped in this browser, so
  // there is no file count to give — and nought is a claim rather than a gap.
  if (batch.fileCount > 0) {
    parts.push(`${formatCount(batch.fileCount)} ${batch.fileCount === 1 ? "file" : "files"}`)
  }
  if (tables > 0) parts.push(`${formatCount(tables)} ${tables === 1 ? "table" : "tables"}`)
  if (rows > 0) parts.push(`${formatCount(rows)} ${rows === 1 ? "row" : "rows"}`)
  return parts.join(" · ")
}
```

- [ ] **Step 8: Run it to verify it passes**

```bash
cd packages/web && npx vitest run src/components/quarry/BatchCard.test.tsx
```

Expected: PASS, all tests in the file.

- [ ] **Step 9: Update the stale comment that documented the bug**

In `packages/web/src/components/quarry/BatchCard.test.tsx`, replace the comment block above the test titled `"says what the batch's own phase says, and does not second-guess it"` (currently lines 117-122):

```tsx
  // The card says what the last poll said, and `useWorkspaceRefresh` is what
  // makes sure that was recent. Deriving "it must have finished by now" from
  // the counts instead read them against `fileCount` — which no longer moves
  // at all, and never did mean what the name says here. The phase is the one
  // thing that answers this.
```

- [ ] **Step 10: Run the full suite**

```bash
cd packages/web && npx vitest run && npx tsc --noEmit
```

Expected: all pass, `tsc` silent.

- [ ] **Step 11: Checkpoint**

Stop. Report: `state/result.tsx`, `state/result.test.tsx`, `components/quarry/BatchCard.tsx`, `components/quarry/BatchCard.test.tsx` changed. Do not stage or commit.

---

## Task 4: One batch state per request, shared by both screens

`/request/[id]` and `/request/[id]/schemas` each call `useBatch`, so each builds its own reducer, its own schema poll and its own upload queue. `takeStagedFiles` deletes from the module map, so the second screen to mount gets `null` and falls back to confirmed files only — which under-counts while an upload is in flight, and leaves `runUpload` dispatching into a dead reducer.

**Scope note:** the `[requestId]` layout also wraps `table/[schemaId]` and `merge`, which must not poll for schemas. The provider gates polling on the pathname rather than mounting a second provider tree, because route groups would mean moving page files for no other reason.

**Files:**
- Create: `packages/web/src/state/batchContext.tsx`
- Create: `packages/web/src/app/request/[requestId]/layout.tsx`
- Modify: `packages/web/src/app/request/[requestId]/page.tsx:52-66, 132`
- Modify: `packages/web/src/app/request/[requestId]/schemas/page.tsx:47-66`
- Test: `packages/web/src/state/batchContext.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/state/batchContext.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@/test/render"
import { api } from "@/lib/api"
import type { SchemaPollResponse } from "@/lib/api/types"
import { BatchProvider, useBatchContext } from "@/state/batchContext"

const poll = (): SchemaPollResponse => ({
  userId: "usr_1",
  requestId: "req_1",
  pending: 0,
  convertAvailable: true,
  convertBlockedReason: null,
  files: [],
})

function Reader({ label }: { label: string }) {
  const batch = useBatchContext()
  return <p>{`${label}:${batch.files.length}`}</p>
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe("BatchProvider", () => {
  it("polls once however many readers are under it", async () => {
    localStorage.setItem(
      "quarry.batch.req_1.files",
      JSON.stringify([
        {
          fileId: "f_1",
          fileName: "a.pdf",
          fileLocation: "a.pdf",
          size: 1,
          filePath: "p",
          expiresAt: "2099-01-01T00:00:00Z",
        },
      ]),
    )
    const pollSchemas = vi.spyOn(api, "pollSchemas").mockResolvedValue(poll())

    render(
      <BatchProvider requestId="req_1" userId="usr_1" pollSchemas>
        <Reader label="one" />
        <Reader label="two" />
      </BatchProvider>,
    )
    await flush()

    expect(pollSchemas).toHaveBeenCalledTimes(1)
    expect(screen.getByText("one:1")).toBeVisible()
    expect(screen.getByText("two:1")).toBeVisible()
  })

  it("does not poll on a screen that has no use for schemas", async () => {
    const pollSchemas = vi.spyOn(api, "pollSchemas").mockResolvedValue(poll())

    render(
      <BatchProvider requestId="req_1" userId="usr_1" pollSchemas={false}>
        <Reader label="one" />
      </BatchProvider>,
    )
    await flush()

    expect(pollSchemas).not.toHaveBeenCalled()
  })

  it("refuses to be read outside its provider, rather than handing back an empty batch", () => {
    // An empty batch would render as "nothing staged in this browser", which
    // is a sentence about the user's files, not about a missing provider.
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => render(<Reader label="loose" />)).toThrow(
      /useBatchContext must be used inside a BatchProvider/,
    )
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/web && npx vitest run src/state/batchContext.test.tsx
```

Expected: FAIL — cannot resolve `@/state/batchContext`.

- [ ] **Step 3: Write the provider**

Create `packages/web/src/state/batchContext.tsx`:

```tsx
"use client"

import { createContext, useContext, type ReactNode } from "react"
import { useBatch, type UseBatch } from "@/state/batch"

/**
 * One batch state per request, for every screen inside it.
 *
 * Both Prepare and Review schemas are views of the same upload and the same
 * set of shapes, and each used to build its own: two reducers, two schema
 * polls, and two calls to `takeStagedFiles` — which hands the dropped files
 * over exactly once. The second screen to mount therefore got nothing and fell
 * back to the files already confirmed, so moving between them mid-upload
 * showed fewer files than were dropped and counted them wrong, while the
 * uploads carried on dispatching into a reducer nobody was rendering.
 */
const BatchContext = createContext<UseBatch | null>(null)

export function BatchProvider({
  requestId,
  userId,
  /** False on the screens that have no use for shapes — a table, or Merge. */
  pollSchemas,
  children,
}: {
  requestId: string
  userId: string | null
  pollSchemas: boolean
  children: ReactNode
}) {
  const batch = useBatch(requestId, userId, { pollSchemas })
  return <BatchContext.Provider value={batch}>{children}</BatchContext.Provider>
}

export function useBatchContext(): UseBatch {
  const value = useContext(BatchContext)
  if (!value) throw new Error("useBatchContext must be used inside a BatchProvider")
  return value
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd packages/web && npx vitest run src/state/batchContext.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Mount the provider on the request layout**

Create `packages/web/src/app/request/[requestId]/layout.tsx`:

```tsx
"use client"

import { usePathname } from "next/navigation"
import { use, useEffect, useState, type ReactNode } from "react"
import { ensureSession } from "@/lib/session"
import { BatchProvider } from "@/state/batchContext"

/**
 * Everything under one request shares one session read and one batch state.
 *
 * Shapes are only polled for on the two screens that are about them. A table
 * and the merge picker live past the gate, where nothing is still being read,
 * and a poll there would be a request per five seconds for an answer no
 * screen renders.
 */
export default function RequestLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ requestId: string }>
}) {
  const { requestId } = use(params)
  const [userId, setUserId] = useState<string | null>(null)
  const pathname = usePathname()

  useEffect(() => {
    void ensureSession().then(setUserId)
  }, [])

  const wantsSchemas =
    pathname === `/request/${requestId}` || pathname === `/request/${requestId}/schemas`

  return (
    <BatchProvider requestId={requestId} userId={userId} pollSchemas={wantsSchemas}>
      {children}
    </BatchProvider>
  )
}
```

- [ ] **Step 6: Switch the Prepare screen onto the shared state**

In `packages/web/src/app/request/[requestId]/page.tsx`, change the import at line 42 from `useBatch` to the context hook. Replace:

```tsx
import { useBatch, type BatchFile } from "@/state/batch"
```

with:

```tsx
import { type BatchFile } from "@/state/batch"
import { useBatchContext } from "@/state/batchContext"
```

Then in the `Prepare` component, replace line 132:

```tsx
  const batch = useBatch(requestId, userId)
```

with:

```tsx
  const batch = useBatchContext()
```

`Prepare` still takes `requestId` and `userId` as props and still uses them for links and for `ensureSession`-dependent children, so leave its signature alone.

- [ ] **Step 7: Switch the Review schemas screen onto the shared state**

In `packages/web/src/app/request/[requestId]/schemas/page.tsx`, replace:

```tsx
import { useBatch } from "@/state/batch"
```

with:

```tsx
import { useBatchContext } from "@/state/batchContext"
```

Then replace line 50:

```tsx
  const batch = useBatch(requestId, userId)
```

with:

```tsx
  const batch = useBatchContext()
```

`userId` is used nowhere else in this file — only on line 50 to build the batch. Delete all three of its remnants:

- line 20: `import { ensureSession } from "@/lib/session"`
- line 47: `const [userId, setUserId] = useState<string | null>(null)`
- lines 66-68:

```tsx
  useEffect(() => {
    void ensureSession().then(setUserId)
  }, [])
```

If `useEffect` is then unused in the file, drop it from the `react` import on line 5 too.

- [ ] **Step 8: Wrap the two page tests in the provider**

Both `app/request/[requestId]/page.test.tsx` and `app/request/[requestId]/schemas/page.test.tsx` render their page component directly, with no layout above it, so both will now throw `useBatchContext must be used inside a BatchProvider`.

In each file, add the import and a local render helper:

```tsx
import type { ReactElement } from "react"
import { BatchProvider } from "@/state/batchContext"

const renderPage = (ui: ReactElement) =>
  render(
    <BatchProvider requestId="req_1" userId="usr_1" pollSchemas>
      {ui}
    </BatchProvider>,
  )
```

Then change every `render(<BatchPage .../>)` / `render(<ReviewSchemasPage .../>)` call to `renderPage(...)`. Use whatever `requestId` and `userId` that file's existing setup already uses rather than the literals above, so the MSW handlers and `localStorage` seeds still match.

Run them:

```bash
cd packages/web && npx vitest run src/app/request
```

Expected: PASS, both files.

- [ ] **Step 9: Run the full suite and the type check**

```bash
cd packages/web && npx vitest run && npx tsc --noEmit
```

Expected: all pass, `tsc` silent.

- [ ] **Step 10: Verify it in the browser**

```bash
cd packages/web && npm run fixtures:on
```

Then start the dev server and check, by hand:
1. Drop three files on the workspace. While the bars are still moving, press **Review schemas**.
2. The schemas screen shows a card or a pending card for **all three** files, not only the ones that finished uploading.
3. Press the rail's **Files** step to go back. The file list still shows all three, with their progress where it should be.
4. Open a finished table, then **Merge**. Confirm in the network panel that no `polling/schema` request fires on either screen.

- [ ] **Step 11: Checkpoint**

Stop. Report: `state/batchContext.tsx` and `app/request/[requestId]/layout.tsx` created; both request pages and any affected page tests changed. Do not stage or commit.

---

## Task 5: One definition of "this file has settled"

Three places answer "has this file finished being read?" and two of them give different answers: `settledShapes` in `state/batch.tsx:422` and `allShapesSettled` in `lib/schema.ts:261` use `schemas ∪ wontConvert`; the schemas page's own `settled` set at `schemas/page.tsx:111` adds `emptyTables`.

This is latent, not live. The worker guarantees that a file with a table-level failure always also has at least one readable table, so the three never actually disagree. The frontend never states that guarantee, which is what this task fixes — one function, plus a test that fails the day the guarantee stops holding.

**Files:**
- Modify: `packages/web/src/lib/schema.ts:255-272` (`allShapesSettled`, plus a new `settledFileIds`)
- Modify: `packages/web/src/state/batch.tsx:422-429` (`settledShapes`)
- Modify: `packages/web/src/app/request/[requestId]/schemas/page.tsx:111-119` (`settled`)
- Test: `packages/web/src/lib/schema.test.ts`
- Create: `packages/web/src/server/services/schemas.settled.test.ts`

- [ ] **Step 1: Write the failing tests for `settledFileIds`**

In `packages/web/src/lib/schema.test.ts`, add a new `describe` block immediately above the existing `describe("allShapesSettled", ...)`:

```ts
describe("settledFileIds", () => {
  const id = (fileId: string) => ({ fileId })

  it("counts a file that gave up a shape", () => {
    expect([...settledFileIds([id("f1")], [], [])]).toEqual(["f1"])
  })

  it("counts a file that gave up a reason instead", () => {
    expect([...settledFileIds([], [id("f1")], [])]).toEqual(["f1"])
  })

  it("counts a file whose only answer was a table that held nothing", () => {
    // Not reachable from the current worker — it fails the whole file when no
    // sheet produces a shape. Counted anyway, because a settled answer is a
    // settled answer and the alternative is a screen that reads forever.
    expect([...settledFileIds([], [], [id("f1")])]).toEqual(["f1"])
  })

  it("counts a file once however many tables it gave up", () => {
    expect(settledFileIds([id("f1"), id("f1"), id("f1")], [], []).size).toBe(1)
  })
})
```

Add `settledFileIds` to the import list at the top of `packages/web/src/lib/schema.test.ts`.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/web && npx vitest run src/lib/schema.test.ts
```

Expected: FAIL — `settledFileIds` is not exported.

- [ ] **Step 3: Write `settledFileIds` and route `allShapesSettled` through it**

In `packages/web/src/lib/schema.ts`, replace `allShapesSettled` (lines 255-272) with both functions:

```ts
/**
 * Every file the server has answered for, one way or another: with a shape,
 * with a reason it has none, or with a table that held nothing.
 *
 * The one definition, because there used to be three and two of them left
 * `emptyTables` out. That gap is unreachable today — when no sheet in a file
 * produces a shape the worker fails the FILE, which arrives here as a
 * file-level failure and lands in `wontConvert` (see
 * `schema_pipeline._detect`, and the regression test beside `pollSchemas`).
 * Spelling the rule once means a change to that invariant breaks a test
 * rather than a screen that reads "Detecting" for the rest of a run.
 */
export function settledFileIds(
  schemas: { fileId: string }[],
  wontConvert: { fileId: string }[],
  emptyTables: { fileId: string }[],
): Set<string> {
  return new Set([
    ...schemas.map((s) => s.fileId),
    ...wontConvert.map((w) => w.fileId),
    ...emptyTables.map((t) => t.fileId),
  ])
}

/**
 * Whether every accepted file has settled a shape — one it gave up, or the
 * reason it has none. Both count: a file that could not be read has finished
 * being read just as surely as one that was.
 *
 * Counted over the files themselves rather than by summing the lists, so a
 * file that gave up three tables still counts once.
 */
export function allShapesSettled(
  schemas: { fileId: string }[],
  wontConvert: { fileId: string }[],
  acceptedCount: number,
  emptyTables: { fileId: string }[] = [],
): boolean {
  if (acceptedCount === 0) return false
  return settledFileIds(schemas, wontConvert, emptyTables).size >= acceptedCount
}
```

The new `emptyTables` parameter is last and defaults to `[]`, so the two existing call sites keep compiling unchanged.

- [ ] **Step 4: Run it to verify it passes**

```bash
cd packages/web && npx vitest run src/lib/schema.test.ts
```

Expected: PASS, including the four pre-existing `allShapesSettled` tests.

- [ ] **Step 5: Use it in the poll's stop condition**

In `packages/web/src/state/batch.tsx`, replace the `settledShapes` memo (lines 422-429):

```ts
  const settledShapes = useMemo(
    () => settledFileIds(state.schemas, state.wontConvert, state.emptyTables),
    [state.schemas, state.wontConvert, state.emptyTables],
  )
```

Then add `settledFileIds` to the import from `@/lib/schema` at line 16:

```ts
import {
  partitionFailures,
  settledFileIds,
  type SchemaState,
  type TableFailure,
} from "@/lib/schema"
```

- [ ] **Step 6: Use it on the Review schemas screen**

In `packages/web/src/app/request/[requestId]/schemas/page.tsx`, replace the `settled` memo (lines 109-119):

```tsx
  // Every file the server has now answered for, one way or another.
  const settled = useMemo(
    () => settledFileIds(batch.schemas, batch.wontConvert, batch.emptyTables),
    [batch.schemas, batch.wontConvert, batch.emptyTables],
  )
```

Add `settledFileIds` to the existing import from `@/lib/schema` on line 19:

```tsx
import {
  allShapesSettled,
  groupByCurrentShape,
  settledFileIds,
  tableName,
  updateTargetsFor,
} from "@/lib/schema"
```

- [ ] **Step 7: Write the regression guard for the worker invariant**

Create `packages/web/src/server/services/schemas.settled.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { partitionFailures, settledFileIds } from "@/lib/schema"
import type { SchemaEntry } from "@/lib/api/types"

/**
 * The frontend stops polling for shapes when every file that landed has
 * settled. That is only safe because of an invariant the worker holds and the
 * frontend cannot see: a file reaches SCHEMA_READY only if at least one of its
 * tables produced a shape, and a file where none did is failed as a FILE —
 * `schema_pipeline._detect`, `if not versions: raise DomainError(...)`.
 *
 * If that ever changes, the poll would run its whole budget and the screen
 * would read "Detecting" for the rest of the run. This fails first instead.
 */

const getRequest = vi.fn()
const listFiles = vi.fn()
const listSchemas = vi.fn()
const shapeCounts = vi.fn()

vi.mock("../db/repos", () => ({
  getRequest: (...a: unknown[]) => getRequest(...a),
  listFiles: (...a: unknown[]) => listFiles(...a),
  listSchemas: (...a: unknown[]) => listSchemas(...a),
  shapeCounts: (...a: unknown[]) => shapeCounts(...a),
}))

const { pollSchemas } = await import("./schemas")

const ready = (ord: number) => ({
  id: `sch_${ord}`,
  file_id: "f_1",
  table_ord: ord,
  table_label: `Sheet ${ord + 1}`,
  version: 1,
  shape_hash: "h",
  failure_class: null,
  failure_detail: null,
  fields: [{ key: "a", label: "a", type: "text" }],
})

const failedTable = (ord: number) => ({
  ...ready(ord),
  failure_class: "schema_not_found",
  fields: [],
})

const setup = (stage: string, schemas: unknown[]) => {
  getRequest.mockResolvedValue({ id: "R1", converted_at: null })
  listFiles.mockResolvedValue([
    { id: "f_1", original_filename: "books.xlsx", stage, object_key: "k" },
  ])
  listSchemas.mockResolvedValue(schemas)
  shapeCounts.mockResolvedValue(new Map([["h", 1]]))
}

/** The poll's own stop condition, read off a response. */
const settles = (entries: SchemaEntry[]) => {
  const { files, tables } = partitionFailures(entries)
  const shapes = entries.filter((e) => e.status === "ready")
  return settledFileIds(shapes, files, tables).has("f_1")
}

describe("a file always settles, whatever its tables did", () => {
  it("settles a workbook with one empty sheet and two readable ones", async () => {
    setup("SCHEMA_READY", [ready(0), failedTable(1), ready(2)])
    const { files } = await pollSchemas("u1", "R1", [])

    expect(partitionFailures(files).tables).toHaveLength(1)
    expect(settles(files)).toBe(true)
  })

  it("settles a workbook where every sheet was empty, as a FILE-level failure", async () => {
    // The stage is the invariant: the worker failed the file, so the poll
    // short-circuits before it reads a single schema row.
    setup("FAILED", [failedTable(0), failedTable(1)])
    const { files } = await pollSchemas("u1", "R1", [])

    expect(files).toHaveLength(1)
    expect(files[0].schemaId).toBeNull()
    expect(partitionFailures(files).tables).toEqual([])
    expect(settles(files)).toBe(true)
  })

  it("settles even if a file ever reaches SCHEMA_READY with every table failed", async () => {
    // Not producible by the current worker. `settledFileIds` counts
    // `emptyTables` so that if it ever becomes producible, the poll stops.
    setup("SCHEMA_READY", [failedTable(0), failedTable(1)])
    const { files } = await pollSchemas("u1", "R1", [])

    expect(partitionFailures(files).tables).toHaveLength(2)
    expect(partitionFailures(files).files).toEqual([])
    expect(settles(files)).toBe(true)
  })
})
```

- [ ] **Step 8: Run the new server test**

```bash
cd packages/web && npx vitest run src/server/services/schemas.settled.test.ts
```

Expected: PASS, all three. The third test is the one that would have failed before Task 5.

- [ ] **Step 9: Run the full suite and the type check**

```bash
cd packages/web && npx vitest run && npx tsc --noEmit
```

Expected: all pass, `tsc` silent.

- [ ] **Step 10: Checkpoint**

Stop. Report: `lib/schema.ts`, `lib/schema.test.ts`, `state/batch.tsx`, `schemas/page.tsx` changed; `server/services/schemas.settled.test.ts` created. Do not stage or commit.

---

## Final verification

- [ ] **Run everything**

```bash
cd packages/web && npx vitest run && npx tsc --noEmit && npm run lint
```

Expected: all test files pass; `tsc` and `eslint` print nothing.

- [ ] **Confirm nothing crossed the boundary**

```bash
cd /d/repos/react_DocumentConverter && git status --short
```

Expected: every changed path is under `packages/web/src` or `docs/`. **Nothing** under `packages/db/prisma/migrations`, `packages/worker`, or `Zamp`. If anything else appears, stop and ask — the whole premise of this plan is that no migration or worker change is needed.

- [ ] **Walk the flow against fixtures**

```bash
cd packages/web && npm run fixtures:on
```

Start the dev server and check:
1. Drop a folder of files. Watch the bars, then go to **Review schemas** mid-upload — every file is accounted for.
2. Edit one schema's field type and press **Update matching tables**. The tables offered all save; nothing is rejected.
3. Discard a file from the won't-convert panel, then reload. It stays gone.
4. Return to the workspace. The card's file count matches what you dropped, whatever the tables did.

- [ ] **Hand back**

Report everything changed and created. Remind the user that nothing has been staged or committed, per the repository rule.

---

## Out of scope

Recorded so they are not lost, and so nobody assumes they were missed:

- **Schema re-sync (P1-2).** The schema poll is a delta keyed on `fileId`, so the server never re-sends a file the client already holds, and `updateSchemaFields` increments `version` unconditionally with no expected-version check. Two tabs, or a save whose response is lost, end in a silent last-write-wins. **This is the only item on the list that needs an API change** — `received` would carry `fileId:version` pairs, or the save would carry an expected version. No migration either way; the `version` column already exists.
- **Session identity drift (P1-5).** `workspace.tsx`'s `subscribe` only listens for the `quarry.workspace` key, so a `?w=` adoption in another tab syncs the batch list but not the identity. Wants a `SessionProvider`. Task 4's layout is the natural place to start.
- **`usePoll` reports `exhausted`/`stopped` while running (P1-4).** An `enabled` flip restarts the loop with a fresh budget without clearing the flags. Compounded by there being no "Check again" button for the schema poll on Prepare or Schemas, only for the result poll on Converting.
- **`quarry.cache.order` read-modify-write (P1-3).** Two tabs caching at once drop an entry from the index while its payload stays on disk, where no eviction can reach it.
- **`shape_hash` is computed two different ways across the workers.** `packages/worker/src/shapes.py` uses SHA-256 over normalised fields; `Zamp/python/shared/src/zamp_shared/repositories.py` uses FNV-1a over `key:type`. Only the second matches `lib/schema.ts`. Harmless while Zamp is the live worker — but Task 1 makes the frontend depend on that hash, so this is now worth closing.
