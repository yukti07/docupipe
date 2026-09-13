# Product Specification

## 1. Product

**Name:** Quarry

**One-line description:** Turn a pile of documents into tables you can actually trust — where you
see the shape of each file before you commit, and every value can show you exactly where it came
from.

---

## 2. Problem

You have a folder of documents. Invoices. Reports. Receipts. Emails. Call recordings. Spreadsheets
from five different suppliers.

You need them as tables — so you can total a column, sort by date, or answer one question about
all of them at once.

Right now you have three bad options:

- **Read them all and type it up yourself.** Slow, boring, and you will make mistakes.
- **Pay someone to do it.** Expensive, and you still can't check their work.
- **Ask a developer to write a script.** You may not have a developer, and the documents may not
  be consistent enough for a script anyway.

There is a fourth option that looks great and is quietly the most dangerous: paste everything
into an AI tool and get a table in ten seconds. It's fast, it's usually right, and it gives you
**no way to tell the difference between the parts that are right and the parts that aren't.**

That's the real problem. It isn't that extracting data is hard. It's that **a wrong number you
can't spot is worse than no number at all.** People don't distrust these tools because they are
inaccurate. They distrust them because they are unverifiable.

Quarry is built around that one sentence.

---

## 3. Target User

One person, with somewhere between 20 and 500 documents, who cannot write code.

Below 20 documents you would just read them. Above 500 you would hire someone. In the middle is
where people are genuinely stuck.

Typical people:

- An **operations or finance analyst** with 200 supplier invoices
- A **researcher** with 80 papers, who needs one specific number out of each
- A **support lead** with 300 customer emails
- A **sales or CRM admin** with 150 call recordings
- Anyone who has been handed a folder and a deadline

What they have in common: they are accountable for the numbers. If the total is wrong, it is
their name on it. That is why "how do I check this?" matters to them more than "how fast is it?"

---

## 4. Core Use Case

> *"Give me these 200 documents as tables I can open in Excel — let me see what you found in each
> one before you start, and when I don't believe a number, let me check it in two seconds."*

All three halves matter. The table on its own is the easy part, and plenty of tools already do it.
Seeing the shape before committing, and checking a value after, are the product.

---

## 5. Core Workflow

**1. You upload.**
One file, several files, or a whole folder. They don't have to be the same kind of document.

**2. Each file tells you its shape.**
As soon as a file finishes uploading, Quarry reads it and works out what its table looks like —
what fields are in it and what type each one is. A **Preview / Edit** button sits on that file's
row from the start, greyed out, and lights up the moment its shape is ready. A file containing
three tables gives you three shapes.

You don't fill in a form describing what you want. You look at what is actually there.

**3. You correct the shapes.**
Two things you can change, and only two: **the type of a field**, and **adding a field it missed**.
You can't rename or delete, because the shape describes the document — renaming a field would make
your table disagree with its own source.

If forty files came back with the same shape, fix one and press **Apply to all**. It reaches every
file whose original shape matched exactly, and shows you the list before it commits.

There's also **Review schemas**, which opens every shape at once. It lights up as soon as the first
one is ready, so you can start looking while the rest are still arriving.

**4. You press Convert.**
The one gate in the product. It enables once every file has uploaded and settled its shape. From
here, schemas are locked — the work is running against what you approved.

**5. It processes, and hands files back as they finish.**
A live status, not a spinner: how many are done, waiting, flagged, failed. **Each file's table opens
the moment that file is done** — document 4 is readable while document 40 is still transcribing.
You can download any finished file on its own. If it has to pause, it says why and when it will
start again, and everything already finished stays right there.

Nothing is editable at this stage. You look, and you take things away.

**6. You check the parts worth checking.**
Most cells are fine. A few are marked amber with a plain reason. Click any cell — any cell, not
only the marked ones — and Quarry shows you the exact place the value came from: the page with the
spot highlighted, the moment in the recording, or the row in the spreadsheet. If a value genuinely
wasn't in the document, the cell says **"not found"** rather than leaving you a blank or a zero to
misinterpret.

**7. You merge, if you want to.**
Once everything is finished, **Merge** lets you combine tables into one. Tables that share a shape
are grouped for you, so the common case is a single click. Pick tables that don't agree and it
stops and tells you exactly which field disagrees and how — because a number column and a text
column quietly becoming one is how every total downstream goes silently wrong.

**8. You download.**
One file at a time in a single click, or **Download all** as CSV or Excel — which tells you what's
in it first, including how many files failed and how many cells are worth a look.

**9. You look for patterns.** *(P1)*
**Insights** reads the structured data — not the documents — and looks for relationships between
fields across the batch. It comes back as charts and short written findings, and every finding
points at the rows it came from. Anything it can't point at, it doesn't say.

---

## 6. Core Features

### Upload
Drop one file, many files, or a folder. Supported: text, CSV, Excel, JSON, PDF, scanned PDF,
Word, images and audio recordings. Files that can't be used are rejected straight away, with the
reason, before you have waited for anything. Every file has its own progress, its own state and
its own retry.

