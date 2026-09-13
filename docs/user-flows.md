# User Flows

How people move through Quarry, screen by screen and decision by decision.

Plain-language companion to [`product-spec.md`](product-spec.md) and
[`feature-priorities.md`](feature-priorities.md). Steps marked **(P1)** or **(P2)** are later waves —
the flow works without them.

---

## 1. The spine

The whole product in six steps.

```
Workspace
   ↓
Upload & Schema     ← files upload; each file's shape is read back and shown; you correct it
   ↓
Convert             ← the one gate in the product
   ↓
Processing          ← each file's table appears the moment that file is done
   ↓
Merge               ← optional; combine tables that share a shape
   ↓
Insights (P1)       ← charts and findings across everything
```

**Two things about this shape are worth saying out loud.**

First, **the schema belongs to the file, not to the batch.** Each file is read on its own and gets
its own proposed table shape. A file containing three tables gets three. Nothing is averaged across
the batch behind your back, and nothing is merged unless you ask for it.

Second, **Convert is the only place you wait behind a gate.** Before it, you are looking at shapes
and correcting them. After it, results arrive one file at a time and you can open each one as it
lands — you are never held at a loading screen until the last file finishes.

**One note on "Validate".** It isn't a step you take. Checking happens automatically during
processing — the arithmetic, whether a value can actually be found in the text it was read from,
whether a date is plausible. You never run it. You only meet its output: the handful of cells marked
*worth a look*, which show with a plain reason in the table.

---

## 2. Screens

| Screen | Exists to |
|---|---|
| **Workspace** | Get you uploading in one action |
| **Upload & Schema** | Take files in, show you the shape read out of each, let you correct it |
| **Schema editor** | One file's proposed table, editable — as a panel, or all files at once |
| **Processing** | Tell the truth while you wait, and hand back each file as it finishes |
| **Machine view (P1)** | Show the work happening, for when something is slow |
| **File result** | One file's table, with the evidence panel beside it |
| **Download** | Leave with an honest summary |
| **Merge** | Combine tables that share a shape, into one |
| **Insights (P1)** | Charts and written findings across the whole batch |
| **Review queue (P2)** | Marked cells one at a time, keyboard only |

There is no sign-in screen, and no screen where you describe what you want before anything has been
read.

---

## 3. Arrival

```
Workspace
 ├── Upload area — the main thing on the page
 ├── "See how it works" → a prepared batch, opened on purpose (P1)
 └── Your recent batches
       ├── First visit  → nothing here, and the page doesn't pretend otherwise
       └── Coming back  → pick one up where you left it
```

A workspace exists the moment you arrive. No account, no email, no password.

Nothing is pre-loaded into your workspace. If you want to see the tool working before committing
your own files, you open the demo deliberately — you are never handed data you didn't upload.

---

## 4. Upload & Schema

This is the biggest screen in the product, because two things happen on it at once: files go up,
and each one's shape comes back.

```
Drop files  ·  Browse files  ·  Drop a folder
      ↓
Pre-flight check — instant, before anything is sent
 ├── Empty file            → rejected, reason shown
 ├── Too large             → rejected, reason + the actual limit
 ├── Format we can't read  → rejected, reason + what to do instead
 └── Looks fine
       ↓
  Uploading — one row per file, each with its own progress bar
       ├── A file fails  → Retry just that file
       │                   (the twenty-eight that worked are untouched)
       └── That file is up
             ↓
       Reading its shape — the row now shows a disabled "Preview / Edit"
             ↓
       ├── Shape ready   → the button enables
       ├── Nothing found → the button stays off, with a reason on the row
       └── Couldn't read → the row says so; the rest of the batch is untouched
```

**The file row is the whole screen.** It carries the filename, the size, its own progress bar, its
own state, its own retry, and its own **Preview / Edit** button. That button is present from the
moment the file appears and **disabled until that file's shape comes back** — so you can see it
coming rather than wondering whether anything is going to happen.

### The two buttons at the bottom

| Button | Enabled when | Does |
|---|---|---|
| **Review schemas** | **Any one** file's shape is ready | Opens every available shape at once, in one view |
| **Convert** | **Every** file has uploaded *and* settled its shape | Starts the actual work |

"Settled" means ready or failed. A file whose shape couldn't be read doesn't hold the batch hostage
— it is carried through as a failure with a reason, and the rest convert normally.

**Rules this screen follows:**

- The supported formats and the size limit are written **inside** the drop zone, before you've
  tried anything.
- One bad file never blocks the good ones. Rejections are per file, and the batch continues.
- A file never appears to upload successfully and then quietly vanish later.
- Everything drag-and-drop does, the keyboard can also do.
- Nothing is converted until you press Convert. Reading a file's shape costs you nothing and
  commits you to nothing.

Formats accepted: text, CSV, Excel, JSON, PDF, scanned PDF, Word, images, audio.

---

## 5. The schema editor

Opened two ways — from one file's **Preview / Edit** button, or from **Review schemas** for
everything at once. Same editor either way; the second just shows more of them.

