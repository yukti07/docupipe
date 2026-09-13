# Screen Inventory

Every screen, panel and state in Quarry — the flows in [`user-flows.md`](user-flows.md) turned into
things that have to be designed and built.

**Priority** matches [`feature-priorities.md`](feature-priorities.md). A screen marked P1 or P2
doesn't block the product working end to end.

---

## Screen map

| ID | Screen | Purpose | Priority |
|---|---|---|---|
| **S01** | Workspace | Where you land. Upload, and your batches | P0 |
| **S02** | Upload & Schema | Take files in, read each one's shape back, let you correct it | P0 |
| **S03** | Schema editor | One file's proposed table — and the all-files view | P0 |
| **S04** | Processing | Tell the truth while you wait, hand back each file as it lands | P0 |
| **S05** | Machine view | Watch the work happening | P1 |
| **S06** | File result | One file's table | P0 |
| **S07** | Evidence | Where a value came from — a panel inside S06 | P0 |
| **S08** | Download | Leave with an honest summary | P0 |
| **S09** | Merge | Combine tables that share a shape | P0 |
| **S10** | Insights | Charts and findings across the batch | P1 |
| **S11** | Review queue | Marked cells, one at a time, keyboard only | P2 |
| **S12** | Settings | Your processing cap, and little else | P1 |
| **S13** | Demo | A prepared batch, opened on purpose | P1 |
| **S14** | Not found | A link that doesn't go anywhere | P0 |
| **S15** | Something broke | The catch-all, which should almost never appear | P0 |

---

## S01 · Workspace

Landing page and dashboard are the same page. There's no marketing screen in front of the product
and no sign-in between you and it.

**States**

- **First visit** — no batches. The upload area *is* the page. One line saying what this does, and
  a way into the demo. It does not pretend to have content.
- **Has batches** — your batches listed newest first, upload area still prominent
- **Loading** — fetching your batches
- **A batch is still on Upload & Schema** — card says so, with how many files are waiting on you
- **A batch is converting** — live count on its card, updating
- **A batch is paused** — card shows where it stopped and when it resumes
- **A batch failed entirely** — card says so plainly
- **Couldn't load your workspace** — a real message, and a retry

---

## S02 · Upload & Schema

The biggest screen in the product. Two jobs at once: files go up, and each file's shape comes back.
It replaces both the old Upload screen and the old batch-level Columns step.

**States**

- **Empty** — idle drop zone. Supported formats and the size limit are written *inside* it, before
  you've tried anything
- **Dragging over** — the zone visibly reacts, so you know the drop will work before you let go
- **Dragging something we can't take** — folder of the wrong things, or not a file at all
- **Checking** — pre-flight running, before anything is sent
- **Some files rejected** — mixed list, each rejection with its own reason, the good ones carrying
  on regardless
- **Everything rejected** — nothing to upload, with the reasons and what to do
- **Uploading** — one row per file, each with its own progress bar
- **One file failed** — that row is retryable on its own; the others are untouched
- **Uploaded, shapes still coming back** — some rows have their button enabled, some don't
- **Every shape settled** — Convert enables
- **Nothing could be read from any file** — rare, and honest about it
- **Cancelled** — you backed out mid-upload

