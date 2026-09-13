# Feature Priorities

Three tiers and an out-of-scope list. The rule for deciding: **P0 is anything that, if missing,
makes the product pointless or dishonest.** Speed and polish are never P0; being able to check
the answer always is.

---

## P0 — Must Have

Without these the product doesn't make sense.

### Getting data in

- **Upload one file, several files, or a folder.** One batch is one kind of document.
- **Accept text, CSV, Excel, JSON, PDF, scanned PDF, Word, images and audio.**
- **Reject the impossible immediately** — an empty file, something far too large — with the
  reason, before the user waits for anything.

### Working out the columns

- **Propose the columns automatically** by reading the documents. The user never faces a blank
  form.
- **Merge different names for the same thing** across spreadsheets and CSVs — `Customer Name`,
  `client`, `Cust_Nm` become one column.
- **Show how that decision was made**, using counts rather than invented percentages: *"found in
  47 of 50 files"*.
- **Let the user edit the proposal** — rename, delete, add, or describe a column in their own
  words.

### Processing

- **An honest live status.** How many done, waiting, flagged, failed — in one plain sentence, not
  a spinner.
- **Results appear when the batch reaches its end**, where "the end" means finished, paused, or
  everything remaining has failed. Not a table filling in row by row.
- **Nothing is lost to a partial failure.** 182 good rows out of 200 is presented as a result.

### The table

- **One row per document**, or per line item where that applies.
- **Sort and filter.**
- **"not found" instead of a blank or a zero** when a value genuinely isn't in the document. A
  fake zero corrupts every total calculated from that column.
- **Marked cells** where an automatic check failed, with the reason in plain English.

### Evidence — the reason this product exists

- **Click any cell and see where the value came from.** Not only marked cells. Any cell.
- **PDFs, scans and images show the page with the exact spot boxed.**
- **Spreadsheets, CSV and JSON show the sheet, row and column.**
- **Text and Word documents show the paragraph with the phrase highlighted.**
- **When a format can't report a position, say so** and show the source text. Never draw a
  highlight that might be in the wrong place.

### Honesty when things break

- **Every failure has a plain message and a next step.** "This PDF is password protected. Remove
  the password and upload it again." Never "something went wrong".
- **Hitting the daily processing limit shows as a pause with a time**, not a red error — because
  it happens routinely and isn't anybody's fault. Completed work stays available.
- **Problems the system fixes by itself stay invisible.** The user shouldn't hear about a retry
  that worked.

### Getting data out

- **Export to CSV and Excel**, with an honest count of what's included — how many rows failed,
  how many are unreviewed.

---

## P1 — Should Have

Real value. Build these as soon as P0 is solid, in roughly this order.

- **The keyboard review queue.** Marked cells one at a time, evidence beside each, accept /
  correct / skip without touching the mouse. *Build this first — it is the other half of the
  trust promise, and P0 only gets you as far as knowing which cells to doubt.*
- **A live view of the machine.** Documents moving through the stages of processing as it
  happens. Useful when something is slow, and it shows work that otherwise happens invisibly.
- **The column-merge review card.** Seeing which files used which name, and being able to confirm
  or split the merge. P0 does the merge; this makes it something the user can actually control.
- **Audio.** A recording is a second kind of document with its own way of showing evidence —
  playing the moment rather than highlighting a page.
- **Search across everything**, including the original text, for when the extraction missed
  something and the user wants to go and look.
- **Retry a single file** without re-uploading the whole batch.
- **A "waking up" state** for the few seconds when the system is starting from cold, so a normal
  pause never looks like a stall.
- **A try-it demo** — a prepared batch the user opens deliberately to see how it works. Not dummy
  data waiting in their workspace on first arrival.

---

## P2 — Nice to Have

Only once everything above genuinely works.

- **Charts on your own data** — group a column, get a bar or line chart.
- **Animation polish** beyond the one that earns its place (the highlight box drawing itself when
  the evidence panel opens — that one is P1 because it teaches the user what the product does).
- **Dark mode.**
- **Saved column sets**, reusable on next month's batch.
- **Re-running a batch** after the columns change, when the user asks for it.
- **Marking rows as out of date** when the columns have changed since they were produced.
- **A second opinion** — put doubtful values past a different model and mark disagreements.
- **Spotting odd values across documents** — one figure a thousand times the others is usually a
  misplaced decimal point.
- **Asking questions in plain English** on top of a table that already works properly.

---

## Explicitly Out of Scope

Not now, and saying so on purpose.

- **Accounts, logins, passwords, teams, permissions.** A workspace exists from the first visit.
- **Chat with your documents.** This product makes a table. It does not answer questions in prose.
- **Industry-specific knowledge** — no pharma, legal or accounting expertise built in.
- **Editing or re-saving the original documents.**
- **Perfect reconstruction of complicated tables** — spanning pages, merged cells, rotated scans.
- **Finding documents for you.** Search works inside your results, not out on the web.
- **Scraping websites or portals.**
- **Dashboards, scheduled reports and alerts.**
- **Video.**
- **A public API.**

---

## The one-line version

**The table is the commodity — every competitor has one. The evidence, the review loop and the
honest failure messages are the product.** When time runs short, cut from the table and never
from those three.