```
A file's proposed shape
 ├── One table → one schema
 └── Several tables in one file → one schema each, edited separately
       ↓
Each schema is a list of fields
 ├── Field name
 └── Field type — text · number · date · currency · yes/no · list
       ↓
Two things you can change, and only two
 ├── Change a field's type
 └── Add a field it missed
       ↓
Save
```

### Why only two edits

The shape on screen is **what is actually in your file**, not a wish list. Renaming a field would
make the table disagree with the document it came from, and deleting one would throw away something
the file genuinely contains — both of which break the promise that every value can be traced back.

So the two edits that remain are the two that don't lie about the source: **correcting a type we
read wrong** (an invoice number read as a number when it should be text), and **adding a field we
missed** (something in the document the read-back didn't catch).

If a field is there and you don't want it, you leave it out at download time. That's a question
about your output, not about what the document says.

### Apply to all

The reason you don't have to fix the same thing forty times.

```
You edit one schema
      ↓
"Apply to all" — offered when other files share this shape
      ↓
Which files does it touch?
 └── Every file whose ORIGINAL read-back matched this one exactly
     (the same field names and the same types, in any order)
      ↓
The list is shown before you confirm — you can see exactly what changes
      ↓
Save → the edit and the list of files it applies to both go to the server
```

**Matching is on the original**, not on the current state. If you edited file 3 an hour ago and are
now editing file 7, "apply to all" from file 7 reaches the files that looked like *file 7 originally
did* — not the ones you have since changed. This keeps the rule explainable in one sentence, which
is the only kind of rule people can predict.

---

## 6. Convert

One button, one gate.

```
Convert
  ↓
Everything you've set is locked in
  ↓
Processing begins
```

After this point **schemas are not editable.** The work has started and rows are being written
against the shape you approved; letting it change underneath would mean half your table was produced
under one set of rules and half under another.

---

## 7. Processing

```
Processing
 ├── One honest sentence at the top:
 │     "127 of 200 done · 61 waiting · 8 to check · 4 failed"
 ├── One row per file, showing the step it has reached
 ├── Starting from cold → "waking up", so a normal pause never reads as a stall
 └── The machine view, if you want to watch it work (P1)
       ↓
  A file finishes
       ↓
  That file's row gets two things it didn't have:
   ├── View — open its table now, without waiting for the rest
   └── Download — take just this one
```

**Results arrive per file, and you can open them immediately.** Document 4 is readable while
document 40 is still transcribing. There is no moment where the batch goes quiet and then hands you
everything at once.

**"Paused" is not "failed".** Hitting the daily processing limit is routine, nobody's fault, and
nothing is lost — so it shows as a pause with a time, in neutral colours, and every file already
finished is right there, open and downloadable. An app that shows a red error every day teaches
people to ignore red errors.

**No edits here.** Not to schemas, and not to values. What you can do is look, and take things away.

### When everything is done

Two more buttons appear alongside the downloads:

| Button | Does |
|---|---|
| **Merge** | Combine tables that share a shape into one |
| **Insights (P1)** | Charts and findings across the whole batch |

---

## 8. A file's table

```
File result
 ├── The table
 │    ├── A value                 — checked, nothing to flag
 │    ├── "not found"             — we looked; it genuinely isn't in this document
 │    ├── Marked                  — we have a value but a check failed, with the reason
 │    └── A missing row           — that part failed; the reason is one click away
 ├── Sort · filter · search
 ├── Click any cell               → Evidence
 └── Download this file
```

Marked cells show their reason in plain words right there. **Correcting them is P2** — for now you
can see what to doubt and check it against the source, which is the part that can't be done any
other way.

**Why "not found" and not a blank or a zero.** If an invoice has no discount line and we write `0`,
we've made a claim — that the discount *was* zero. Blank says we don't know. Those are different
facts, and one of them is false. It stops mattering in the abstract the moment someone totals the
column.

---

## 9. Evidence

Available on every cell, not just the marked ones. This is the part of the product that earns
trust, so it can't be a feature you have to go looking for.

```
Click any cell
      ↓
Evidence opens beside the table
 ├── PDF · scan · image        → the page, with the exact spot boxed
 ├── Audio                     → the recording, cued to the moment, with the words
 ├── Word · text               → the paragraph, phrase highlighted
 ├── Spreadsheet · CSV · JSON  → the sheet, row and column
 └── Position not reportable   → say so plainly, and show the source text
                                 (never draw a box we aren't sure about)
      ↓
 The highlight draws itself as the panel opens —
 which is how someone learns, without being told,
 that the cell and the document are connected.
```

The panel is **read-only**. It shows you where a value came from; it doesn't let you change it.

---

## 10. Download

Two ways out, and they are deliberately different weights.

```
Download this file          Download all
      ↓                           ↓
 One click, straight away    An honest summary first:
                              "182 rows across 47 files ·
                               4 files failed ·
                               3 cells worth a look"
                                  ↓
                             CSV or Excel
                                  ↓
                             Download
```

Per-file download is a single click because you have the file's table open in front of you and
already know what's in it. **Download all** is the one that leaves the building, so it says what
it contains before you send it to anyone. You should never find out what was missing afterwards.

---

## 11. Merge

Available once every file has finished. This is where separate tables become one, and it only ever
happens because you asked.

```
Merge
      ↓
Pick the tables you want combined
 ├── Tables that share a shape are grouped together, so the easy case is one click
 └── You can pick freely, including across groups
      ↓
Check
 ├── All picked tables have the same field names and types  → merge runs
 └── They don't                                             → an error naming the mismatch:
                                                               which table, which field,
                                                               and what it disagrees on
      ↓
One table, with a column saying which file each row came from
      ↓
Sort · filter · search · evidence · download — all of it, same as any other table
```

**The check is strict on purpose.** Same field names, same types, order doesn't matter. A looser
rule would let a number column and a text column quietly become one, and every total calculated
from the result would be wrong in a way nobody could see. Being told "these two can't merge, here's
why" is cheaper than finding that out later.

Evidence survives the merge. A merged row still knows which file and which spot each of its values
came from.

---

## 12. Insights — P1

The last button, and the only one that looks across files rather than inside one.

```
Insights
      ↓
An LLM reads the structured data — not the documents — and looks for
relationships between fields across the batch
      ↓
What comes back
 ├── Charts        — the relationship drawn
 └── Findings      — one plain sentence each, with the rows it came from
      ↓
Every finding is clickable through to the rows behind it
```

**Why this is bounded.** A finding that can't point at its rows doesn't get shown. That single rule
is what keeps this from becoming an open-ended box of assertions — the same rule that governs every
value in the table applies to every claim made about it.

Runs on merged tables where you've merged, and across all tables where you haven't.

---

## 13. Where failures show up

Every failure appears in exactly one place, with a real sentence and a real next step. Nothing
reaches the user as "something went wrong".

| What happened | Where you meet it | What you can do |
|---|---|---|
| Empty file, or far too large | Upload, instantly | Remove it; the rest carry on |
| Named `.pdf` but isn't one | Upload or Processing | "It's actually a ZIP archive" |
| PDF is password protected | Upload, when reading its shape | "Remove the password and upload it again" |
| Format we don't handle | Upload | "Save it as .docx and try again" — with the supported list |
| Upload dropped halfway | Upload | Retry that one file |
| Couldn't read a shape out of a file | Upload, on that file's row | Convert anyway — it's carried as a failure — or remove it |
| No table found in the file | Upload, on that file's row | Add fields manually, or remove it |
| A photo with no readable text | Processing | "No text found in this one" |
| Document far too long | Processing | "Processed the first 200 pages. Split the file to do the rest" |
| A value genuinely isn't there | The table, in the cell | Cell reads "not found" |
| A check failed | The table, marked cell | Look at the evidence beside it |
| Tables that can't merge | Merge, before it runs | The error names the field and the disagreement |
| Daily limit reached | Processing, as a **pause** | Nothing — it resumes itself at the stated time |
| Your processing cap reached | Processing, as a **pause** | Raise the cap, or take the files you have |
| A retry that worked | **Nowhere** | Nothing — you should never hear about this |

That last row matters as much as the others. Problems the system solves by itself stay invisible;
telling someone about a hiccup you already fixed is noise dressed up as transparency.

---

## 14. What a cell can be

Every cell in every table is in exactly one of these states, and they look different from each other
at a glance.

```
Value          normal text          checked, nothing flagged
"not found"    grey, italic         we looked; it isn't in this document
Marked         amber marker         we have a value but a check failed
(missing row)  greyed               that part of the document failed
```

A fifth state, **Corrected**, arrives with the review queue at P2. Until then nothing in a table has
been touched by a person, so nothing needs to say so.

---

## 15. Coming back

```
Return visit
 ├── Your batches are still here — no login, same workspace
 ├── A batch still on Upload & Schema keeps your schema edits
 ├── A paused batch shows where it got to and when it resumes
 ├── A finished batch opens to its file list, every table still there
 └── Start a new one
```

---

## 16. Keyboard

Everything is keyboard-*possible* by obligation. The review queue, when it arrives at P2, will be
keyboard-*first* by design.

| Key | Does |
|---|---|
| `Tab` | Move through everything, in a sensible order, with visible focus |
| `↑ ↓` | Move between rows in a table, and between fields in the schema editor |
| `Enter` | Open the focused file's schema, or save the field you're editing |
| `Esc` | Close the schema editor or the evidence panel |

---

## 17. Things deliberately left out of the flow

- **A sign-in step.** You arrive and you're working.
- **A "describe your table" form** before anything has been read. The system reads first.
- **Renaming or deleting fields.** The shape describes the document; changing its names would make
  the table disagree with its own source.
- **Automatic merging.** Files are separate until you say otherwise, and the merge check is strict.
- **Editing anything after Convert.** Half a table produced under old rules is worse than a table
  you have to re-run.
- **"Are you sure?" dialogs** on ordinary actions. The things worth confirming are the ones that
  cost money or throw work away, and those are rare here.
- **A percentage next to each value.** Evidence and a plain reason, or nothing. A number the
  system invented about its own confidence invites exactly the trust it hasn't earned.
