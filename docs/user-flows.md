# User Flows

How people move through Quarry, screen by screen and decision by decision.

Plain-language companion to [`product-spec.md`](product-spec.md) and
[`feature-priorities.md`](feature-priorities.md). Steps marked **(P1)** are the second wave — the
flow works without them.

---

## 1. The spine

The whole product in seven steps.

```
Landing
   ↓
Upload
   ↓
Columns            ← the system proposes them; you adjust
   ↓
Processing
   ↓
Results
   ↓
Review / Edit
   ↓
Export
```

**One note on "Validate".** It isn't a step the user takes. Checking happens automatically during
processing — the arithmetic, whether a value can actually be found in the text it was read from,
whether a date is plausible. The user never runs it. They only meet its *output*: the handful of
cells marked "worth a look", which is what the Review step is for.

---

## 2. Screens

| Screen | Exists to |
|---|---|
| **Landing** | Get you uploading in one action |
| **Upload** | Take files and reject the impossible immediately |
| **Columns** | Show the proposed table shape and let you correct it |
| **Processing** | Tell the truth while you wait |
| **Machine view (P1)** | Show the work happening, for when something is slow |
| **Results** | The table, plus the evidence panel beside it |
| **Review (P1)** | Marked cells, one at a time, keyboard only |
| **Export** | Leave with an honest summary |

There is no sign-in screen, and no screen where you describe what you want before the system has
read anything.

---

## 3. Arrival

```
Landing
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

## 4. Upload

```
Upload
 ├── Drag & drop — one file, several files, or a whole folder
 ├── Browse files — full keyboard alternative, not an afterthought
 └── Files land in a list
       ↓
  Pre-flight check — instant, before anything is sent
       ├── Empty file            → rejected, reason shown
       ├── Too large             → rejected, reason + the actual limit
       ├── Format we can't read  → rejected, reason + what to do instead
       └── Looks fine
             ↓
       Uploading
        ├── One row per file, each with its own progress and its own state
        ├── A file fails  → Retry just that file
        │                   (the twenty-eight that worked are untouched)
        └── All done
              ↓
        Reading the documents
```

**Rules this screen follows:**

- The supported formats and the size limit are written **inside** the drop zone, before you've
  tried anything.
- One bad file never blocks the good ones. Rejections are per file, and the batch continues.
- A file never appears to upload successfully and then quietly vanish later.
- Everything drag-and-drop does, the keyboard can also do.

Formats accepted: text, CSV, Excel, JSON, PDF, scanned PDF, Word, images, audio.

---

## 5. Columns

The step that replaces "fill in a form describing what you want".

```
Reading the documents
      ↓
Proposed columns
 ├── Each column, with where it came from
 ├── How common it was — "found in 47 of 50 files"
 ├── Merged columns marked as merged
 │     e.g. Customer Name · client · Cust_Nm  →  one column
 └── Everything editable
       ├── Rename it
       ├── Delete it
       ├── Add one it missed
       ├── Describe it in your own words
       │     "the total including tax, not the subtotal"
       └── Split a merge back apart (P1)
             ↓
        Start processing
```

**How the proposal is made** depends on the files, though the user doesn't need to care:
spreadsheets, CSVs and JSON have column headings to read directly. Documents, images and
recordings have their content read instead.

**How sure it is** is always expressed as a count — *"found in 47 of 50 files"* — never as a
percentage the system made up about itself. A count is something you can check. A percentage is
something you have to take on faith.

**Skipping this screen is fine.** Accept the proposal and move on. It exists so nothing happens
silently, not to make you do work.

---

## 6. Processing

```
Processing
 ├── One honest sentence at the top:
 │     "127 of 200 done · 61 waiting · 8 to check · 4 failed"
 ├── One row per document, showing the step it has reached
 ├── Starting from cold → "waking up", so a normal pause never reads as a stall
 └── The machine view, if you want to watch it work (P1)
       ↓
  The batch reaches its end — which happens three ways:
       ├── Everything finished            → Results
       ├── Paused on the daily limit      → Results + "picking up again at 14:32"
       └── Everything left over failed    → Results + a summary of what failed
```

**The table does not appear until the batch reaches its end.** No half-filled grid building itself
row by row. You watch progress, then you get a result.

**"Paused" is not "failed".** Hitting the daily processing limit is routine, nobody's fault, and
nothing is lost — so it shows as a pause with a time, in neutral colours, and everything already
finished is right there waiting. An app that shows a red error every day teaches people to ignore
red errors.

---

## 7. Results

```
Results
 ├── The table
 │    ├── A value                 — checked, nothing to flag
 │    ├── "not found"             — we looked; it genuinely isn't in this document
 │    ├── Marked                  — we have a value but a check failed
 │    └── A missing row           — that document failed; the reason is one click away
 ├── Sort · filter · search
 ├── "8 cells worth a look"       → Review
 ├── Click any cell               → Evidence
 └── Export