**Per-file row states** (this row repeats and carries most of the screen's complexity)

```
Staged  →  Checking  →  Uploading  →  Uploaded  →  Reading shape  →  Shape ready
               ↓             ↓                           ↓
           Rejected      Failed → Retry            No shape found
                                                   Couldn't read it
```

The row carries: filename · size · progress bar · state · retry · **Preview / Edit** button.

**The Preview / Edit button** is present from the moment the row appears and **disabled until that
file's shape is ready**. A visible disabled button beats an empty space, because it tells you
something is coming.

Rejection reasons each get their own wording: empty file · too large · format we can't read ·
named as one thing but actually another.

**The two footer buttons**

| Button | Enabled when | Disabled state must say |
|---|---|---|
| **Review schemas** | Any one shape is ready | "No schemas ready yet" |
| **Convert** | Every file has uploaded *and* settled its shape | How many files are still outstanding |

"Settled" means ready **or** failed. A file whose shape couldn't be read doesn't block Convert — it
is carried through as a failure with a reason.

---

## S03 · Schema editor

The screen that replaces asking you to describe your table before anything has been read. Reached
two ways, and it is the same component both times.

| Entry point | Shows |
|---|---|
| A file's **Preview / Edit** | That one file's schema, or all of its schemas if it held several tables |
| **Review schemas** | Every ready schema in the batch, at once |

**States**

- **Reading this file** — the shape hasn't come back yet. A wait with a real explanation, not a
  spinner
- **One schema** — fields listed, each with its name and type
- **Several schemas from one file** — a file that held three tables shows three, edited separately,
  each labelled with where in the file it came from
- **All-files view** — every ready schema, grouped so identical ones sit together with a count
- **Editing a field's type** — the type control open
- **Adding a field** — name and type, inline
- **Apply-to-all offered** — shown only when other files originally matched this shape, with the
  count: *"12 other files started with this shape"*
- **Apply-to-all confirming** — the affected files listed by name before you commit
- **Invalid** — a new field with an empty name, or a name that collides with an existing one.
  Blocks saving, says why
- **Saving**
- **Saved** — with what it applied to, if it applied to more than this file
- **Save failed** — the edit is kept on screen, never discarded, with a retry
- **Nothing could be detected** — rare, and honest about it: add your fields manually, or leave
  this file out
- **Reading failed** — couldn't get far enough to propose anything

**The two edit operations, and only two**

```
Change a field's type      text · number · date · currency · yes/no · list
Add a field                name + type
```

Rename and delete are deliberately absent — [`user-flows.md` §5](user-flows.md) explains why. The UI
must not show greyed-out rename/delete controls either; an affordance that never works is worse than
no affordance.

---

## S04 · Processing

**States**

- **Waking up** — the first few seconds from cold. Named, so a normal pause never reads as a stall
- **Running** — the honest sentence at the top, one row per file beneath
- **First file done** — the moment the screen stops being a waiting screen. That row gains **View**
  and **Download**
- **Some done, some running** — the ordinary state, and the one to design hardest for
- **Paused — daily limit reached** — neutral, with the time it picks up again. Not an error.
  Everything already finished stays open and downloadable
- **Paused — your processing cap reached** — neutral, with what you can do
- **Live updates interrupted** — reconnecting, and saying so rather than freezing silently
- **Finishing up** — last few files
- **Finished** — **Merge** and **Insights** appear alongside Download all
- **Everything left over failed** — the finished files stay usable; a failure summary explains the
  rest
- **Nothing usable in this batch** — every file failed. No tables to show, so the screen says so
  rather than offering empty buttons

**No edits on this screen.** Not to schemas, not to values. The only actions are view, download,
merge and insights.

**The header sentence** is its own small design problem, since it has to stay true in every state
above:

```
Running   "127 of 200 done · 61 waiting · 8 to check · 4 failed"
Paused    "140 of 200 done · picking up again at 14:32"
Finished  "196 of 200 done · 8 to check · 4 failed"
Failed    "0 of 200 done · none of these could be read"
```

---

## S05 · Machine view — P1

Documents moving through the stages of processing, live.

**States**

- **Live** — work in progress, stages filling and draining
- **Idle** — nothing running
- **A provider is out of quota** — that link greyed, the next one lit, with the reset time
- **Everything is backed off** — all providers temporarily unavailable, which is a real state and
  needs to look like a pause, not a crash
- **Reconnecting** — lost the live feed

---

## S06 · File result

One file's table. Opened from a finished row on S04, and this is also what a merged table renders
as.

**States**

- **Loading** — fetching the table
- **Clean** — nothing marked, nothing failed. The plain good outcome
- **Has cells to check** — count shown, each marked cell carrying its reason inline
- **Has failed rows** — count shown, and the reasons one click away
- **Several tables from one file** — tabbed or listed, matching the schemas that produced them
- **Empty** — this file produced nothing. Not a blank grid: an explanation
- **Filtered to nothing** — your filter matched no rows, and it's clear that's why
- **Searching** — results narrowing as you type
- **A cell is selected** — Evidence opens beside it
- **Merged table** — same screen, plus a source-file column, and a banner saying which tables went
  into it

---

## S07 · Evidence — panel inside S06 and S11

Available on every cell, not only marked ones. **Read-only** — it shows where a value came from, it
does not let you change it.

**States**

- **Closed** — the default
- **Opening** — the highlight drawing itself onto the page
- **Page, with the spot boxed** — PDF, scan or image
- **Recording, cued to the moment** — audio, with the words
- **Paragraph highlighted** — Word or text
- **Sheet, row and column** — spreadsheet, CSV or JSON
- **Position not reportable** — the format can't say where the value was. Explain it plainly and
  show the source text. Never draw a box we aren't sure about
- **Loading the page** — large documents take a moment
- **Source unavailable** — the original couldn't be loaded, said honestly rather than shown as an
  empty frame

---

## S08 · Download

Two affordances of deliberately different weight.

**Download this file** — a button on a finished row (S04) and inside a table (S06). One click, no
dialog. You are looking at the table; you already know what's in it.

**Download all** — a dialog, because this is the one that leaves the building.

**States**

- **Idle** — the button carries the count: *"Download all · 182 rows"*
- **Options** — CSV or Excel
- **Warning** — *"182 rows across 47 files · 4 files failed · 3 cells worth a look"*, shown
  **before** the download, never after
- **Preparing**
- **Downloaded**
- **Failed** — with a retry
- **Nothing to download** — every file failed; the button is off and says why

---

## S09 · Merge

Available only once every file has finished. Combining tables is always something the user asked
for; it never happens on its own.

**States**

- **Picker** — every finished table, grouped so identical shapes sit together with a count:
  *"31 tables · Invoice No, Date, Total"*
- **Nothing selected** — merge disabled, saying what to do
- **A compatible set selected** — merge enabled, with the resulting row count
- **An incompatible set selected** — merge blocked, with an error naming **which table, which
  field, and what disagrees**: *"`Invoice No` is text in 12 tables and number in 3"*
- **Merging**
- **Merged** — opens the merged table (S06 with a source-file column)
- **Merge failed** — a real message, selection preserved
- **Only one table in the batch** — merge is off, and says there's nothing to combine

**The check is exact:** same field names, same field types, order-independent. No widening, no
subsetting, no coercion.

---

## S10 · Insights — P1

The only screen that looks across files rather than inside one.

**States**

- **Idle** — the button, enabled once every file is finished
- **Working** — a labelled wait, with what it's doing
- **Findings** — charts and written findings, every finding citing the rows behind it
- **A finding is selected** — through to those rows in a table
- **Nothing worth reporting** — honest about it rather than padding with trivia
- **Not enough data** — too few rows or too few shared fields to say anything. Says which
- **Failed** — a real message and a retry, with the tables untouched

**The bounding rule:** a finding that cannot point at its rows is not shown. This is what stops the
screen becoming an open-ended box of assertions.

---

## S11 · Review queue — P2

Deferred. Marked cells come with their reason inline in the table (S06) until this exists; what this
adds is the ability to *fix* them.

**States** (for when it is built)

- **Showing a cell** — the value, why it's marked, and the evidence already open at the right place
- **Correcting** — typing a replacement
- **Drawing a box** — taking the value off the page instead of retyping it
- **Saving and advancing** — brief, then the next one
- **Skipped** — moved on, still marked
- **All done** — queue emptied
- **Nothing to review** — entered with no marked cells; says so rather than showing an empty loop
- **No evidence for this one** — you can still accept or correct, you just can't see a source

---

## S12 · Settings — P1

Deliberately thin. There's no account, so there's very little to configure.

**States**

- **Default** — your processing cap, and what you've used
- **Editing the cap**
- **Saved**
- **Appearance** (P2) — light and dark

---

## S13 · Demo — P1

The prepared batch, entered on purpose. Nothing is ever pre-loaded into your own workspace.

**States**

- **Intro** — what you're about to look at
- **Loaded** — a finished batch with its tables, evidence and a few marked cells, all working
- **Leaving** — back to your own workspace, which is still empty if it was empty

---

## S14 · Not found · S15 · Something broke

**S14 states:** the link doesn't exist · the batch was never here.

**S15 states:** an unexpected failure, with a way back to the workspace. If a user ever sees this
screen, the failure list in [`user-flows.md` §13](user-flows.md) is missing an entry — this screen
is the admission that something got past us, not a general-purpose error page.

---

## States that cut across every screen

These aren't screens. They can happen anywhere and each needs one consistent treatment.

| State | Treatment |
|---|---|
| **Waking up from cold** | Named as waking up, never a bare spinner |
| **Live updates lost** | Says it's reconnecting, keeps showing the last known state |
| **Offline** | Says so; doesn't pretend the last data is current |
| **Slow response** | Progress with substance, never a spinner alone |
| **A disabled button** | Always says what would enable it |
| **Keyboard focus** | Always visible, sensible order, on every screen |
| **Small screens** | The table and the evidence panel stack instead of sitting side by side |

---

## Repeating pieces and their states

Five small components carry a large share of the work, and each needs every state designed.

**A cell** — in every table

```
Value          normal text        checked, nothing flagged
"not found"    grey, italic       we looked; it isn't in this document
Marked         amber marker       we have a value but a check failed
(missing row)  greyed             that part of the document failed
Corrected      shown as edited    a person changed this — P2, with S11
```

**A file row** — on S02 during upload, and on S04 during processing

```
S02   Staged · Checking · Rejected · Uploading · Failed · Uploaded ·
      Reading shape · Shape ready · No shape · Unreadable

S04   Waiting · Running · Done (View + Download) · Failed · Paused
```

**A schema field** — on S03

```
Detected · Type changed · Added by you · Invalid
```

**A schema card** — on S03's all-files view and S09's picker

```
Ready · Edited · Shared with N other files · Failed to read
```

**A batch card** — on S01

```
Awaiting your schemas · Converting · Paused · Finished ·
Finished with failures · Failed entirely
```

---

## Screens we deliberately don't have

| Not built | Why | What covers it instead |
|---|---|---|
| **Sign in / sign up** | A workspace exists from your first visit | — |
| **Validation** | Checking is automatic and happens during processing. Nobody runs it by hand | Marked cells in **S06**, and **S11** when it lands |
| **Describe your table** | The system reads each file and proposes its shape | **S03 Schema editor** |
| **A batch-level Columns step** | The schema belongs to the file, not the batch | **S03**, per file, plus apply-to-all |
| **A marketing landing page** | The product is the landing page | **S01 Workspace** |
| **Confirm dialogs on ordinary actions** | Only things that cost money or throw work away deserve one | — |
| **A separate batch list** | The workspace is the list | **S01 Workspace** |
| **An automatic merge** | Combining tables is always the user's call | **S09 Merge** |
