# Quarry Frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the P0 Quarry web application — workspace, upload, per-file schema review, the
Convert gate, live conversion, the table with its evidence panel, merge and download — against the
seven-endpoint API contract in `[backend-infrastructure-execution-plan.md](backend-infrastructure-execution-plan.md)` §0,
with every surface the contract does not yet cover implemented behind the same typed interface
against fixtures.

**Architecture:** One Next.js app (`packages/web`). Every screen reads through a single
`QuarryApi` interface; `LiveApi` implements the seven real routes, `FixtureApi` implements the
six surfaces that do not exist yet (§0.9). Server state arrives by **polling**, not SSE. Client
state is a per-batch reducer plus a `localStorage`-backed workspace, because there is no
list-my-batches endpoint and no account. Components come in three layers — shadcn primitives,
generic common pieces, Quarry domain pieces — each depending only downward.

**Tech Stack:** Next.js 16.3.5 (App Router) · React 19.2 · TypeScript 5 · Tailwind v4 ·
shadcn/ui (new-york) · `cn` · TanStack Table **v9** · pdf.js 6 · lucide-react · Vitest +
Testing Library + MSW · Playwright.

---

## 0. Read these before Task 1


| Document                                                             | For                                        |
| -------------------------------------------------------------------- | ------------------------------------------ |
| `[ai-context.md](ai-context.md)`                                     | The five rules that are easy to get wrong  |
| `[screen-inventory.md](screen-inventory.md)`                         | Every state each screen must have          |
| `[component-inventory.md](component-inventory.md)`                   | The component catalogue and the reuse rule |
| `[ui-design-spec.md](ui-design-spec.md)`                             | Layout, motion, interaction principles     |
| `backend-…-plan.md` §0                                               | The seven endpoints, verbatim              |
| `Quarry UI v2.dc.html` (the design canvas)                           | The six artboards this plan builds         |
| `node_modules/@tanstack/react-table/skills/getting-started/SKILL.md` | **v9 is not v8** — read before Task 31     |


### 0.1 Where the design canvas overrides the docs

The v2 canvas is newer than `ui-design-spec.md`. Where they disagree, **the canvas wins** and this
table is the record of it. Update `ui-design-spec.md` in Task 45, not before — one pass at the end
beats eleven small ones.


| #   | `ui-design-spec.md` says                     | The canvas shows                                                                                           | This plan uses                                                                   |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| C1  | Accent is blue `oklch(0.52 0.17 258)`        | Teal `oklch(0.52 0.11 172)`                                                                                | **Teal**                                                                         |
| C2  | Warm neutrals (hue ~85)                      | Cool neutrals (hue 260)                                                                                    | **Cool 260**                                                                     |
| C3  | Success is its own green                     | "Done" is a neutral chip; the accent marks completion                                                      | `**--success` = the accent**; a finished chip is `StatusBadge variant="neutral"` |
| C4  | S05 "Machine view" is a screen (P1)          | Machine view is gone; **Raw text** is a per-table view                                                     | **Raw text** (Task 38). No S05                                                   |
| C5  | The pipeline visualisation is P1             | The pipeline strip is on the Converting screen itself                                                      | **P0**, Task 33                                                                  |
| C6  | S02 is a file list; S03 is a separate editor | One **Prepare** screen: file table while uploading, schema cards once shapes land, editor in a right panel | **One route, two phases** (Tasks 20, 28)                                         |
| C7  | Merge is a dialog                            | Merge is a full page, in two variants A and B                                                              | **Variant A**, full page (Task 41). B is a later swap — see §5                   |
| C8  | A `.zip` is expanded in the browser          | *"q3-archive.zip — unzip it first"*                                                                        | **Rejected client-side** with that reason (Task 17)                              |
| C9  | Live progress over SSE                       | —                                                                                                          | **Polling**, per contract §0.4 / §0.7                                            |
| C10 | Dark mode tokens are specified               | The canvas is light only                                                                                   | Light only. Dark stays P2; the `.dark` block is left in place and unused         |


Two things the canvas adds that no doc mentions, both built here:

- **A page-allowance meter in the header** (`1,840 / 5,000`) on every screen, and a
*"Raise the cap"* action on the Converting screen.
- **A workspace link.** *"This workspace lives in this browser. Copy its link to reach it from
another one."* This is a share of the whole workspace, because the user id is a bearer
capability (§0.1 of the backend plan). The copy in Task 14 says so plainly.

### 0.2 The five rules, restated because they are what gets broken

1. **Two schema edits exist: change a field's type, and add a field.** No rename, no delete, no
  description — and **no greyed-out controls for them either.**
2. **Apply-to-all matches on the *original* inferred schema**, not the current one. Order-independent.
3. **Convert enables when every file has uploaded *and settled* its schema** — ready **or** failed.
4. **Merge is exact and explicit.** Same names, same types. Never automatic, never widening.
5. **Every disabled control says what would enable it**, in text, not only in a tooltip.

---

## 1. What is already in the repo

```
packages/web/
  package.json          next 16.3.5 · react 19.2.8 · tailwind v4 · @tanstack/react-table 9.2.4
                        pdfjs-dist 6.3 · radix-ui 1.6.7 · lucide-react · cn · tw-animate-css
  components.json       shadcn new-york · rsc true · baseColor neutral · css vars
  src/app/globals.css    default shadcn neutral tokens — replaced in Task 2
  src/app/layout.tsx     Geist Sans + Geist Mono already wired
  src/app/page.tsx       placeholder — replaced in Task 15
  src/components/ui/button.tsx   the only primitive installed
  src/lib/utils.ts       cn via clsx + tailwind-merge
```

Three facts that change how code gets written here:

- `**cn` is the npm package**, not a local helper. shadcn's generator emits `import { cn } from "cn"`
and `cn@0.3.0` is the official drop-in for `clsx + twMerge`. Task 1 makes `src/lib/utils.ts`
re-export it so both import paths resolve to one function.
- **TanStack Table is v9.** `useTable(options, selector?)` with explicit `tableFeatures({...})`;
there is no `useReactTable` and no `getCoreRowModel()`. The package ships skills in
`node_modules/@tanstack/react-table/skills/`.
- **No test runner is installed.** Task 1 adds one.

---

## 2. The API boundary

Every screen reads through `QuarryApi`. Nothing imports `fetch` directly.

```
src/lib/api/
  types.ts       wire types — the seven endpoints and the six fixture surfaces
  contract.ts    the QuarryApi interface
  http.ts        postJson + HTTP-to-failure-class mapping
  live.ts        LiveApi        — the seven routes (backend plan §0.1–§0.7)
  fixtures.ts    FixtureApi     — rows, evidence, raw text, merge, download (§0.9)
  index.ts       `export const api` = LiveApi for the seven, FixtureApi for the rest
```


| Method                                        | Backed by   | Endpoint                   |
| --------------------------------------------- | ----------- | -------------------------- |
| `register(userId)`                            | live        | `POST /api/register`       |
| `getSignedUrls(userId, requestId, fileNames)` | live        | `POST /api/getSignedUrl`   |
| `confirmUploads(userId, requestId, files)`    | live        | `POST /api/upload`         |
| `pollSchemas(userId, requestId, received)`    | live        | `POST /api/polling/schema` |
| `updateSchemas(userId, requestId, files)`     | live        | `POST /api/updateSchema`   |
| `convert(userId, requestId)`                  | live        | `POST /api/convert`        |
| `pollResult(userId, requestId)`               | live        | `POST /api/polling/result` |
| `getTable(requestId, schemaId)`               | **fixture** | —                          |
| `getEvidence(valueId)`                        | **fixture** | —                          |
| `getRawText(requestId, schemaId)`             | **fixture** | —                          |
| `createMerge(requestId, schemaIds, name)`     | **fixture** | —                          |


Switching a fixture method to live later is one line in `index.ts` and no change to any screen.
That is the whole point of the split, and it is why no component may reach past `api`.

**Fixtures live at the repo root**, `fixtures/api/*.json`, not inside `packages/web`. The same
files back the frontend's MSW handlers and the backend's route tests (backend plan §47), so a
renamed field fails both suites instead of neither.

---

## 3. Design tokens

Taken from the canvas. Full values in Task 2; the rules that go with them:

- **Colour carries meaning.** `--review` (amber) means *check this*. `--error` means *this failed*.
`--paused` (desaturated blue) means *waiting on a limit*. They are never borrowed for emphasis,
and the accent teal is never used for a status.
- **Colour is never the only signal.** Amber cells carry a marker glyph; "not found" is italic and
muted; failed rows are greyed *and* labelled.
- **Every number in a table uses `font-variant-numeric: tabular-nums`** — including the status
sentence, the counts on Convert and Download, and the allowance meter.
- **No bare spinners.** Loading goes through `LoadingState`, which requires a label.

Measurements read off the artboards, used as the defaults:

```
app header            58px            page gutter        24px
workspace content     max 1080px      card radius        12–14px
schema panel          460px           control radius     8–10px
evidence panel        440px           icon button        32px
file / table row      56px            primary button     40px
schema field row      1fr 112px       badge radius       6px
S04 pipeline          1fr 44px 1fr 44px 1fr 44px 1fr   (4 stages, 3 connectors)
S04 table row         1fr 140px 160px 78px
S06 table row         46px 118px 108px 1fr 104px 100px 108px
```

---

## 4. File structure