### Per-file schema detection
Quarry reads each file on its own and proposes that file's table shape. You never start from a
blank form, and nothing is averaged across your batch behind your back.

A file holding several tables produces several shapes, edited separately.

### The schema editor
Two operations, deliberately: **change a field's type**, and **add a field**. Open one file's shape
from its row, or all of them at once from **Review schemas**.

**Apply to all** propagates an edit to every file whose original shape matched exactly — same field
names, same types, order irrelevant — and lists the files it will touch before it does anything.

### Convert
One gate. Enabled when every file has uploaded and settled its shape. Schemas freeze at this point.

### Processing
An honest live view. One line per file showing where it has got to. **Finished files are usable
immediately** — open the table, or download just that file. Partial failure is normal and is shown
as such: 182 good rows out of 200 is a useful result, not an error state.

### The tables
One per file, or one per table found inside a file. Sort, filter, search. Cells worth checking are
marked with their reason inline. Cells that genuinely had nothing to find say "not found".

### Evidence
The heart of the product. Click a cell and see where the value came from.

| Source | What you see |
|---|---|
| PDF, scan or image | The page, with the exact spot boxed |
| Audio | The recording, cued to the moment, with the words |
| Word or text | The paragraph, with the phrase highlighted |
| Spreadsheet, CSV or JSON | The sheet, row and column |

If a file format simply cannot report *where* something was, Quarry says so and shows you the
text instead. It never draws a highlight it isn't sure about. The panel is read-only.

### Merge
Available once everything has finished, never automatic. Tables sharing a shape are grouped
together. The compatibility check is exact — same field names, same types — and a failed check
names the table, the field and the disagreement rather than refusing vaguely. Merged tables keep
their evidence and carry a source-file column.

### Download
Per file in one click. **Download all** to CSV or Excel, behind an honest summary of what you are
taking away.

### Insights *(P1)*
Charts and written findings across the whole batch, produced from the structured data rather than
the documents. Every finding cites the rows behind it, and a finding that can't cite its rows is
not shown — which is the rule that keeps this from becoming an open-ended box of assertions.

### Honest failure messages
Every way a document can fail has a real message and a real next step. Never "something went
wrong". Instead: *"This PDF is password protected. Remove the password and upload it again."* Or:
*"This file is named .pdf but isn't one — it's actually a ZIP archive."* Every disabled button says
what would enable it.

If the daily processing limit is reached, that is shown as a **pause with a time**, not a
failure: *"Daily limit reached. Picking up again at 14:32."* Everything already done is kept.

### A live view of the machine *(P1)*
A screen showing documents moving through the stages of processing as it happens. Genuinely
useful when something is slow, and it makes visible the work that otherwise happens silently.

---

## 7. Future Features

Real possibilities, deliberately not now.

- **The review queue** — marked cells one at a time, keyboard-driven, with the evidence beside each
  and the ability to correct a value by drawing a box on the source page rather than retyping it
- **"Chart this column"** on a single table, independently of Insights
- **A try-it demo** — a prepared batch you can open on purpose to see how the tool works, rather
  than dummy data sitting in your workspace uninvited
- **More formats** — older Word files, OpenDocument, saved email files, and the long tail
- **Video** — pull the audio out and treat it like a recording
- **Saved schemas** — keep a shape and reuse it on next month's batch
- **Re-run a batch** against a changed schema, when you choose to
- **A second opinion** — put doubtful values past a different model and mark the disagreements
- **Ask in plain English** — "which of these had a sample size over 500?" — on top of tables that
  already work
- **Accounts and sharing**, so a team can work on the same batch

---

## 8. Non-goals

Things we are explicitly not building, so that scope has something to bounce off.

- **Accounts, logins and passwords.** You get a workspace the moment you arrive. No sign-up.
- **Chat with your documents.** This is not a question-answering assistant. It produces tables, and
  at P1 findings that cite their rows.
- **Renaming or deleting inferred fields.** The shape describes the document. Editing its names
  would break the link between a value and where it came from, which is the whole product.
- **Automatic merging.** Files stay separate until you say otherwise, and the check is strict.
- **Editing after Convert.** Half a table produced under one set of rules and half under another is
  worse than a table you re-run.
- **Industry expertise.** Quarry knows nothing special about pharma, law or accounting. It
  structures what is in front of it.
- **Fixing your documents.** It reads them. It never edits or re-saves the originals.
- **Perfect table reconstruction.** Complicated tables spanning pages, merged cells and rotated
  scans are a field of their own. Quarry does well on ordinary documents and is honest when it
  can't.
- **A search engine.** You can search inside your results. It won't go and find documents for you.
- **Scraping websites or portals.** Getting hold of the documents is your job. Structuring them
  is ours.
- **Dashboards, scheduled reports and alerts.**
- **Video**, for now.
- **A public API.** Quarry is a product you use, not yet a service you plug into.
