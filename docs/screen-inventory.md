# Screen Inventory

Every screen, panel and state in Quarry — the flows in [`user-flows.md`](user-flows.md) turned into
things that have to be designed and built.

**Priority** matches [`feature-priorities.md`](feature-priorities.md). A screen marked P1 doesn't
block the product working end to end.

---

## Screen map

| ID | Screen | Purpose | Priority |
|---|---|---|---|
| **S01** | Workspace | Where you land. Upload, and your batches | P0 |
| **S02** | Upload | Take files in and reject the impossible fast | P0 |
| **S03** | Columns | Show the proposed table shape, let you correct it | P0 |
| **S04** | Processing | Tell the truth while you wait | P0 |
| **S05** | Machine view | Watch the work happening | P1 |
| **S06** | Results | The table | P0 |
| **S07** | Evidence | Where a value came from — a panel inside Results | P0 |
| **S08** | Review | Marked cells, one at a time, keyboard only | P1 |
| **S09** | Export | Leave with an honest summary | P0 |
| **S10** | Settings | Your processing cap, and little else | P1 |
| **S11** | Demo | A prepared batch, opened on purpose | P1 |
| **S12** | Not found | A link that doesn't go anywhere | P0 |
| **S13** | Something broke | The catch-all, which should almost never appear | P0 |

---

## S01 · Workspace

Landing page and dashboard are the same page. There's no marketing screen in front of the product
and no sign-in between you and it.

**States**

- **First visit** — no batches. The upload area *is* the page. One line saying what this does, and
  a way into the demo. It does not pretend to have content.
- **Has batches** — your batches listed newest first, upload area still prominent
- **Loading** — fetching your batches
- **A batch is still running** — live count on its card, updating
- **A batch is paused** — card shows where it stopped and when it resumes
- **A batch failed entirely** — card says so plainly
- **Couldn't load your workspace** — a real message, and a retry

---

## S02 · Upload

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
- **All uploaded** — moving on to reading the documents
- **Cancelled** — you backed out mid-upload

**Per-file row states** (this row repeats and carries most of the screen's complexity)

```
Staged        →  Checking  →  Uploading  →  Done
                     ↓             ↓
                 Rejected       Failed → Retry
```

Rejection reasons each get their own wording: empty file · too large · format we can't read ·
named as one thing but actually another.

---

## S03 · Columns

The screen that replaces asking you to describe your table before anything has been read.

**States**

- **Reading your documents** — working out what columns to propose. A wait with a real explanation,
  not a spinner
- **Proposal ready** — columns listed, each with how common it was: *"found in 47 of 50 files"*
- **Proposal ready, with merges** — where different files used different names for the same thing,
  shown as merged with the contributing names visible
- **Editing a column** — renaming, or describing it in your own words
- **Adding a column** — one the system missed
- **A merge being split apart** (P1)
- **Invalid** — two columns with the same name, or an empty name. Blocks starting, says why
- **Nothing could be detected** — rare, and honest about it: add your columns manually or try a
  different batch
- **Reading failed** — couldn't get far enough to propose anything

---

## S04 · Processing

**States**

- **Waking up** — the first few seconds from cold. Named, so a normal pause never reads as a stall
- **Running** — the honest sentence at the top, one row per document beneath
- **Paused — daily limit reached** — neutral, with the time it picks up again. Not an error
- **Paused — your processing cap reached** — neutral, with what you can do
- **Live updates interrupted** — reconnecting, and saying so rather than freezing silently
- **Finishing up** — last few documents
- **Finished** — moves you to Results
- **Everything left over failed** — moves you to Results with a failure summary
- **Nothing usable in this batch** — every document failed; Results would be empty, so we say so
  here instead

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

## S06 · Results

**States**

- **Loading** — fetching the table
- **Clean** — nothing marked, nothing failed. The plain good outcome
- **Has cells to check** — count shown, with a way into Review
- **Has failed documents** — count shown, and the reasons one click away
- **Partial, because the batch is paused** — the rows that exist, under a banner explaining the rest
  is coming
- **Empty** — everything failed. Not a blank grid: an explanation and a way back to Upload
- **Filtered to nothing** — your filter matched no rows, and it's clear that's why
- **Searching** — results narrowing as you type
- **A cell is selected** — Evidence opens beside it

---

## S07 · Evidence — panel inside S06 and S08

Available on every cell, not only marked ones.

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

## S08 · Review — P1

**States**

- **Showing a cell** — the value, why it's marked, and the evidence already open at the right place
- **Correcting** — typing a replacement
- **Drawing a box** — taking the value off the page instead of retyping it
- **Saving and advancing** — brief, then the next one
- **Skipped** — moved on, still marked
- **All done** — queue emptied, back to Results
- **Nothing to review** — entered with no marked cells; says so rather than showing an empty loop
- **No evidence for this one** — you can still accept or correct, you just can't see a source

---

## S09 · Export

A dialog rather than a full screen, but it has real states.

**States**

- **Idle** — the button carries the count: *"Export 182 rows"*
- **Options** — CSV or Excel
- **Warning** — *"3 cells you haven't checked · 4 documents failed"*, shown **before** the download,
  never after
- **Preparing**
- **Downloaded**
- **Failed** — with a retry

---

## S10 · Settings — P1

Deliberately thin. There's no account, so there's very little to configure.

**States**

- **Default** — your processing cap, and what you've used
- **Editing the cap**
- **Saved**
- **Appearance** (P2) — light and dark

---

## S11 · Demo — P1

The prepared batch, entered on purpose. Nothing is ever pre-loaded into your own workspace.

**States**

- **Intro** — what you're about to look at
- **Loaded** — a finished batch with its table, evidence and a few marked cells, all working
- **Leaving** — back to your own workspace, which is still empty if it was empty

---

## S12 · Not found · S13 · Something broke

**S12 states:** the link doesn't exist · the batch was never here.

**S13 states:** an unexpected failure, with a way back to the workspace. If a user ever sees this
screen, the failure list in [`user-flows.md` §11](user-flows.md) is missing an entry — this screen
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
| **Keyboard focus** | Always visible, sensible order, on every screen |
| **Small screens** | The table and the evidence panel stack instead of sitting side by side |

---

## Repeating pieces and their states

Four small components carry a large share of the work, and each needs every state designed.

**A cell** — in the table and in review

```
Value          normal text        checked, nothing flagged
"not found"    grey, italic       we looked; it isn't in this document
Marked         amber marker       we have a value but a check failed
Corrected      shown as edited    a person changed this
(missing row)  greyed             the document itself failed
```

**A file row** — during upload

```
Staged · Checking · Rejected · Uploading · Failed · Done
```

**A proposed column** — on S03

```
Detected · Merged from several names · Edited · Added by you · Invalid
```

**A batch card** — on S01

```
Running · Paused · Finished · Finished with failures · Failed entirely
```

---

## Screens we deliberately don't have

| Not built | Why | What covers it instead |
|---|---|---|
| **Sign in / sign up** | A workspace exists from your first visit | — |
| **Validation** | Checking is automatic and happens during processing. Nobody runs it by hand | **S08 Review**, which is where its output lands |
| **Describe your table** | The system proposes columns by reading your files first | **S03 Columns** |
| **A marketing landing page** | The product is the landing page | **S01 Workspace** |
| **Confirm dialogs on ordinary actions** | Only things that cost money or throw work away deserve one | — |
| **A separate batch list** | The workspace is the list | **S01 Workspace** |