```
packages/web/src/
  app/
    layout.tsx                              modify — providers, canvas background
    page.tsx                                S01 Workspace
    b/[requestId]/page.tsx                  Prepare | Converting, by batch phase
    b/[requestId]/t/[schemaId]/page.tsx     S06 table + evidence + raw text
    b/[requestId]/merge/page.tsx            S09 merge
    not-found.tsx                           S14
    error.tsx                               S15
  components/
    ui/                shadcn primitives — generated, never hand-edited
    common/            StatusBadge EmptyState ErrorState LoadingState PageHeader Toolbar
                       GatedButton KeyHint ConfirmDialog SplitPane
    quarry/            AppHeader AllowanceMeter DropZone FileRow FileList ConvertBar
                       SchemaEditor SchemaFieldRow FieldTypeSelect AddFieldControl
                       ApplyToAllControl SchemaCard SchemaGroupList WontConvertPanel
                       PipelineStrip StatusSentence PausedBanner TableList
                       DataTable DataCell MarkedCellReason BatchCard DensityToggle
                       EvidencePanel EvidenceView EvidencePageView EvidenceAudioView
                       EvidenceTextView EvidenceRecordView EvidenceUnavailable HighlightBox
                       RawTextView DownloadTableButton DownloadAllDialog
                       MergePicker MergeGroupCard MergeSummary MergeConflict
                       FailureMessage ConnectionStatus
  lib/
    api/               see §2
    session.ts         user id, registration, the workspace link
    schema.ts          shape hash, apply-to-all matching, the two edits
    failures.ts        failure class -> sentence + next step
    preflight.ts       client-side file rejection
    upload.ts          the upload queue
    polling.ts         usePoll
    csv.ts             client-side CSV / TSV serialisation
    format.ts          counts, bytes, durations, clock times
    utils.ts           modify — re-export cn
  state/
    workspace.tsx      localStorage-backed batch list
    batch.tsx          one batch: files, schemas, results
  test/
    setup.ts  msw/handlers.ts  msw/server.ts  render.tsx
fixtures/api/*.json                          repo root — shared with the backend
e2e/*.spec.ts                                Playwright
```

**Extract a component on its third use, not its first.** Two similar bits of markup is a
coincidence.

---

## 5. Deliberately not in this plan


| Not building                            | Why                                                                                                        | Where it goes                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Insights (S10)                          | P1                                                                                                         | After P0                               |
| Review queue and value correction (S11) | P2                                                                                                         | —                                      |
| Dark mode                               | P2                                                                                                         | —                                      |
| Demo batch (S13)                        | P1                                                                                                         | —                                      |
| Settings screen (S12)                   | P1. The allowance meter and "Raise the cap" are P0 stubs that link nowhere until it exists                 | —                                      |
| Merge variant B                         | A ships. B is the better shape at forty-plus tables in one schema; it swaps `MergePicker` and nothing else | Revisit when a real batch is that wide |
| Browser `.zip` expansion                | Rejected with a reason instead (C8)                                                                        | Backend plan §19.2 keeps the design    |
| Per-file retry after Convert            | P1                                                                                                         | —                                      |


---

# Phase 0 — Foundation

### Task 1 · Test harness and the `cn` decision

**Files**

- Create: `packages/web/vitest.config.ts`, `packages/web/src/test/setup.ts`,
`packages/web/src/test/render.tsx`, `packages/web/playwright.config.ts`
- Modify: `packages/web/package.json`, `packages/web/src/lib/utils.ts`
- **Step 1: Install the runners**

```bash
cd packages/web
npm i -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom msw@2 @playwright/test
npx playwright install chromium
```

- **Step 2: Add the scripts**

In `packages/web/package.json`, replace the `scripts` block with:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test"
}
```

- **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@fixtures": fileURLToPath(new URL("../../fixtures", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
})
```

- **Step 4: Write `src/test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest"
import { afterAll, afterEach, beforeAll, vi } from "vitest"
import { server } from "./msw/server"

beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => {
  server.resetHandlers()
  localStorage.clear()
  vi.useRealTimers()
})
afterAll(() => server.close())

// jsdom implements neither, and both are used by the panels and the table.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia

window.HTMLElement.prototype.scrollIntoView ??= () => {}
```

- **Step 5: Write `src/test/msw/server.ts` and an empty handler set**

```ts
// src/test/msw/handlers.ts
import type { RequestHandler } from "msw"
export const handlers: RequestHandler[] = []
```

```ts
// src/test/msw/server.ts
import { setupServer } from "msw/node"
import { handlers } from "./handlers"
export const server = setupServer(...handlers)
```

- **Step 6: Write `src/test/render.tsx`**

```tsx
import { render as rtlRender } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactElement } from "react"

export function render(ui: ReactElement) {
  return { user: userEvent.setup(), ...rtlRender(ui) }
}

export * from "@testing-library/react"
```

- **Step 7: Make `cn` one function**

Replace `packages/web/src/lib/utils.ts` entirely:

```ts
// shadcn's generator emits `import { cn } from "cn"`. Re-exported here so the
// components.json `utils` alias resolves to the same function, not a second one.
export { cn } from "cn"
```

Then remove the now-unused direct dependencies:

```bash
npm rm clsx tailwind-merge
```

- **Step 8: Write a smoke test** — `src/lib/utils.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { cn } from "@/lib/utils"

describe("cn", () => {
  it("merges conflicting tailwind classes, last one winning", () => {
    expect(cn("px-2", "px-4")).toBe("px-4")
  })

  it("drops falsey values", () => {
    expect(cn("a", false && "b", undefined, "c")).toBe("a c")
  })
})
```

- **Step 9: Write `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
})
```

- **Step 10: Run everything**

```bash
npm test
```

Expected: 2 passed. Then `npm run typecheck` → no errors.

- **Step 11: Commit**

```bash
git add packages/web/package.json packages/web/package-lock.json packages/web/vitest.config.ts packages/web/playwright.config.ts packages/web/src/test packages/web/src/lib/utils.ts packages/web/src/lib/utils.test.ts
git commit -m "chore(web): add vitest, testing-library, msw and playwright; unify cn"
```

---

### Task 2 · Design tokens

**Files**

- Modify: `packages/web/src/app/globals.css`
- **Step 1: Write a test that the tokens exist** — `src/app/globals.test.ts`

```ts
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8")

describe("design tokens", () => {
  it("uses the canvas accent, not the superseded blue", () => {
    expect(css).toContain("--primary: oklch(0.52 0.11 172)")
    expect(css).not.toContain("0.17 258")
  })

  it.each(["--review", "--error", "--paused", "--review-cell", "--canvas"])(
    "defines %s",
    (token) => {
      expect(css).toMatch(new RegExp(`${token}:`))
    },
  )

  it("exposes the status colours to tailwind", () => {
    expect(css).toContain("--color-review: var(--review)")
    expect(css).toContain("--color-paused: var(--paused)")
  })
})
```

- **Step 2: Run it** — `npx vitest run src/app/globals.test.ts` → FAIL, `--primary` mismatch.
- **Step 3: Replace the `:root` block in `globals.css`**

Keep the `@import` lines and the `@custom-variant dark` line at the top. Replace `:root { … }` with:

```css
:root {
  --radius: 0.625rem;

  /* surfaces */
  --canvas: oklch(0.955 0.003 260);
  --background: oklch(0.985 0.002 260);
  --foreground: oklch(0.22 0.012 260);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.22 0.012 260);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.22 0.012 260);

  /* the one accent */
  --primary: oklch(0.52 0.11 172);
  --primary-hover: oklch(0.42 0.10 172);
  --primary-foreground: oklch(0.99 0 0);
  --primary-tint: oklch(0.96 0.018 172);
  --primary-tint-strong: oklch(0.90 0.015 172);
  --primary-tint-border: oklch(0.88 0.02 172);

  /* neutrals */
  --secondary: oklch(0.968 0.003 260);
  --secondary-foreground: oklch(0.30 0.012 260);
  --muted: oklch(0.965 0.003 260);
  --muted-foreground: oklch(0.52 0.012 260);
  --subtle-foreground: oklch(0.45 0.012 260);
  --accent: oklch(0.965 0.003 260);
  --accent-foreground: oklch(0.26 0.012 260);
  --border: oklch(0.90 0.006 260);
  --border-subtle: oklch(0.93 0.005 260);
  --border-faint: oklch(0.95 0.004 260);
  --input: oklch(0.90 0.006 260);
  --ring: oklch(0.52 0.11 172);

  /* status — spent only on their status, never on emphasis */
  --success: oklch(0.52 0.11 172);
  --review: oklch(0.45 0.10 65);
  --review-strong: oklch(0.42 0.10 65);
  --review-icon: oklch(0.55 0.13 70);
  --review-bg: oklch(0.97 0.03 85);
  --review-border: oklch(0.92 0.03 85);
  --review-cell: oklch(0.945 0.07 85);
  --error: oklch(0.53 0.165 27);
  --error-strong: oklch(0.45 0.11 27);
  --error-bg: oklch(0.99 0.008 25);
  --error-border: oklch(0.93 0.02 25);
  --paused: oklch(0.50 0.06 250);
  --paused-strong: oklch(0.42 0.06 250);
  --paused-bg: oklch(0.96 0.015 250);
  --paused-border: oklch(0.90 0.022 250);

  --destructive: var(--error);
  --destructive-foreground: oklch(0.99 0 0);
}
```

- **Step 4: Extend the `@theme inline` block**

Append inside the existing `@theme inline { … }`:

```css
  --color-canvas: var(--canvas);
  --color-border-subtle: var(--border-subtle);
  --color-border-faint: var(--border-faint);
  --color-subtle-foreground: var(--subtle-foreground);
  --color-primary-hover: var(--primary-hover);
  --color-primary-tint: var(--primary-tint);
  --color-primary-tint-strong: var(--primary-tint-strong);
  --color-primary-tint-border: var(--primary-tint-border);
  --color-success: var(--success);
  --color-review: var(--review);
  --color-review-strong: var(--review-strong);
  --color-review-icon: var(--review-icon);
  --color-review-bg: var(--review-bg);
  --color-review-border: var(--review-border);
  --color-review-cell: var(--review-cell);
  --color-error: var(--error);
  --color-error-strong: var(--error-strong);
  --color-error-bg: var(--error-bg);
  --color-error-border: var(--error-border);
  --color-paused: var(--paused);
  --color-paused-strong: var(--paused-strong);
  --color-paused-bg: var(--paused-bg);
  --color-paused-border: var(--paused-border);
  --radius-xl: 0.875rem;
```

- **Step 5: Add the base rules**

Append at the end of `globals.css`:

```css
@layer base {
  * { @apply border-border outline-ring/50; }
  body {
    @apply bg-canvas text-foreground;
    font-variant-numeric: tabular-nums;
  }
  /* Ragged digit columns hide errors, which is the whole job here. */
  table, .tabular { font-variant-numeric: tabular-nums; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- **Step 6: Run** — `npx vitest run src/app/globals.test.ts` → PASS.
- **Step 7: Commit**

```bash
git add packages/web/src/app/globals.css packages/web/src/app/globals.test.ts
git commit -m "feat(web): design tokens from the v2 canvas"
```

---

### Task 3 · shadcn primitives

**Files**

- Create: `packages/web/src/components/ui/*.tsx` (generated)
- **Step 1: Install every primitive the inventory names**

```bash
cd packages/web
npx shadcn@latest add input label select dropdown-menu dialog sheet tabs tooltip badge progress separator scroll-area skeleton sonner popover checkbox switch alert resizable
```

- **Step 2: Confirm nothing was hand-edited**

```bash
git status --short packages/web/src/components/ui
```

Expected: only additions. `button.tsx` unchanged.

- **Step 3: Typecheck** — `npm run typecheck` → no errors.
- **Step 4: Commit**

```bash
git add packages/web/src/components/ui packages/web/package.json packages/web/package-lock.json
git commit -m "feat(web): install shadcn primitives named in the component inventory"
```

---

### Task 4 · `LoadingState` — the no-bare-spinner rule, made structural

**Files**

- Create: `packages/web/src/components/common/LoadingState.tsx`,
`packages/web/src/components/common/LoadingState.test.tsx`
- **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from "vitest"
import { render, screen } from "@/test/render"
import { LoadingState } from "./LoadingState"

describe("LoadingState", () => {
  it("always renders its label, so a wordless spinner cannot be shipped", () => {
    render(<LoadingState label="Reading this file" />)
    expect(screen.getByText("Reading this file")).toBeInTheDocument()
  })

  it("announces politely without stealing focus", () => {
    render(<LoadingState label="Waking up" />)
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite")
  })

  it("shows a determinate bar when it knows the fraction", () => {
    render(<LoadingState label="Uploading" value={7} of={10} />)
    const bar = screen.getByRole("progressbar")
    expect(bar).toHaveAttribute("aria-valuenow", "7")
    expect(bar).toHaveAttribute("aria-valuemax", "10")
  })

  it("has no progressbar when it does not know the fraction", () => {
    render(<LoadingState label="Reading this file" />)
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })
})
```

- **Step 2: Run** — `npx vitest run src/components/common/LoadingState.test.tsx` → FAIL,
cannot resolve `./LoadingState`.
- **Step 3: Implement**

```tsx
import { cn } from "@/lib/utils"

type LoadingStateProps = {
  /** Required. There is no spinner in this product that does not say what it is doing. */
  label: string
  value?: number
  of?: number
  className?: string
}