```

**Why "not found" and not a blank or a zero.** If an invoice has no discount line and we write
`0`, we've made a claim — that the discount *was* zero. Blank says we don't know. Those are
different facts, and one of them is false. It stops mattering in the abstract the moment someone
totals the column.

---

## 8. Evidence

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

---

## 9. Review

Only the marked cells. Keyboard-driven. The goal is that eight marked cells out of two hundred
documents take about two minutes — because if reviewing costs as much as reading the documents
yourself, the tool did nothing.

```
Review — 8 to check
      ↓
One cell at a time
 ├── The value, large
 ├── Why it's marked, in plain words:
 │     "The line items add up to 4,180 but the total says 4,200"
 │     "I couldn't find this value in the text I was reading"
 │     "This date is in 1823"
 └── The evidence, already open at the right place — no hunting
      ↓
 Your options
 ├── Accept it                                    A
 ├── Type a correction                            type → Enter
 ├── Take the value off the page instead          draw a box on the document
 ├── Skip for now                                 S
 └── Back to the table                            Esc
      ↓
 Moves to the next one on its own
      ↓
 Nothing left → back to Results
```

**Drawing a box instead of retyping** is worth calling out. When the value is wrong but the right
one is visible on the page, it's faster and less error-prone to draw around it than to read it and
type it. We can do this because we already know where everything is on the page.

**Corrected cells stay visibly corrected** in the table afterwards. What a person changed is not
silently blended into what the machine produced.

---

## 10. Export

```
Export
 ├── CSV
 └── Excel
      ↓
 An honest summary before you download:
   "182 rows · 4 documents failed · 3 cells you haven't checked yet"
      ↓
 Download
```

The count is on the button, not buried. You should never find out what was missing after you've
sent the file to someone else.

---

## 11. Where failures show up

Every failure appears in exactly one place, with a real sentence and a real next step. Nothing
reaches the user as "something went wrong".

| What happened | Where you meet it | What you can do |
|---|---|---|
| Empty file, or far too large | Upload, instantly | Remove it; the rest carry on |
| Named `.pdf` but isn't one | Upload or Processing | "It's actually a ZIP archive" |
| PDF is password protected | Processing | "Remove the password and upload it again" |
| Format we don't handle | Upload | "Save it as .docx and try again" — with the supported list |
| Upload dropped halfway | Upload | Retry that one file |
| A photo with no readable text | Processing | "No text found in this one" |
| Document far too long | Processing | "Processed the first 200 pages. Split the file to do the rest" |
| A value genuinely isn't there | Results, in the cell | Cell reads "not found" |
| A check failed | Results, marked cell | Review it |
| Daily limit reached | Processing, as a **pause** | Nothing — it resumes itself at the stated time |
| Your processing cap reached | Processing, as a **pause** | Raise the cap, or take the rows you have |
| A retry that worked | **Nowhere** | Nothing — you should never hear about this |

That last row matters as much as the others. Problems the system solves by itself stay invisible;
telling someone about a hiccup you already fixed is noise dressed up as transparency.

---

## 12. What a cell can be

Every cell in the table is in exactly one of these states, and they look different from each other
at a glance.

```
Value          normal text          checked, nothing flagged
"not found"    grey, italic         we looked; it isn't in this document
Marked         amber marker         we have a value but a check failed
Corrected      marked as edited     a person changed this
(missing row)  greyed               the document itself failed
```

---

## 13. Coming back

```
Return visit
 ├── Your batches are still here — no login, same workspace
 ├── A paused batch shows where it got to and when it resumes
 ├── A finished batch opens straight to its table
 └── Start a new one
```

---

## 14. Keyboard

The review loop is keyboard-first by design. Everything else is keyboard-*possible* by obligation.

| Key | Does |
|---|---|
| `A` | Accept the marked value |
| `Enter` | Save a correction and move on |
| `S` | Skip this one |
| `Esc` | Leave review, back to the table |
| `↑ ↓` | Move between rows in the table |
| `Tab` | Move through everything, in a sensible order, with visible focus |

---

## 15. Things deliberately left out of the flow

- **A sign-in step.** You arrive and you're working.
- **A "describe your table" form** before anything has been read. The system proposes first.
- **A half-filled table** updating as documents finish. Progress, then a result.
- **"Are you sure?" dialogs** on ordinary actions. The things worth confirming are the ones that
  cost money or throw work away, and those are rare here.
- **A percentage next to each value.** Evidence and a plain reason, or nothing. A number the
  system invented about its own confidence invites exactly the trust it hasn't earned.
