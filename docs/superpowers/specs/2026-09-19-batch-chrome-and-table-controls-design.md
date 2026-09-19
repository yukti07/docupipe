# Batch chrome, and the table's own controls

Status: implemented
Date: 2026-09-19
Scope: `BatchShell` and `BatchFooter` (new), `BatchNav`, `AppHeader`, `DataTable`, `ColumnFilter`,
`SchemaGroupCard`, `ConvertBar`, `FileActions`, and the five batch screens

## 1 · Why

Eight complaints, which come down to three causes.

**The chrome was per-screen.** The five batch screens hand-rolled their own layout into
`AppHeader`'s `children` slot and put their action buttons wherever the content happened to end —
Review schemas above the cards, the table screen above the toolbar, Merge inside a sidebar. A
button that moves between screens is a button people stop looking for.

**The rail described progress rather than place.** Uploading every file moved the lit step to
Schemas although the screen had not changed, and Convert was drawn as reachable although it is a
button in the footer and has never had a screen. Pressing Drop more files then appeared to walk the
rail backwards.

**The table sized itself by accident.** `table-layout: auto` over a windowed body re-derives every
column width from whichever rows happen to be mounted, so a column was as wide as the last thing
that scrolled past it.

## 2 · The shell

`BatchShell` owns the header, the rail, a scrolling body, the footer, and the panel's geometry.
Each screen passes `panel`, `footer` and its children.

| Piece | Rule |
|---|---|
| Column | `h-dvh`, so the footer cannot slide below the fold. The document body only sets a *minimum* height. |
| Middle row | `relative flex flex-1 min-h-0` — the body and the panel share it |
| Body | `flex-1 min-h-0 overflow-auto`; gives up `panelWidth` of right padding at `lg` while a panel is open |
| Panel | `absolute inset-y-0 right-0` inside that row, so it ends exactly where the footer starts |
| Footer | Below both, full-bleed, `shrink-0`. A `BatchFooter` with `status` left and `actions` right |

The footer holds the actions — Convert among them — and an action you cannot see is an action you
do not have. Nothing is allowed to cover it, which is why the panel lives in the body's row rather
than floating over the whole window.

`ConvertBar` became a `BatchFooter` renderer rather than a bar of its own, so the one gate keeps
its two progress lines and its own byte-progress rule while sitting in the shared bar.

`SplitPane` and its test are deleted: all three of its callers moved to the shell.

### What closes a panel

A press outside the panel runs its own action first, and only a press with no action of its own
closes the panel. `isInteractive` treats links, buttons, inputs, selects, checkboxes, options,
menu items, tabs, comboboxes and `[contenteditable]` as having a job; everything else — a heading,
a card's padding, the space under a list — is inert and dismisses. Escape and the panel's own close
button still work. Review schemas suspends the rule entirely while its editor holds an unsaved
draft.

## 3 · The rail

Four steps: **Files · Schemas · Convert · Results**. No numbers anywhere.

| Step | Lit when | Links to |
|---|---|---|
| Files | the screen is Files | `/request/:id`, or `?view=files` past the gate |
| Schemas | the screen is Review schemas | `/request/:id/schemas` |
| Convert | never — it is a milestone, not a destination | never |
| Results | the screen is Results, a table, or Merge | `/request/:id`, once converted |

**The lit step is the screen, not the progress.** Files stays lit after every file has uploaded;
only pressing Review schemas moves the rail. Ticks still follow progress: Files ticks when every
file has uploaded, Schemas when every shape has settled, and both tick unconditionally past the
gate.

Markers: tick for done, a filled disc for the step you are on, a hollow ring for one ahead, and a
padlock on Convert on both sides of itself. Results never ticks — whether the batch finished is the
status sentence's job.

A table and the merge screen are parts *of* Results, not somewhere else, so the step stays lit while
one is open — and stays a link, because it is the way back up out of it. `aria-current` moves to the
tail, which is the more specific place, and the tail is drawn as a chip like the steps beside it
rather than as loose text that read like a caption on them.

Convert is the only step whose name changes: **Convert → Converting → Converted**. While it reads
Converting, the two rules touching it are marching dashes (`.rail-dashes`, collapsed by the
reduced-motion block). Dashes rather than a filling bar, because the server sends no per-file
percentage during a run and a bar that filled would be inventing one.

## 4 · Read-only past the gate

Files and Schemas stay reachable after Convert, as a record. `?view=files` renders the Prepare
screen frozen; Review schemas reads the batch's phase out of the workspace and freezes itself.

Frozen means: no Drop more files, no retry, no discard, `SchemaEditor frozen` (the prop already
existed), and the footer's Convert replaced by **Back to results**.

## 5 · The table

**Density is a size, not a gap.** Compact now sets 12px cell text against comfortable's 13px, and
the sizer is told which — smaller text, tighter cell padding, no type badge, and a floor that gives
way by 15%. Padding alone moved the rows closer together and left every column exactly as wide as
before, which is not what a density control is for.

**Widths.** `lib/colwidth.ts` measures each column's header and a sample of 150 rows with a canvas
text metric and clamps the result by type — figures 92–160, dates 104–150, text 110–320. The
ceiling applies to the *cells*; a column is never narrower than its own name, because the header is
the one string always on screen. The badge is measured as drawn (uppercase), which is what had been
truncating short names on currency columns. Where there is no canvas — SSR, and jsdom under test —
an average advance width stands in, which is exact on the monospaced face and inside the clamps on
the other.

Applied through `<colgroup>` with `table-layout: fixed` and `min-width: <sum>`, so a table wider
than its box scrolls rather than rescaling every measurement into proportions. A trailing spacer
column with no width takes the slack when the box is *wider* than the sum — fixed layout otherwise
shares the leftover across the real columns, and a five-column table on a wide screen stranded each
header's filter button half a screen from the name it belonged to.

**Order.** `columnOrderingFeature` from table-core, driven by a grip in each header: HTML5 drag, or
←/→ on the focused grip. Session-only — it is a way of reading this table, not a property of it.

**Filter.** The operator `Select` is replaced by a list that opens attached to the panel's right
edge, so the value field and Apply stay in view while an operator is chosen — picking "is between"
and watching a second input appear is the moment the form explains itself. It renders inside the
popover rather than in a portal, because a portalled menu is "outside" as far as the popover is
concerned and every pick would dismiss the form it was filling in. It keeps `combobox`/`listbox`/
`option` roles, so nothing is lost to the keyboard or a screen reader.

## 6 · The rest

- `SchemaGroupCard`'s "and N more" is a button. It was a label, which made the files it stood for
  unreachable from the card at all.
- Convert carries no count, on either screen that offers it.
- `AppHeader` is the product's name and the screen's own bar. The allowance meter and the workspace
  link are gone; `lib/allowance.ts` went with them, since nothing read the figure it stored. The
  meter itself survives in `PausedBanner`, beside the pause it explains.
- "Back to files" leaves Review schemas and "Back to the batch" leaves the table screen — the rail
  does both, and a second copy is only a second thing to read.
- `MergePicker`'s grid uses `minmax(0,1fr)`. A grid track's automatic minimum is its min-content, so
  a long filename had been pushing the summary — and Combine with it — off the right edge.

## 7 · Not done

**Combine stays in the merge summary** rather than moving to the footer. It is the one action in
the product that means nothing without the ticks beside it, and lifting `MergePicker`'s selection
state out to the page to relocate the button would be a larger change than the rest of this put
together. The merge footer carries the way out.

**The download button is unchanged.** Showing "Downloaded" and disabling was dropped from scope.