export function LoadingState({ label, value, of, className }: LoadingStateProps) {
  const determinate = typeof value === "number" && typeof of === "number" && of > 0
  const pct = determinate ? Math.min(100, Math.max(0, (value / of) * 100)) : 0

  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2 text-[13px] text-subtle-foreground">
        {!determinate && (
          <span
            aria-hidden
            className="size-3.5 animate-spin rounded-full border-[1.5px] border-border border-t-primary"
          />
        )}
        <span>{label}</span>
        {determinate && (
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {value} of {of}
          </span>
        )}
      </div>
      {determinate && (
        <div
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={of}
          aria-label={label}
          className="h-[5px] w-full overflow-hidden rounded-full bg-border-subtle"
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}
```

- **Step 4: Run** → 4 passed.
- **Step 5: Commit**

```bash
git add packages/web/src/components/common/LoadingState.tsx packages/web/src/components/common/LoadingState.test.tsx
git commit -m "feat(web): LoadingState, which requires a label"
```

---

### Task 5 · `GatedButton` — the disabled-reason rule, made structural

**Files**

- Create: `packages/web/src/components/common/GatedButton.tsx`,
`packages/web/src/components/common/GatedButton.test.tsx`
- **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@/test/render"
import { GatedButton } from "./GatedButton"

describe("GatedButton", () => {
  it("puts the reason in the accessible name, not only on screen", () => {
    render(<GatedButton reason="7 files are still reading their shape">Convert</GatedButton>)
    expect(
      screen.getByRole("button", {
        name: /Convert.*7 files are still reading their shape/i,
      }),
    ).toBeDisabled()
  })

  it("shows the reason as text beside the button", () => {
    render(<GatedButton reason="No schemas ready yet">Review schemas</GatedButton>)
    expect(screen.getByText("No schemas ready yet")).toBeVisible()
  })

  it("is enabled and clickable when no reason is given", async () => {
    const onClick = vi.fn()
    const { user } = render(<GatedButton onClick={onClick}>Convert</GatedButton>)
    await user.click(screen.getByRole("button", { name: "Convert" }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("does not fire when gated", async () => {
    const onClick = vi.fn()
    const { user } = render(
      <GatedButton reason="Nothing selected" onClick={onClick}>Merge</GatedButton>,
    )
    await user.click(screen.getByRole("button", { name: /Merge/ }))
    expect(onClick).not.toHaveBeenCalled()
  })
})
```

- **Step 2: Run** → FAIL, module not found.
- **Step 3: Implement**

```tsx
import type { ComponentProps, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type GatedButtonProps = Omit<ComponentProps<typeof Button>, "disabled"> & {
  /**
   * Present means gated. The string is both the on-screen explanation and part
   * of the accessible name — a tooltip alone is invisible on touch and to most
   * assistive tech, which is exactly where the gating logic matters most.
   */
  reason?: string | null
  children: ReactNode
  reasonClassName?: string
}

export function GatedButton({
  reason,
  children,
  className,
  reasonClassName,
  ...props
}: GatedButtonProps) {
  const gated = Boolean(reason)

  const button = (
    <Button
      {...props}
      disabled={gated}
      aria-disabled={gated || undefined}
      aria-describedby={undefined}
      aria-label={gated ? `${textOf(children)} — ${reason}` : undefined}
      className={cn("h-10 rounded-[10px] px-4 text-sm font-medium", className)}
    >
      {children}
    </Button>
  )

  if (!gated) return button

  return (
    <div className="flex items-center gap-3">
      <span className={cn("text-xs text-muted-foreground", reasonClassName)}>{reason}</span>
      {button}
    </div>
  )
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(" ").trim()
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props: { children?: ReactNode } }).props.children)
  }
  return ""
}
```

- **Step 4: Run** → 4 passed.
- **Step 5: Commit**

```bash
git add packages/web/src/components/common/GatedButton.tsx packages/web/src/components/common/GatedButton.test.tsx
git commit -m "feat(web): GatedButton, which requires a reason when disabled"
```

---

### Task 6 · `StatusBadge`, `EmptyState`, `ErrorState`, `PageHeader`, `Toolbar`

**Files**

- Create: `packages/web/src/components/common/StatusBadge.tsx` (+ `.test.tsx`),
`EmptyState.tsx`, `ErrorState.tsx`, `PageHeader.tsx`, `Toolbar.tsx`,
`packages/web/src/components/common/index.ts`
- **Step 1: Write the failing test** — `StatusBadge.test.tsx`

```tsx
import { describe, expect, it } from "vitest"
import { render, screen } from "@/test/render"
import { StatusBadge } from "./StatusBadge"

describe("StatusBadge", () => {
  it.each([
    ["success", "Done"],
    ["review", "4 to check"],
    ["error", "2 failed"],
    ["paused", "Paused"],
    ["neutral", "Queued"],
    ["working", "Working"],
  ] as const)("renders the %s variant with its label", (variant, label) => {
    render(<StatusBadge variant={variant}>{label}</StatusBadge>)
    expect(screen.getByText(label)).toBeVisible()
  })

  it("carries a non-colour signal for every alerting variant", () => {
    const { container } = render(<StatusBadge variant="review">4 to check</StatusBadge>)
    expect(container.querySelector("svg")).toBeTruthy()
  })
})
```

- **Step 2: Run** → FAIL.
- **Step 3: Implement `StatusBadge.tsx`**

```tsx
import { AlertTriangle, Check, CircleX, Loader2, Pause } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type StatusVariant = "success" | "review" | "error" | "paused" | "neutral" | "working"

const STYLES: Record<StatusVariant, string> = {
  success: "bg-muted text-secondary-foreground",
  review: "bg-review-bg text-review",
  error: "bg-error-bg text-error-strong",
  paused: "bg-paused-bg text-paused-strong",
  neutral: "bg-muted text-muted-foreground",
  working: "bg-primary text-primary-foreground",
}

const ICONS: Partial<Record<StatusVariant, typeof Check>> = {
  success: Check,
  review: AlertTriangle,
  error: CircleX,
  paused: Pause,
  working: Loader2,
}

export function StatusBadge({
  variant,
  children,
  className,
}: {
  variant: StatusVariant
  children: ReactNode
  className?: string
}) {
  const Icon = ICONS[variant]
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-medium",
        STYLES[variant],
        className,
      )}
    >
      {Icon && (
        <Icon
          aria-hidden
          className={cn("size-3", variant === "working" && "animate-spin")}
          strokeWidth={2}
        />
      )}
      {children}
    </span>
  )
}
```

- **Step 4: Implement the other four**

`EmptyState.tsx` — `{ title, body?, action? }`. One short true sentence, no illustration.
`ErrorState.tsx` — `{ title, body, onRetry?, backHref? }`, rendered in `--error` with a real action.
`PageHeader.tsx` — `{ breadcrumb?, title, subtitle?, actions? }`, 24px gutter, title 22px/600 at
`-0.02em`.
`Toolbar.tsx` — a `flex items-center gap-2` row with a `role="toolbar"` and an `aria-label` prop.

Also create `src/lib/format.ts`, used by the allowance meter, the status sentence and every count:

```ts
const NUM = new Intl.NumberFormat("en-GB")

export const formatCount = (n: number) => NUM.format(n)

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/** "about 14 min left" — deliberately vague, because a false precision reads as a promise. */
export function formatEta(seconds: number | null): string | null {
  if (seconds === null || seconds < 0) return null
  if (seconds < 60) return "less than a minute left"
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `about ${mins} min left`
  return `about ${Math.round(mins / 60)} hr left`
}

/** "14:32" — a resume time is a clock time, never a countdown. */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
}
```

Its test covers `formatBytes(0)`, the 1023/1024 boundary, `formatEta(null)` returning `null`,
and `formatEta(59)` not saying "0 min".

Each component is under 40 lines and takes only tokens for colour. Then `index.ts`:

```ts
export * from "./EmptyState"
export * from "./ErrorState"
export * from "./GatedButton"
export * from "./LoadingState"
export * from "./PageHeader"
export * from "./StatusBadge"
export * from "./Toolbar"
```

- **Step 5: Run** — `npx vitest run src/components/common` → all pass.
- **Step 6: Commit**

```bash
git add packages/web/src/components/common
git commit -m "feat(web): common layer — StatusBadge, EmptyState, ErrorState, PageHeader, Toolbar"
```

---

### Task 7 · `SplitPane`

One component for both split screens, so the schema panel and the evidence panel behave
identically. Learn it once, know it everywhere.

**Files**

- Create: `packages/web/src/components/common/SplitPane.tsx` (+ `.test.tsx`)
- **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@/test/render"
import { SplitPane } from "./SplitPane"

const list = <div data-testid="list">files</div>
const panel = <div data-testid="panel">detail</div>

describe("SplitPane", () => {
  it("shows only the list when closed", () => {
    render(<SplitPane list={list} panel={null} onClose={vi.fn()} panelLabel="Schema" />)
    expect(screen.getByTestId("list")).toBeVisible()
    expect(screen.queryByTestId("panel")).not.toBeInTheDocument()
  })

  it("shows both at once when open — the list must stay visible", () => {
    render(<SplitPane list={list} panel={panel} onClose={vi.fn()} panelLabel="Schema" />)
    expect(screen.getByTestId("list")).toBeVisible()
    expect(screen.getByTestId("panel")).toBeVisible()
  })

  it("closes on Escape", async () => {
    const onClose = vi.fn()
    const { user } = render(
      <SplitPane list={list} panel={panel} onClose={onClose} panelLabel="Schema" />,
    )
    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("labels the panel region for screen readers", () => {
    render(<SplitPane list={list} panel={panel} onClose={vi.fn()} panelLabel="Evidence" />)
    expect(screen.getByRole("complementary", { name: "Evidence" })).toBeInTheDocument()
  })
})
```

- **Step 2: Run** → FAIL.
- **Step 3: Implement**

```tsx
"use client"

import { useEffect, type ReactNode } from "react"
import { cn } from "@/lib/utils"

type SplitPaneProps = {
  list: ReactNode
  /** null closes the panel. A modal would cover the list, which is the thing the screen is for. */
  panel: ReactNode | null
  panelLabel: string
  panelWidth?: number
  onClose: () => void
  className?: string
}

export function SplitPane({
  list,
  panel,
  panelLabel,
  panelWidth = 440,
  onClose,
  className,
}: SplitPaneProps) {
  useEffect(() => {
    if (!panel) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [panel, onClose])

  return (
    <div className={cn("flex min-h-0 flex-1 overflow-hidden", className)}>
      <div className="min-w-0 flex-1 overflow-auto">{list}</div>
      {panel && (
        <aside
          role="complementary"
          aria-label={panelLabel}
          style={{ width: panelWidth }}
          className={cn(
            "flex min-h-0 shrink-0 flex-col overflow-auto border-l border-border-subtle bg-card",
            "motion-safe:animate-in motion-safe:slide-in-from-right-4 motion-safe:duration-200",
            // Below 1024px the two stop being legible side by side.
            "max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:w-full max-lg:max-w-[440px] max-lg:shadow-2xl",
          )}
        >
          {panel}
        </aside>
      )}
    </div>
  )
}
```

- **Step 4: Run** → 4 passed.
- **Step 5: Commit**

```bash
git add packages/web/src/components/common/SplitPane.tsx packages/web/src/components/common/SplitPane.test.tsx
git commit -m "feat(web): SplitPane, shared by the schema and evidence panels"
```

---

# Phase 1 — The contract

### Task 8 · Wire types

**Files**

- Create: `packages/web/src/lib/api/types.ts`
- **Step 1: Write the file** — types only, so the test is `tsc`.

```ts
// The seven endpoints, verbatim from backend-infrastructure-execution-plan.md §0.
// Anything not in that section belongs under "Fixture surfaces" at the bottom.

export type FieldType = "text" | "number" | "date" | "currency" | "boolean" | "list"

export const FIELD_TYPES: readonly FieldType[] = [
  "text",
  "number",
  "date",
  "currency",
  "boolean",
  "list",
] as const

export type FailureClass =
  | "acquisition"
  | "format_locked"
  | "format_corrupt"
  | "format_unsupported"
  | "extract_empty"
  | "schema_not_found"
  | "schema_inference_failed"
  | "merge_incompatible"
  | "too_large"
  | "provider_quota_exhausted"
  | "provider_refused"
  | "response_unparseable"
  | "field_unresolved"
  | "field_unsupported_by_evidence"
  | "verification_failed"
  | "budget_exceeded"
  | "gate_not_met"
  | "empty_file"
  | "archive_not_expanded"
  | "network"
  | "unknown"

export type Failure = {
  class: FailureClass
  /** The server's sentence. Never rendered raw — FailureMessage owns the copy. */
  message?: string
  nextStep?: string
}

export type SchemaField = {
  key: string
  label: string
  type: FieldType
  origin: "detected" | "added"
}

export type TableSchema = {
  tableOrd: number
  tableLabel: string
  version: number
  /** Hash of the ORIGINAL inferred fields — what apply-to-all matches on. */
  shapeHash: string
  matchingFileCount: number
  fields: SchemaField[]
}

/* §0.1 */
export type RegisterResponse = { status: "ok" }

/* §0.2 */
export type SignedUrlFile = {
  fileId: string
  fileName: string
  /** The signed PUT URL itself, not an object key. */
  filePath: string
  uploadHeaders: Record<string, string>
  expiresAt: string
}
export type SignedUrlResponse = {
  userId: string
  requestId: string
  files: SignedUrlFile[]
}

/* §0.3 */
export type UploadedFile = {
  fileId: string
  fileName: string
  filePath: string
  /** webkitRelativePath for a folder drop, the plain name otherwise. Display only. */
  fileLocation: string
}
export type UploadResponse = {
  status: "ok"
  files: { fileId: string; stage: "UPLOADED" | "FAILED"; failureClass?: FailureClass; message?: string; nextStep?: string }[]
}

/* §0.4 — one entry per (fileId, schemaId); a 3-table file is three entries */
export type SchemaEntry = {
  fileId: string
  fileName: string
  filePath: string
  schemaId: string | null
  status: "ready" | "failed"
  schema: TableSchema | null
  failure?: Failure
}
export type SchemaPollResponse = {
  userId: string
  requestId: string
  pending: number
  convertAvailable: boolean
  convertBlockedReason: string | null
  files: SchemaEntry[]
}

/* §0.5 */
export type SchemaSaveEntry = {
  fileId: string
  fileName: string
  filePath: string
  schemaId: string
  schema: { fields: SchemaField[] }
}
export type UpdateSchemaResponse = {
  status: "ok"
  updated: { schemaId: string; version: number }[]
}

/* §0.6 */
export type ConvertResponse = { status: "received"; queued: number; skipped: number }

/* §0.7 */
export type ConvertStage = "QUEUED" | "EXTRACTING" | "FILLING" | "DONE" | "FAILED"
export type ResultEntry = {
  fileId: string
  fileName: string
  schemaId: string
  stage: ConvertStage
  rowCount?: number
  fieldCount?: number
  toCheckCount?: number
  progress?: { unit: "page" | "row"; at: number; of: number }
  failure?: Failure
}
export type ResultPollResponse = {
  userId: string
  requestId: string
  status: "CONVERTING" | "PAUSED" | "COMPLETED" | "FAILED"
  pausedUntil: string | null
  counts: { queued: number; extracting: number; filling: number; done: number; failed: number }
  rowsSoFar: number
  estimatedSecondsRemaining: number | null
  allowance: { used: number; limit: number; resetsAt: string }
  files: ResultEntry[]
}

/* ------------------------------------------------------------------ */
/* Fixture surfaces — §0.9. Same types when they go live.              */
/* ------------------------------------------------------------------ */

export type CellState = "value" | "not-found" | "marked"

export type CellValue = {
  valueId: string
  display: string
  state: CellState
  /** Present only when state is "marked". The server decides; the UI never re-derives it. */
  reason?: string
}

export type TableRow = {
  recordId: string
  /** A row the document could not yield at all. Greyed, labelled, reason one click away. */
  failed?: Failure
  values: Record<string, CellValue>
}

export type TableData = {
  requestId: string
  schemaId: string
  fileId: string
  fileName: string
  tableLabel: string
  pageRange: string | null
  fields: SchemaField[]
  rows: TableRow[]
}

/** Fractions of page size, never raw points — two PDF engines must agree (D17). */
export type BoxFraction = { x: number; y: number; w: number; h: number }

export type Locator =
  | { type: "page"; documentUrl: string; page: number; pageCount: number; box: BoxFraction }
  | {
      type: "audio"
      audioUrl: string
      startMs: number
      endMs: number
      transcript: string
      speaker: string | null
      speakerInferred: true
    }
  | { type: "text"; paragraph: string; start: number; end: number }
  | { type: "record"; path: string; sheet?: string; row?: number; column?: string }
  | { type: "none"; sourceText: string; reason: string }

export type Evidence = {
  valueId: string
  fieldKey: string
  rowIndex: number
  display: string
  reason?: string
  locator: Locator
}

export type RawText = { schemaId: string; fileName: string; pages: { page: number; text: string }[] }

export type MergeGroup = {
  shapeHash: string
  name: string
  fields: SchemaField[]
  members: {
    schemaId: string
    fileId: string
    fileName: string
    tableLabel: string
    rowCount: number
    toCheckCount: number
    convertedAt: string
  }[]
}

export type MergeConflictDetail = {
  field: string
  groups: { type: FieldType; tableNames: string[] }[]
}

export type MergeResult =
  | { ok: true; mergeId: string; name: string; rowCount: number; tableCount: number }
  | { ok: false; failure: Failure; conflicts: MergeConflictDetail[] }
```

- **Step 2: Typecheck** — `npm run typecheck` → no errors.
- **Step 3: Commit**

```bash
git add packages/web/src/lib/api/types.ts
git commit -m "feat(web): wire types for the seven endpoints and the fixture surfaces"
```

---

### Task 9 · The failure taxonomy — `failures.ts` and `FailureMessage`

The single place a failure class becomes text. A screen that renders `error.message` directly is a
bug regardless of how good the message happens to look.

**Files**

- Create: `packages/web/src/lib/failures.ts` (+ `.test.ts`),
`packages/web/src/components/quarry/FailureMessage.tsx` (+ `.test.tsx`)
- **Step 1: Write the failing test** — `src/lib/failures.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { FAILURES, failureCopy } from "@/lib/failures"
import type { FailureClass } from "@/lib/api/types"

const ALL: FailureClass[] = [
  "acquisition", "format_locked", "format_corrupt", "format_unsupported",
  "extract_empty", "schema_not_found", "schema_inference_failed",
  "merge_incompatible", "too_large", "provider_quota_exhausted",
  "provider_refused", "response_unparseable", "field_unresolved",
  "field_unsupported_by_evidence", "verification_failed", "budget_exceeded",
  "gate_not_met", "empty_file", "archive_not_expanded", "network", "unknown",
]

describe("the failure taxonomy", () => {
  it("has copy for every class — no class can reach a screen unnamed", () => {
    for (const c of ALL) expect(FAILURES[c], c).toBeDefined()
  })

  it("gives every class a sentence and a next step", () => {
    for (const c of ALL) {
      expect(FAILURES[c].message.length, c).toBeGreaterThan(10)
      expect(FAILURES[c].nextStep.length, c).toBeGreaterThan(2)
    }
  })

  it("prefers the server's sentence when it sent one", () => {
    expect(
      failureCopy({ class: "format_locked", message: "Password-protected, so its pages can't be opened." }).message,
    ).toBe("Password-protected, so its pages can't be opened.")
  })

  it("falls back to our copy when the server sent none", () => {
    expect(failureCopy({ class: "format_locked" }).message).toBe(FAILURES.format_locked.message)
  })

  it("treats a quota pause as a pause, not an error", () => {
    expect(FAILURES.provider_quota_exhausted.tone).toBe("paused")
    expect(FAILURES.budget_exceeded.tone).toBe("paused")
  })

  it("marks the two settled schema classes as non-blocking for Convert", () => {
    expect(FAILURES.schema_not_found.blocksConvert).toBe(false)
    expect(FAILURES.schema_inference_failed.blocksConvert).toBe(false)
  })
})
```

- **Step 2: Run** → FAIL.
- **Step 3: Implement `src/lib/failures.ts`**

```ts
import type { Failure, FailureClass } from "@/lib/api/types"

export type FailureTone = "error" | "review" | "paused"

export type FailureCopy = {
  message: string
  nextStep: string
  tone: FailureTone
  /** Settled-but-failed schema states never hold a good batch hostage. */
  blocksConvert: boolean
}

export const FAILURES: Record<FailureClass, FailureCopy> = {
  acquisition: {
    message: "Upload didn't finish.",
    nextStep: "Retry this file.",
    tone: "error",
    blocksConvert: false,
  },
  format_locked: {
    message: "This PDF is password protected.",
    nextStep: "Remove the password and upload it again.",
    tone: "error",
    blocksConvert: false,
  },
  format_corrupt: {
    message: "This file says it is one thing but isn't.",
    nextStep: "Check the file and upload it again.",
    tone: "error",
    blocksConvert: false,
  },
  format_unsupported: {
    message: "That format isn't supported.",
    nextStep: "Save it as PDF, .docx, .xlsx or CSV and upload it again.",
    tone: "error",
    blocksConvert: false,
  },
  extract_empty: {
    message: "Its pages are images with no readable text.",
    nextStep: "Remove it, or convert anyway and it will be skipped.",
    tone: "error",
    blocksConvert: false,
  },
  schema_not_found: {
    message: "Couldn't find a table in this one.",
    nextStep: "Add fields yourself, or leave it out.",
    tone: "error",
    blocksConvert: false,
  },
  schema_inference_failed: {
    message: "Couldn't work out this file's shape.",
    nextStep: "Convert anyway and it'll be skipped, or remove it.",
    tone: "error",
    blocksConvert: false,
  },
  merge_incompatible: {
    message: "These tables don't have the same fields and types.",
    nextStep: "Untick the table named on the card, or merge within its own schema.",
    tone: "error",
    blocksConvert: false,
  },
  too_large: {
    message: "This file is past the size we can read in one go.",
    nextStep: "Split it, or raise the cap.",
    tone: "error",
    blocksConvert: false,
  },
  provider_quota_exhausted: {
    message: "Daily page allowance used up.",
    nextStep: "Nothing — it picks up on its own, and finished tables stay downloadable.",
    tone: "paused",
    blocksConvert: false,
  },
  provider_refused: {
    message: "The model declined to process this document.",
    nextStep: "Remove it from the batch.",
    tone: "error",
    blocksConvert: false,
  },
  response_unparseable: {
    message: "Couldn't get a clean answer for this one.",
    nextStep: "Retry it.",
    tone: "error",
    blocksConvert: false,
  },
  field_unresolved: {
    message: "This value isn't in the document.",
    nextStep: "Nothing — the cell reads “not found” rather than guessing.",
    tone: "review",
    blocksConvert: false,
  },
  field_unsupported_by_evidence: {
    message: "I couldn't find this value in the document.",
    nextStep: "Check it against the evidence beside it.",
    tone: "review",
    blocksConvert: false,
  },
  verification_failed: {
    message: "An automatic check on this value didn't pass.",
    nextStep: "Check it against the evidence beside it.",
    tone: "review",
    blocksConvert: false,
  },
  budget_exceeded: {
    message: "You've hit your processing cap.",
    nextStep: "Raise the cap, or take the tables you have.",
    tone: "paused",
    blocksConvert: false,
  },
  gate_not_met: {
    message: "Some files are still reading their shape.",
    nextStep: "Wait for them to finish, or remove them.",
    tone: "error",
    blocksConvert: true,
  },
  empty_file: {
    message: "This file is empty.",
    nextStep: "Remove it; the rest carry on.",
    tone: "error",
    blocksConvert: false,
  },
  archive_not_expanded: {
    message: "Archives aren't read yet.",
    nextStep: "Unzip it first and drop the files.",
    tone: "error",
    blocksConvert: false,
  },
  network: {
    message: "Couldn't reach the server.",
    nextStep: "Check your connection — we'll keep trying.",
    tone: "error",
    blocksConvert: false,
  },
  unknown: {
    message: "Something went wrong that we don't have a name for.",
    nextStep: "Retry, and tell us if it happens again.",
    tone: "error",
    blocksConvert: false,
  },
}

export function failureCopy(failure: Failure): FailureCopy {
  const base = FAILURES[failure.class] ?? FAILURES.unknown
  return {
    ...base,
    message: failure.message ?? base.message,
    nextStep: failure.nextStep ?? base.nextStep,
  }
}
```

- **Step 4: Run** → 6 passed.
- **Step 5: Write the `FailureMessage` test**

```tsx
import { describe, expect, it } from "vitest"
import { render, screen } from "@/test/render"
import { FailureMessage } from "./FailureMessage"

describe("FailureMessage", () => {
  it("shows the sentence and the next step", () => {
    render(<FailureMessage failure={{ class: "format_locked" }} />)
    expect(screen.getByText(/password protected/i)).toBeVisible()
    expect(screen.getByText(/Remove the password/i)).toBeVisible()
  })

  it("renders a quota pause in the paused tone, not the error tone", () => {
    const { container } = render(<FailureMessage failure={{ class: "provider_quota_exhausted" }} />)
    expect(container.firstElementChild?.className).toContain("paused")
    expect(container.firstElementChild?.className).not.toContain("error-bg")
  })

  it("compact mode drops the next step but keeps the sentence", () => {
    render(<FailureMessage failure={{ class: "extract_empty" }} compact />)
    expect(screen.getByText(/images with no readable text/i)).toBeVisible()
    expect(screen.queryByText(/convert anyway/i)).not.toBeInTheDocument()
  })
})
```

- **Step 6: Implement `FailureMessage.tsx`**

```tsx
import { AlertTriangle, CircleX, Pause } from "lucide-react"
import type { Failure } from "@/lib/api/types"
import { failureCopy, type FailureTone } from "@/lib/failures"
import { cn } from "@/lib/utils"

const TONE: Record<FailureTone, { box: string; icon: typeof CircleX }> = {
  error: { box: "bg-error-bg border-error-border text-error-strong", icon: CircleX },
  review: { box: "bg-review-bg border-review-border text-review", icon: AlertTriangle },
  paused: { box: "bg-paused-bg border-paused-border text-paused-strong", icon: Pause },
}

export function FailureMessage({
  failure,
  compact = false,
  className,
}: {
  failure: Failure
  compact?: boolean
  className?: string
}) {
  const copy = failureCopy(failure)
  const tone = TONE[copy.tone]
  const Icon = tone.icon

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3 text-[13px] leading-[1.5]",
        tone.box,
        className,
      )}
    >
      <Icon aria-hidden className="mt-px size-4 shrink-0" strokeWidth={1.9} />
      <div className="min-w-0">
        <p className="font-medium">{copy.message}</p>
        {!compact && <p className="mt-0.5 opacity-80">{copy.nextStep}</p>}
      </div>
    </div>
  )
}
```

- **Step 7: Run** — `npx vitest run src/lib/failures.test.ts src/components/quarry/FailureMessage.test.tsx` → all pass.
- **Step 8: Commit**

```bash
git add packages/web/src/lib/failures.ts packages/web/src/lib/failures.test.ts packages/web/src/components/quarry/FailureMessage.tsx packages/web/src/components/quarry/FailureMessage.test.tsx
git commit -m "feat(web): the failure taxonomy, and the one component that renders it"
```

---

### Task 10 · `http.ts` — one fetch, one error shape

**Files**

- Create: `packages/web/src/lib/api/http.ts` (+ `.test.ts`)
- **Step 1: Write the failing test**

```ts
import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"
import { server } from "@/test/msw/server"
import { ApiError, postJson } from "./http"

describe("postJson", () => {
  it("posts JSON and returns the parsed body", async () => {
    server.use(
      http.post("/api/thing", async ({ request }) => {
        expect(await request.json()).toEqual({ a: 1 })
        return HttpResponse.json({ ok: true })
      }),
    )
    await expect(postJson("/api/thing", { a: 1 })).resolves.toEqual({ ok: true })
  })

  it("turns a classified error body into an ApiError carrying the class", async () => {
    server.use(() =>
      http.post("/api/thing", () =>
        HttpResponse.json(
          { failureClass: "gate_not_met", message: "7 files are still reading their shape.", pending: 7 },
          { status: 409 },
        ),
      ),
    )
    await expect(postJson("/api/thing", {})).rejects.toMatchObject({
      failure: { class: "gate_not_met", message: "7 files are still reading their shape." },
      status: 409,
    })
  })

  it("classifies an unclassified 500 as unknown, never as a raw string", async () => {
    server.use(http.post("/api/thing", () => new HttpResponse("boom", { status: 500 })))
    await expect(postJson("/api/thing", {})).rejects.toMatchObject({
      failure: { class: "unknown" },
    })
  })

  it("classifies a transport failure as network", async () => {
    server.use(http.post("/api/thing", () => HttpResponse.error()))
    const err = await postJson("/api/thing", {}).catch((e) => e as ApiError)
    expect(err.failure.class).toBe("network")
  })
})
```

Fix the second case's `server.use(() => …)` typo when writing it — it is `server.use(http.post(…))`.

- **Step 2: Run** → FAIL.
- **Step 3: Implement**

```ts
import type { Failure, FailureClass } from "@/lib/api/types"

export class ApiError extends Error {
  readonly failure: Failure
  readonly status: number
  readonly body: unknown

  constructor(failure: Failure, status: number, body: unknown) {
    super(failure.message ?? failure.class)
    this.name = "ApiError"
    this.failure = failure
    this.status = status
    this.body = body
  }
}

const KNOWN = new Set<string>([
  "acquisition", "format_locked", "format_corrupt", "format_unsupported", "extract_empty",
  "schema_not_found", "schema_inference_failed", "merge_incompatible", "too_large",
  "provider_quota_exhausted", "provider_refused", "response_unparseable", "field_unresolved",
  "field_unsupported_by_evidence", "verification_failed", "budget_exceeded", "gate_not_met",
  "empty_file", "archive_not_expanded", "network", "unknown",
])

function classOf(value: unknown): FailureClass {
  return typeof value === "string" && KNOWN.has(value) ? (value as FailureClass) : "unknown"
}

export async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    })
  } catch (cause) {
    if (signal?.aborted) throw cause
    throw new ApiError({ class: "network" }, 0, cause)
  }

  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }

  if (res.ok) return parsed as T

  const shape = (parsed ?? {}) as { failureClass?: string; message?: string; nextStep?: string }
  throw new ApiError(
    { class: classOf(shape.failureClass), message: shape.message, nextStep: shape.nextStep },
    res.status,
    parsed,
  )
}
```

- **Step 4: Run** → 4 passed.
- **Step 5: Commit**

```bash
git add packages/web/src/lib/api/http.ts packages/web/src/lib/api/http.test.ts
git commit -m "feat(web): one fetch wrapper, one classified error shape"
```

---

### Task 11 · `LiveApi` and the shared fixture set

**Files**

- Create: `fixtures/api/schema-poll.json`, `fixtures/api/result-poll.json`,
`fixtures/api/table-invoice-1044.json`, `fixtures/api/evidence.json`,
`fixtures/api/raw-text.json`, `fixtures/api/merge-groups.json`
- Create: `packages/web/src/lib/api/contract.ts`, `live.ts` (+ `live.test.ts`)
- **Step 1: Write `contract.ts`**

```ts
import type {
  ConvertResponse, Evidence, MergeGroup, MergeResult, RawText, RegisterResponse,
  ResultPollResponse, SchemaPollResponse, SchemaSaveEntry, SignedUrlResponse, TableData,
  UpdateSchemaResponse, UploadResponse, UploadedFile,
} from "./types"

