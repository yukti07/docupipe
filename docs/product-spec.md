# Product Specification

## 1. Product

**Name:** Quarry

**One-line description:** Turn a pile of look-alike documents into a spreadsheet you can actually
trust — where every value can show you exactly where it came from.

---

## 2. Problem

You have a folder of documents that all look roughly the same. Invoices. Reports. Receipts.
Emails. Call recordings. Spreadsheets from five different suppliers.

You need them as a table — so you can total a column, sort by date, or answer one question about
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

One person, with somewhere between 20 and 500 documents that share a shape, who cannot write
code.

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

> *"Give me these 200 documents as a table I can open in Excel — and when I don't believe a
> number, let me check it in two seconds."*

Both halves matter. The table on its own is the easy part, and plenty of tools already do it.
The second half is the product.

---

## 5. Core Workflow

**1. You upload.**
One file, several files, or a whole folder. Everything in one batch should be the same kind of
document.

**2. The system works out the columns for you.**
You don't fill in a form describing what you want. Quarry reads your documents first and
proposes a set of columns based on what is actually in them. For spreadsheets, CSVs and JSON it
reads the column headings. For documents, images and recordings it reads the content.

**3. You adjust the columns.**
Rename them, delete the ones you don't care about, add one it missed, or explain a tricky one in
your own words — "the total including tax, not the subtotal". This step is optional. You can
accept what it proposes and move on.

**4. It processes, and tells you the truth while it works.**
A live status, not a spinner: how many are done, how many are waiting, how many need a look, how
many failed. If it has to pause, it says why and when it will start again.

**5. You get the table when the batch is finished.**
"Finished" means genuinely finished, or paused, or everything left has failed. You see the
results in one go, not a half-filled table appearing row by row.

**6. You check the parts worth checking.**
Most cells are fine. A few are marked. Click any cell — any cell, not only the marked ones — and
Quarry shows you the exact place the value came from: the page with the spot highlighted, the
moment in the recording, or the row in the spreadsheet. If a value genuinely wasn't in the
document, the cell says **"not found"** rather than leaving you a blank or a zero to
misinterpret.

**7. You fix what needs fixing.**
Marked cells come to you one at a time with the evidence beside them. Accept, correct, or skip.
Keyboard only. Reviewing eight marked cells out of 200 documents should take about two minutes.

**8. You export.**
CSV or Excel. The export tells you what's in it, including how many rows failed and how many you
haven't reviewed.

---

## 6. Core Features

### Upload
Drop one file, many files, or a folder. Supported: text, CSV, Excel, JSON, PDF, scanned PDF,
Word, images and audio recordings. Files that can't be used are rejected straight away, with the
reason, before you have waited for anything.

### Automatic column detection
Quarry proposes the table's columns by reading your documents. You never start from a blank form.

When several files use different names for the same thing — `Customer Name`, `client`, `Cust_Nm`
— it merges them into one column and shows you which files used which name, so you can confirm
the merge or split it apart.

Where it tells you how sure it is, it uses plain counts — *"this appeared in 47 of 50 files"* —
never an invented percentage.

### Processing
An honest live view. One line per document showing where it has got to. Partial failure is
normal and is shown as such: 182 good rows out of 200 is a useful result, not an error.

### The table
One row per document, or one row per line item where that makes sense. Sort, filter, search.
Cells worth checking are marked. Cells that genuinely had nothing to find say "not found".

### Evidence
The heart of the product. Click a cell and see where the value came from.

| Source | What you see |
|---|---|
| PDF, scan or image | The page, with the exact spot boxed |
| Audio | The recording, cued to the moment, with the words |
| Word or text | The paragraph, with the phrase highlighted |
| Spreadsheet, CSV or JSON | The sheet, row and column |

If a file format simply cannot report *where* something was, Quarry says so and shows you the
text instead. It never draws a highlight it isn't sure about.

### Review
Marked cells, one at a time, keyboard-driven, evidence beside each one. Every mark comes with a
reason in plain English — "the line items add up to 4,180 but the total says 4,200", or "I
couldn't find this value in the text I was reading".

### Honest failure messages
Every way a document can fail has a real message and a real next step. Never "something went
wrong". Instead: *"This PDF is password protected. Remove the password and upload it again."* Or:
*"This file is named .pdf but isn't one — it's actually a ZIP archive."*

If the daily processing limit is reached, that is shown as a **pause with a time**, not a
failure: *"Daily limit reached. Picking up again at 14:32."* Everything already done is kept.

### A live view of the machine
A screen showing documents moving through the stages of processing as it happens. Genuinely
useful when something is slow, and it makes visible the work that otherwise happens silently.

### Export
CSV or Excel, with an honest summary of what you are taking away.

---

## 7. Future Features

Real possibilities, deliberately not now.

- **Charts on your own data** — group a column and see a bar or line chart without leaving for Excel
- **A try-it demo** — a prepared batch you can open on purpose to see how the tool works, rather
  than dummy data sitting in your workspace uninvited
- **More formats** — older Word files, OpenDocument, saved email files, and the long tail
- **Video** — pull the audio out and treat it like a recording
- **Saved column sets** — keep a set of columns and reuse it on next month's batch
- **Re-run a batch** against changed columns, when you choose to
- **A second opinion** — put doubtful values past a different model and mark the disagreements
- **Ask in plain English** — "which of these had a sample size over 500?" — on top of a table that
  already works
- **Accounts and sharing**, so a team can work on the same batch

---

## 8. Non-goals

Things we are explicitly not building, so that scope has something to bounce off.

- **Accounts, logins and passwords.** You get a workspace the moment you arrive. No sign-up.
- **Chat with your documents.** This is not a question-answering assistant. It produces a table.
- **Industry expertise.** Quarry knows nothing special about pharma, law or accounting. It
  structures what is in front of it.
- **Fixing your documents.** It reads them. It never edits or re-saves the originals.
- **Perfect table reconstruction.** Complicated tables spanning pages, merged cells and rotated
  scans are a field of their own. Quarry does well on ordinary documents and is honest when it
  can't.
- **A search engine.** You can search inside your results. It won't go and find documents for you.
- **Scraping websites or portals.** Getting hold of the documents is your job. Structuring them
  is ours.
- **Dashboards, scheduled reports and alerts.** A chart on data you can't verify is decoration on
  a liability. Trust comes first.
- **Video**, for now.
- **A public API.** Quarry is a product you use, not yet a service you plug into.
