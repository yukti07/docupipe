# Feature Priorities

Three tiers and an out-of-scope list. The rule for deciding: **P0 is anything that, if missing,
makes the product pointless or dishonest.** Speed and polish are never P0; being able to check
the answer always is.

---

## P0 — Must Have

Without these the product doesn't make sense.

### Getting data in

- **Upload one file, several files, or a folder.** Files do not have to share a shape.
- **Accept text, CSV, Excel, JSON, PDF, scanned PDF, Word, images and audio.**
- **Reject the impossible immediately** — an empty file, something far too large — with the
  reason, before the user waits for anything.
- **Per-file progress**, per-file failure, per-file retry. One bad file never blocks the rest.

### Reading each file's shape

- **Infer a schema per file, automatically**, as soon as that file finishes uploading. The user
  never faces a blank form, and never describes a table before anything has been read.
- **A file holding several tables produces several schemas**, edited independently.
- **Preview and edit that schema before converting** — a per-file button, disabled until that
  file's schema is ready, enabled the moment it is.
- **Exactly two edit operations: change a field's type, and add a field.** Rename and delete are
  deliberately absent — the schema describes what is in the document, and renaming it would make
  the table disagree with its own source.
- **Review all schemas at once**, available as soon as any one schema is ready.
- **Apply to all** — propagate one edited schema onto every file whose *original* inferred schema
  matched it exactly, with the affected files listed before it commits.
- **Saving sends the edited schema and its apply-to-all scope together**, so the server never has
  to guess what an edit was meant to cover.

### Converting

- **One Convert button**, enabled only when every file has uploaded *and* settled its schema
  (ready or failed). A file whose schema couldn't be read is carried as a failure, not a blocker.
- **Nothing is converted until it is pressed.** Reading a shape costs nothing and commits to
  nothing.
- **Schemas are frozen after Convert.** A table half-produced under old rules is worse than one
  you re-run.

### Processing

- **An honest live status.** How many done, waiting, flagged, failed — in one plain sentence, not
  a spinner.
- **Each file's table is available the moment that file finishes.** Document 4 is readable while
  document 40 is still transcribing. No waiting for the batch to end.
- **Nothing is lost to a partial failure.** 182 good rows out of 200 is presented as a result.
- **No edits during processing** — not to schemas, not to values.

### The tables

- **One table per file** (or one per table found inside a file).
- **Sort, filter and search** within a table.
- **"not found" instead of a blank or a zero** when a value genuinely isn't in the document. A
  fake zero corrupts every total calculated from that column.
- **Marked cells** where an automatic check failed, with the reason in plain English shown inline.

### Evidence — the reason this product exists

- **Click any cell and see where the value came from.** Not only marked cells. Any cell.
- **PDFs, scans and images show the page with the exact spot boxed.**
- **Spreadsheets, CSV and JSON show the sheet, row and column.**
- **Text and Word documents show the paragraph with the phrase highlighted.**
- **When a format can't report a position, say so** and show the source text. Never draw a
  highlight that might be in the wrong place.
- The panel is **read-only** until the review queue lands at P2.

### Merging

- **A Merge action, available once every file has finished**, never automatic.
- **Tables sharing a shape are grouped in the picker**, so the common case is one click.
- **The check is exact** — same field names, same types, order-independent. No widening, no
  subsetting.
- **An incompatible selection is blocked with a real error** naming which table, which field, and
  what disagrees.
- **A merged table keeps its evidence**, and carries a column saying which file each row came from.

### Honesty when things break

- **Every failure has a plain message and a next step.** "This PDF is password protected. Remove
  the password and upload it again." Never "something went wrong".
- **Every disabled control says what would enable it.**
- **Hitting the daily processing limit shows as a pause with a time**, not a red error — because
  it happens routinely and isn't anybody's fault. Completed files stay open and downloadable.
- **Problems the system fixes by itself stay invisible.** The user shouldn't hear about a retry
  that worked.

### Getting data out

- **Download one file's table in a single click**, from its row or from the table itself.
- **Download all** to CSV or Excel, behind an honest summary — how many rows, how many files
  failed, how many cells are worth a look — shown **before** the download, never after.

---

## P1 — Should Have

Real value. Build these as soon as P0 is solid, in roughly this order.

- **Insights.** An LLM over the structured data — not the documents — finding relationships between
  fields across the batch, returned as charts plus written findings. *Every finding cites the rows
  behind it; a finding that can't point at its rows is not shown.* That rule is what keeps this
  bounded, and it is not optional.
- **A live view of the machine.** Documents moving through the stages of processing as it
  happens. Useful when something is slow, and it shows work that otherwise happens invisibly.
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

- **The keyboard review queue, and value corrections.** Marked cells one at a time, evidence beside
  each, accept / correct / skip without touching the mouse — plus correcting a value by drawing a
  box on the source page. *This was P1 in an earlier cut and was demoted deliberately: until it
  exists, marked cells still show their reason inline and the evidence panel still opens on any
  cell, so the user can always tell what to doubt. What they can't yet do is fix it in place.*
- **"Corrected" as a cell state**, arriving with the above — a person's edit never blends silently
  into machine output.
- **Charts on your own data** — group a column, get a bar or line chart, independently of Insights.
- **Animation polish** beyond the one that earns its place (the highlight box drawing itself when
  the evidence panel opens — that one is P0 because it teaches the user what the product does).
- **Dark mode.**
- **Saved schemas**, reusable on next month's batch.
- **Re-running a batch** after a schema changes, when the user asks for it.
- **Marking rows as out of date** when the schema has changed since they were produced.
- **A second opinion** — put doubtful values past a different model and mark disagreements.
- **Spotting odd values across documents** — one figure a thousand times the others is usually a
  misplaced decimal point.
- **Asking questions in plain English** on top of tables that already work properly.

---

## Explicitly Out of Scope

Not now, and saying so on purpose.

- **Accounts, logins, passwords, teams, permissions.** A workspace exists from the first visit.
- **Chat with your documents.** This product makes tables and, at P1, cited findings about them.
  It does not answer free-form questions in prose.
- **Renaming or deleting inferred fields.** The schema describes the document; editing its names
  would break the link between a value and its source.
- **Automatic merging.** Combining tables is always the user's explicit call.
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

**The tables are the commodity — every competitor has one. The evidence, the honest failure
messages, and the fact that you see each file's shape before committing to anything, are the
product.** When time runs short, cut from the tables and never from those three.