export interface QuarryApi {
  /* the seven — live */
  register(userId: string): Promise<RegisterResponse>
  getSignedUrls(userId: string, requestId: string, fileNames: string[]): Promise<SignedUrlResponse>
  confirmUploads(userId: string, requestId: string, files: UploadedFile[]): Promise<UploadResponse>
  pollSchemas(userId: string, requestId: string, received: string[], signal?: AbortSignal): Promise<SchemaPollResponse>
  updateSchemas(userId: string, requestId: string, files: SchemaSaveEntry[]): Promise<UpdateSchemaResponse>
  convert(userId: string, requestId: string): Promise<ConvertResponse>
  pollResult(userId: string, requestId: string, signal?: AbortSignal): Promise<ResultPollResponse>

  /* not on the server yet — §0.9 */
  getTable(requestId: string, schemaId: string): Promise<TableData>
  getEvidence(valueId: string): Promise<Evidence>
  getRawText(requestId: string, schemaId: string): Promise<RawText>
  getMergeGroups(requestId: string): Promise<MergeGroup[]>
  createMerge(requestId: string, schemaIds: string[], name: string): Promise<MergeResult>
}
```

- **Step 2: Write the failing test** — `live.test.ts`

```ts
import { http, HttpResponse } from "msw"
import { describe, expect, it } from "vitest"
import { server } from "@/test/msw/server"
import { LiveApi } from "./live"

describe("LiveApi", () => {
  it("registers a user id", async () => {
    server.use(
      http.post("/api/register", async ({ request }) => {
        expect(await request.json()).toEqual({ userId: "usr_abc" })
        return HttpResponse.json({ status: "ok" })
      }),
    )
    await expect(LiveApi.register("usr_abc")).resolves.toEqual({ status: "ok" })
  })

  it("asks for signed URLs with bare filenames, as the contract specifies", async () => {
    server.use(
      http.post("/api/getSignedUrl", async ({ request }) => {
        expect(await request.json()).toEqual({
          userId: "usr_abc",
          requestId: "req_1",
          files: ["a.pdf", "b.pdf"],
        })
        return HttpResponse.json({ userId: "usr_abc", requestId: "req_1", files: [] })
      }),
    )
    await LiveApi.getSignedUrls("usr_abc", "req_1", ["a.pdf", "b.pdf"])
  })

  it("sends the received list on a schema poll so the server can send a delta", async () => {
    server.use(
      http.post("/api/polling/schema", async ({ request }) => {
        expect(await request.json()).toMatchObject({ received: ["f1"] })
        return HttpResponse.json({
          userId: "u", requestId: "r", pending: 0,
          convertAvailable: true, convertBlockedReason: null, files: [],
        })
      }),
    )
    const res = await LiveApi.pollSchemas("u", "r", ["f1"])
    expect(res.convertAvailable).toBe(true)
  })
})
```

- **Step 3: Run** → FAIL.
- **Step 4: Implement `live.ts`**

```ts
import { postJson } from "./http"
import type { QuarryApi } from "./contract"
import type * as T from "./types"

const notLive = (what: string) => () => {
  throw new Error(`${what} has no endpoint yet — see backend plan §0.9. Use FixtureApi.`)
}

export const LiveApi: Pick<
  QuarryApi,
  "register" | "getSignedUrls" | "confirmUploads" | "pollSchemas" | "updateSchemas" | "convert" | "pollResult"
> = {
  register: (userId) => postJson<T.RegisterResponse>("/api/register", { userId }),

  getSignedUrls: (userId, requestId, files) =>
    postJson<T.SignedUrlResponse>("/api/getSignedUrl", { userId, requestId, files }),

  confirmUploads: (userId, requestId, files) =>
    postJson<T.UploadResponse>("/api/upload", { userId, requestId, files }),

  pollSchemas: (userId, requestId, received, signal) =>
    postJson<T.SchemaPollResponse>("/api/polling/schema", { userId, requestId, received }, signal),

  updateSchemas: (userId, requestId, files) =>
    postJson<T.UpdateSchemaResponse>("/api/updateSchema", { userId, requestId, files }),

  convert: (userId, requestId) => postJson<T.ConvertResponse>("/api/convert", { userId, requestId }),

  pollResult: (userId, requestId, signal) =>
    postJson<T.ResultPollResponse>("/api/polling/result", { userId, requestId }, signal),
}

export { notLive }
```

- **Step 5: Write the fixture JSON**

Each file mirrors the example payloads in backend plan §0.4 and §0.7 exactly, extended to the
scenario in the canvas: `result-poll.json` carries 39 tables — 18 done (one of them with
`toCheckCount: 3`), 1 extracting at page 2 of 3, 1 filling, 19 queued, 2 failed
(`format_locked`) — and `counts` that sum to 39.

`table-invoice-1044.json` is the S06 artboard's table: 22 rows over six fields, row 3's
`invoice_date` in state `not-found`, rows 4 and 5's `vat` in state `marked` with the reason
*"20% of 3,480.00 would be 696.00. The page says 216.40, and that is what was recorded."*, and
row 7 carrying `failed` with *"The scan is cut off at the right edge, so the numbers are missing
rather than wrong."*

- **Step 6: Run** → 3 passed.
- **Step 7: Commit**

```bash
git add fixtures/api packages/web/src/lib/api/contract.ts packages/web/src/lib/api/live.ts packages/web/src/lib/api/live.test.ts
git commit -m "feat(web): LiveApi for the seven endpoints, and the shared fixture set"
```

---

### Task 12 · `FixtureApi` and the composed `api`

**Files**

- Create: `packages/web/src/lib/api/fixtures.ts`, `packages/web/src/lib/api/index.ts` (+ `index.test.ts`)
- **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"
import { api } from "./index"

describe("the composed api", () => {
  it("serves a table from the fixture set", async () => {
    const table = await api.getTable("req_1", "sch_32")
    expect(table.fileName).toBe("invoice-1044.pdf")
    expect(table.rows).toHaveLength(22)
  })

  it("marks the vat cell on row 5 with its reason", async () => {
    const table = await api.getTable("req_1", "sch_32")
    const cell = table.rows[4].values.vat
    expect(cell.state).toBe("marked")
    expect(cell.reason).toMatch(/216\.40/)
  })

  it("reports a whole row that could not be read", async () => {
    const table = await api.getTable("req_1", "sch_32")
    expect(table.rows[6].failed?.message).toMatch(/cut off at the right edge/i)
  })

  it("returns a page locator with fractional box coordinates", async () => {
    const evidence = await api.getEvidence("val_r5_vat")
    expect(evidence.locator.type).toBe("page")
    if (evidence.locator.type === "page") {
      expect(evidence.locator.box.x).toBeGreaterThan(0)
      expect(evidence.locator.box.x).toBeLessThan(1)
    }
  })

  it("refuses an exact-match merge across differing schemas", async () => {
    const result = await api.createMerge("req_1", ["sch_totals_a", "sch_lines_b"], "August")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.conflicts[0].field).toBeTruthy()
  })
})
```

- **Step 2: Run** → FAIL.
- **Step 3: Implement `fixtures.ts`**

Reads the JSON under `fixtures/api/` through the `@fixtures` alias, with a 120 ms delay so loading
states are exercised in development. `createMerge` implements the **exact** check itself — same
field names, same types, order-independent — and returns grouped conflicts, so the client-side
behaviour is the real behaviour when the endpoint lands.

- **Step 4: Implement `index.ts`**

```ts
import { FixtureApi } from "./fixtures"
import { LiveApi } from "./live"
import type { QuarryApi } from "./contract"

/**
 * The seven routes are live; §0.9's surfaces are fixtures. Moving one across
 * is a single line here and no change to any screen.
 */
export const api: QuarryApi = { ...FixtureApi, ...LiveApi }

export * from "./contract"
export * from "./types"
export { ApiError } from "./http"
```

- **Step 5: Run** → 5 passed.
- **Step 6: Commit**

```bash
git add packages/web/src/lib/api
git commit -m "feat(web): FixtureApi for the surfaces with no endpoint, composed behind one interface"
```

---

### Task 13 · Session and workspace

**Files**

- Create: `packages/web/src/lib/session.ts` (+ `.test.ts`),
`packages/web/src/state/workspace.tsx` (+ `.test.tsx`)
- **Step 1: Write the failing test** — `session.test.ts`

```ts
import { http, HttpResponse } from "msw"
import { describe, expect, it, vi } from "vitest"
import { server } from "@/test/msw/server"
import { ensureSession, getUserId, workspaceLink } from "./session"

describe("session", () => {
  it("generates a user id with real entropy and keeps it", async () => {
    server.use(http.post("/api/register", () => HttpResponse.json({ status: "ok" })))
    const id = await ensureSession()
    expect(id).toMatch(/^usr_[A-Za-z0-9_-]{22,}$/)
    expect(getUserId()).toBe(id)
  })

  it("registers once, not on every call", async () => {
    const seen = vi.fn()
    server.use(http.post("/api/register", () => { seen(); return HttpResponse.json({ status: "ok" }) }))
    const first = await ensureSession()
    const second = await ensureSession()
    expect(second).toBe(first)
    expect(seen).toHaveBeenCalledOnce()
  })

  it("adopts an id handed over in the url, because that is the share mechanism", async () => {
    server.use(http.post("/api/register", () => HttpResponse.json({ status: "ok" })))
    const id = await ensureSession("usr_sharedsharedsharedshared")
    expect(id).toBe("usr_sharedsharedsharedshared")
  })

  it("builds a link that carries the workspace", () => {
    expect(workspaceLink("usr_abc", "https://q.app")).toBe("https://q.app/?w=usr_abc")
  })
})
```

- **Step 2: Run** → FAIL.
- **Step 3: Implement `session.ts`**

```ts
import { api } from "@/lib/api"

const KEY = "quarry.userId"
const REGISTERED = "quarry.registered"

/** 128 bits, base64url. The id is a bearer capability, so its entropy is the security control. */
function newUserId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const b64 = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")
  return `usr_${b64}`
}

export function getUserId(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export async function ensureSession(adopt?: string | null): Promise<string> {
  const existing = getUserId()
  const id = adopt ?? existing ?? newUserId()

  if (id !== existing) {
    localStorage.setItem(KEY, id)
    localStorage.removeItem(REGISTERED)
  }
  if (localStorage.getItem(REGISTERED) === id) return id

  await api.register(id)
  localStorage.setItem(REGISTERED, id)
  return id
}

export function workspaceLink(userId: string, origin: string): string {
  return `${origin}/?w=${userId}`
}
```

- **Step 4: Implement `state/workspace.tsx`**

There is no list-my-batches endpoint (§0.9), so the workspace list is client-local:

```ts
type WorkspaceBatch = {
  requestId: string
  name: string
  createdAt: string
  fileCount: number
  phase: "prepare" | "converting" | "paused" | "done" | "failed"
  /** Last poll's headline numbers, so a card reads true before its first poll returns. */
  summary: { tables?: number; rows?: number; toCheck?: number; failed?: number; etaSeconds?: number | null }
}
```

`WorkspaceProvider` reads and writes `localStorage["quarry.workspace"]`, exposes
`{ batches, addBatch, updateBatch, removeBatch }`, and is resilient to a corrupt or absent value
(returns an empty list rather than throwing). Its test covers: round-trip through `localStorage`,
newest-first ordering, and a corrupt value yielding an empty list.

- **Step 5: Run** — `npx vitest run src/lib/session.test.ts src/state/workspace.test.tsx` → pass.
- **Step 6: Commit**

```bash
git add packages/web/src/lib/session.ts packages/web/src/lib/session.test.ts packages/web/src/state/workspace.tsx packages/web/src/state/workspace.test.tsx
git commit -m "feat(web): anonymous session, and a browser-local workspace list"
```

---

*Phases 2 through 8 follow in the same shape. Each task names its files, opens with a failing
test, shows the implementation, states the command and the expected result, and ends in a commit.*

# Phase 2 — S01 Workspace


| Task   | Builds                           | Key assertions                                                                                                                                                                                                                                      |
| ------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **14** | `AppHeader` + `AllowanceMeter`   | Meter shows `1,840 / 5,000` in tabular mono; the workspace-link control copies `?w=<userId>` and says the link carries the whole workspace                                                                                                          |
| **15** | `DropZone`                       | States `idle · dragging · dragging-invalid · disabled`; accepted formats and the size cap are written **inside** the zone; a real `<input type="file">` with `webkitdirectory` for the folder path, so the keyboard can do everything the mouse can |
| **16** | `BatchCard` + the workspace page | Six card states (`prepare · converting · paused · done · done-with-failures · failed`); first visit shows the drop zone as the page with no pretend content; a paused card shows where it stopped and when it resumes                               |


# Phase 3 — Upload


| Task   | Builds                               | Key assertions                                                                                                                                                                                                                  |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **17** | `preflight.ts`                       | Rejects empty (`empty_file`), oversized (`too_large`), `.zip` (`archive_not_expanded`, *"unzip it first"*) and unknown extensions (`format_unsupported`); one bad file never rejects the drop                                   |
| **18** | `upload.ts`                          | XHR for per-file progress (fetch cannot report it); concurrency **2**, matching the canvas; per-file retry that leaves the other twenty-eight untouched; sends `uploadHeaders` **verbatim** and adds nothing, per backend §19.1 |
| **19** | `FileRow` + `FileList`               | One component, a trailing slot, ten states; the trailing control is present from the first frame and disabled until the shape lands, because a visible disabled button beats an empty space                                     |
| **20** | `b/[requestId]` shell + upload phase | `getSignedUrls` → PUT → `confirmUploads`; the header counts shapes (*"6 of 6 uploaded · 5 schemas back"*); upload and schema-reading run as **two clocks**, so a row can be uploaded while its shape is still coming            |


# Phase 4 — Schemas and the gate


| Task   | Builds                               | Key assertions                                                                                                                                                                                                                           |
| ------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **21** | `schema.ts`                          | `shapeHash` is order-independent over `(key, type)`; `applyToAllTargets` matches on **original** fields, never current; `validateNewField` rejects an empty or colliding name; there is **no** rename and **no** delete function to call |
| **22** | `polling.ts` (`usePoll`)             | Fires immediately then on the interval; backs off 2 s → 5 s after 60 s; stops on the stop predicate; aborts in flight on unmount; a failed poll retries without losing the last good state                                               |
| **23** | `FieldTypeSelect` + `SchemaFieldRow` | The type control is the only interactive thing on the row; the field name renders mono with **no input chrome and no hover affordance**; an added field is marked *added by you*                                                         |
| **24** | `AddFieldControl`                    | Inline name + type; invalid blocks saving and says why; the entered value survives a failed save                                                                                                                                         |
| **25** | `SchemaEditor`                       | Panel and card are one component at two widths; states `reading · ready · editing · invalid · saving · saved · save-failed · no-shape`; a save failure keeps the edit on screen                                                          |
| **26** | `ApplyToAllControl`                  | Count in the label (*"Apply to 37 files"*); pressing it reveals the affected names **before** committing; the save sends one entry per affected `(fileId, schemaId)`                                                                     |
| **27** | `SchemaCard` + `SchemaGroupList`     | Schemas grouped by identical original shape with a count; a file with three tables shows three, each labelled with where in the file it came from                                                                                        |
| **28** | Prepare phase two                    | Schema-first list, editor in a 460px panel, `WontConvertPanel` naming each unconvertible file and why                                                                                                                                    |
| **29** | `ConvertBar`                         | Convert is gated on `convertAvailable` from the server and says `convertBlockedReason`; **Review schemas** enables as soon as any one shape is ready; a 409 `gate_not_met` re-renders the reason rather than a generic error             |


# Phase 5 — Converting


| Task   | Builds                          | Key assertions                                                                                                                                                                          |
| ------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **30** | `useResultPolling`              | 2 s while `CONVERTING`, 30 s while `PAUSED`, stop at `COMPLETED`/`FAILED`                                                                                                               |
| **31** | `StatusSentence`                | Reads true in all five states, including *"0 of 200 done · none of these could be read"*                                                                                                |
| **32** | `PausedBanner` + allowance line | Paused renders in `--paused`, never amber and never red, and states the resume time; finished tables stay open and downloadable                                                         |
| **33** | `PipelineStrip`                 | Four stage counts that **always sum** to the batch total, failures included and named under Done; two stages lit at once; motion off under reduced-motion while the counts still update |
| **34** | `TableList`                     | Order fixed — a finished row gains View and Download **in place**, never re-sorting; a failed row states why on the row                                                                 |


# Phase 6 — The table and its evidence


| Task   | Builds                                            | Key assertions                                                                                                                                                                                                                                                                                                                |
| ------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **35** | `DataTable` on TanStack **v9**                    | `tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), … })`, `useTable(options, selector)`, `table.FlexRender`. **Read the package's `skills/getting-started/SKILL.md` first** — v8 examples produce the wrong setup. Sticky header, rules not stripes, virtualized past 100 rows                       |
| **36** | `DataCell` + `MarkedCellReason`                   | Four states, each distinct **without colour**: value (tabular), `not found` (italic, muted), marked (amber fill + glyph + reason inline), failed row (greyed, labelled). A blank and a zero are different claims and neither is ever substituted for "not found"                                                              |
| **37** | Toolbar: search, filter, sort, marked-cell nav    | *"2 of 3"* with previous/next moves the selection **and** the evidence panel together                                                                                                                                                                                                                                         |
| **38** | `RawTextView`                                     | The canvas's replacement for the machine view: the text as it came off the page, before fields                                                                                                                                                                                                                                |
| **39** | `EvidencePanel` + `EvidenceView` + `HighlightBox` | Opens from **any** cell, not only marked ones; five views dispatched by locator type; `none` says so plainly and shows the source text rather than drawing a box we aren't sure about; the highlight draws over 400 ms, and appears instantly under reduced-motion; read-only, with the sentence about downloading to correct |
| **40** | `EvidencePageView` on pdf.js                      | Renders the page to a canvas and positions the box from **fractional** coordinates, so the worker's PyMuPDF boxes and the browser's pdf.js render agree                                                                                                                                                                       |


# Phase 7 — Out of the building


| Task   | Builds                                                                          | Key assertions                                                                                                                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **41** | `csv.ts` + `DownloadTableButton`                                                | One click, no dialog, generated client-side from rows already held; `not found` exports as an empty cell **and** the summary says how many there were, never as `0`                                                                                                               |
| **42** | `DownloadAllDialog`                                                             | The honest summary — rows, files failed, cells worth a look — shown **before** the download; disabled with a reason when there is nothing to download                                                                                                                             |
| **43** | `MergePicker` (variant A) + `MergeGroupCard` + `MergeSummary` + `MergeConflict` | Group checkbox shows a dash on a partial pick; *Select all* is one click and not the default; incompatible groups stay **visible** with their fields and a plain reason; the conflict renders **on the offending card**; the summary panel names what you'll get before you press |


# Phase 8 — Hardening


| Task    | Covers                                                                                                                                                                                                                                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **44a** | `not-found.tsx` (S14) and `error.tsx` (S15) on `ErrorState`, each with a way back to the workspace; `ConnectionStatus`, which says *reconnecting* and keeps showing the last known state rather than freezing silently, and says *offline* rather than implying the last data is current                                    |
| **44**  | Accessibility pass — every disabled reason in the accessible name, live regions for shape-ready / file-finished / batch-paused without stealing focus, focus visible everywhere, `Esc` closes both panels, 44px touch targets, 4.5:1 text contrast                                                                          |
| **45**  | Docs — update `ui-design-spec.md` for the ten conflicts in §0.1, and add every new component to `component-inventory.md` **in the same commit as the code it describes**                                                                                                                                                    |
| **46**  | Playwright E2E — the happy path (drop → shapes → edit a type → apply to all → convert → open a table while others still run → evidence on a cell → download), the gate (one unreadable file does **not** block Convert), and the pause (quota reached renders as a pause with a time and finished tables stay downloadable) |


---

## 6. Definition of done

- `npm run typecheck`, `npm run lint`, `npm test` and `npm run test:e2e` all pass.
- No component imports `fetch`; everything goes through `api`.
- No component renders `error.message`; everything goes through `FailureMessage`.
- No bare spinner exists — every wait goes through `LoadingState`.
- No disabled control exists without a reason in its accessible name.
- There is no rename or delete control on a schema field, greyed out or otherwise.
- Apply-to-all matches on original shapes, and lists the files before committing.
- Convert enables on *settled*, not on *succeeded*.
- A finished table opens while the rest of the batch is still running.
- Evidence opens from any cell, and says so honestly when a format cannot report a position.
- Merge is exact; a conflict names the table, the field and the disagreement, on the card.
- A quota pause renders in `--paused` with a time, and nothing already finished is lost.

## 7. Open questions


| #      | Question                                                                                                                                                | Blocks               | Needed by      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------- |
| **F1** | Does the server accept the §0.8 additions, A3 above all?                                                                                                | Tasks 20, 29, 30, 33 | Before Phase 4 |
| **F2** | Merge variant A or B? A is planned; B is better past ~40 tables in one schema                                                                           | Task 43              | Before Phase 7 |
| **F3** | Is the page allowance per user or per batch? The header meter implies per user; *"Raise the cap"* implies a setting that does not exist yet (S12 is P1) | Tasks 14, 32         | Before Phase 5 |
| **F4** | Where does "Raise the cap" go before S12 exists?                                                                                                        | Task 32              | Before Phase 5 |


