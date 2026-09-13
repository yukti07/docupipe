# UI Design Specification

Layout, components, interactions and visual direction for Quarry.

Companion to [`screen-inventory.md`](screen-inventory.md) — that doc says *what* screens exist, this
one says what they look like and how they behave.

---

## Design Direction

### The personality

Quarry's promise is *"you can check this."* Every design decision follows from that.

That makes it an **instrument**, not a dashboard. Instruments are calm, precise and legible under
pressure. They don't celebrate, they don't decorate, and they don't hide anything from you. The
product's competitors all look like confident magic; Quarry should look like something that shows
its working.

Practically, that means:

| Feel | How it shows up |
|---|---|
| **Modern** | Generous whitespace around dense data. No skeuomorphism, no gradients-as-decoration |
| **Premium** | Restraint. One accent colour. Tight, deliberate typography. Nothing shouts |
| **Intelligent** | The interface explains its reasoning — counts, evidence, plain sentences — rather than asserting outcomes |
| **Clean** | Every pixel is either data or a way to act on data |
| **Data-focused** | Aligned numbers, scannable rows, comfortable at 500 rows |
| **Not corporate** | Warm neutrals rather than cold blue-grey. Human sentences, not system messages |

### The rule the whole system hangs on

> **Colour carries meaning. It is never decoration.**

This product has four cell states and a dozen failure classes that must be distinguishable at a
glance, across a table of 500 rows, by a tired person. Amber has to mean *check this* — reliably,
everywhere, without exception. The moment amber appears on a button because it looked nice, amber
stops meaning anything.

So the palette is deliberately small: **a warm neutral scale, one accent, and four status colours
that are spent only on their status.**

---

## Colour

Values are `oklch`, matching the shadcn token setup already in the project.

### Light

| Token | Value | Used for |
|---|---|---|
| **Primary** | `oklch(0.52 0.17 258)` | Interactive things, focus, links — **and the evidence highlight** |
| Primary foreground | `oklch(0.99 0 0)` | Text on primary |
| **Background** | `oklch(0.99 0.002 90)` | The page — a warm off-white, not pure white |
| **Surface** | `oklch(1 0 0)` | Cards, panels, the table — white, lifting off the page |
| **Border** | `oklch(0.91 0.004 85)` | Dividers, input outlines, table rules |
| Foreground | `oklch(0.21 0.01 80)` | Body text |
| Muted foreground | `oklch(0.52 0.01 80)` | Secondary text, and **"not found"** |
| **Success** | `oklch(0.62 0.14 155)` | Finished. Used sparingly — success is the default, not an event |
| **Warning / Review** | `oklch(0.70 0.15 75)` | **Reserved:** a cell worth checking. Nothing else |
| **Error** | `oklch(0.58 0.22 27)` | **Reserved:** something actually failed |
| **Paused** | `oklch(0.58 0.06 240)` | **Reserved:** waiting on a limit, resuming later |

### Dark

| Token | Value |
|---|---|
| Primary | `oklch(0.65 0.16 258)` |
| Background | `oklch(0.17 0.005 80)` |
| Surface | `oklch(0.21 0.006 80)` |
| Border | `oklch(1 0 0 / 10%)` |
| Foreground | `oklch(0.96 0.002 90)` |
| Muted foreground | `oklch(0.68 0.01 85)` |
| Success | `oklch(0.70 0.14 155)` |
| Warning / Review | `oklch(0.78 0.14 75)` |
| Error | `oklch(0.68 0.19 25)` |
| Paused | `oklch(0.68 0.05 240)` |

### Why "Paused" is its own colour

This is the most product-specific decision in the palette, and it's worth defending.

Running out of the daily processing limit is **routine, nobody's fault, and loses nothing.** If it
renders in amber it reads as a warning; in red it reads as a failure. Neither is true, and on a
free tier this happens most days — so the user would be trained to ignore whichever colour it
borrowed. A calm desaturated blue, distinct from every alert colour, is the honest signal.

Most design systems don't have this token because most products don't admit to this state.

### Colour is never the only signal

Anything distinguished by colour is also distinguished by shape, weight, icon or text. Amber cells
carry a marker glyph; "not found" is italic and muted; failed rows are greyed *and* labelled. This
is an accessibility requirement, and it's also just correct — the states have to survive a
screenshot pasted into an email.

### The evidence highlight

The signature interaction, and the one piece of colour that lands on content we don't control — a
white page, a grey scan, a dark photo.

```
Fill     primary at 12% alpha
Border   2px solid primary
Shadow   0 0 0 1px white/40% outside the border
```

The outer light ring is what keeps it visible on a dark scan. Never a solid overlay — the user has
to read what's underneath it.

---

## Typography

| Role | Face | Notes |
|---|---|---|
| **Headings** | Geist Sans | 600 weight, tight tracking (`-0.02em`) at large sizes |
| **Body / UI** | Geist Sans | 400, and 500 for anything interactive |
| **Data / mono** | Geist Mono | Numbers, file names, identifiers, stage names |

Both are already installed in the project.

### The one non-obvious rule

**Every number in a table uses tabular figures.**

```css
font-variant-numeric: tabular-nums;
```

Proportional digits make columns of numbers ragged and genuinely harder to scan for errors — which
is the whole job here. This applies to the table, the status sentence, and the counts on the export
button.

### Scale

| Use | Size | Weight | Line height |
|---|---|---|---|
| Page title | 24px | 600 | 1.2 |
| Section heading | 18px | 600 | 1.3 |
| Body | 14px | 400 | 1.5 |
| Table cell | 13px | 400 | 1.4 |
| Secondary / caption | 12px | 400 | 1.4 |
| The reviewed value (S08) | 28px | 500 | 1.2 |

14px body is deliberate. This is a tool people work in for an hour, not a page they read once.

---

## Spacing and shape

| Token | Value |
|---|---|
| **Base unit** | 4px — every gap is a multiple |
| Common rhythm | 8 · 12 · 16 · 24 · 32 · 48 |
| **Border radius** | 8px default · 6px small (inputs, badges) · 12px large (cards, panels) |
| **Button height** | 36px default · 32px compact · 44px on touch |
| Input height | 36px |
| Table row | 40px comfortable · 32px compact |
| Panel padding | 24px |
| Page gutter | 24px desktop · 16px mobile |

**Density is a user setting on the table.** Comfortable by default; compact for someone scanning
500 rows. It's two row heights and a font size, and it's the difference between usable and not at
scale.

---

## Layout

### The shape of the app

```
┌────────────────────────────────────────────────────────┐
│  Header — batch name · the honest status sentence      │
├────────────────────────────────────────────────────────┤
│                              │                         │
│   Table                      │   Evidence              │
│   (fills the space)          │   (slides in on click)  │
│                              │                         │
│                              │                         │
├────────────────────────────────────────────────────────┤
│  Footer — row count · density · Export                 │
└────────────────────────────────────────────────────────┘
```

- **Full width.** No max-width container. This is a data tool; horizontal space is the resource.
- **Evidence is a side panel, not a modal.** You must be able to see the cell and its source at the
  same time — a modal that covers the table breaks the one thing the product is for.
- **Panel is ~40% of width, resizable, minimum 380px.**
- **Below 1024px** the panel becomes a sheet over the table, since side-by-side stops being legible.

### Page structure elsewhere

Workspace, Upload and Columns are centred at **max 880px** — they're sequential, low-density and
shouldn't sprawl. Only Results and the Machine view go full-bleed.

---

## Components

Built on shadcn/ui. Listed below are the decisions that differ from the defaults, plus the
product-specific pieces that don't exist in any library.

### Standard

**Button** — default 36px, radius 8px. Four variants: primary (one per screen, at most), secondary,
ghost, destructive. Destructive is spent only on actual destruction. Loading state keeps the label
and swaps the icon, so the button never changes width mid-click.

**Input** — 36px, radius 6px, 1px border, focus ring in primary at 2px offset. Errors show *below*
the field and never replace the label. **The value is never cleared on a failed submit.**

**File uploader** — the drop zone states its limits inside itself, before you try: accepted formats,
size cap. Active drag state changes border and background together. Full keyboard path via a real
`<input type="file">`, not a div pretending.

**Data table** — TanStack Table. Sticky header, zebra off (rules, not stripes — stripes fight the
cell state colours), column resize, virtualized past 100 rows. Sort indicator always visible on the
active column, not on hover.

**Badge** — 20px tall, 6px radius, 11px medium text. Used for status only, never as a label
decoration.

**Progress indicator** — **there is no bare spinner in this product.** Determinate bar where we know
the fraction; a labelled indeterminate state where we don't (*"Reading your documents"*, *"Waking
up"*). A spinner with no words is a refusal to say what's happening.

**Modal** — for destructive confirmation and Export only. Never for evidence, never for anything you
need to see the table behind.

**Toast** — transient confirmations only ("Correction saved"). **Never used for errors**, because
errors need to persist until they're dealt with and a toast disappears. Bottom-right, 4s, dismissible.

**Tabs** — Results / Machine view. Underline style, not pills — pills read as filters here.

**Dropdown** — Radix. Full keyboard, type-ahead, 6px radius, 4px item spacing.

**Tooltip** — supplementary only. Nothing essential lives in a tooltip; it's invisible on touch and
to most assistive tech. 300ms delay.

### Product-specific

**Cell** — five states, each visually distinct without relying on colour alone:

```
Value        normal, tabular numerals
"not found"  italic, muted, no colour
Marked       amber left edge + marker glyph
Corrected    small "edited" marker, primary-tinted
Failed row   greyed, whole row, with the reason one click away
```

**Status sentence** — the single line in the header. Mono numerals, plain prose, updating live.
*"127 of 200 done · 61 waiting · 8 to check · 4 failed."* It must read true in every state, including
paused and total failure.

**Evidence panel** — header naming the source file and location, the rendered source, the highlight.
Slides in over 200ms; the highlight draws over 400ms after it lands.

**File row** — name, size, per-file progress, per-file state, per-file retry. This component carries
most of S02.

**Column proposal row** — the proposed name, the count (*"47 of 50 files"*), the contributing source
names when it's a merge, and inline edit.

**Provider chain strip** (P1) — three pills in sequence, the spent one greyed with its reset time,
the live one in primary.

**Stage column** (P1) — one column per processing stage, documents as small chips moving between
them.

---

## Motion

Motion is used to **teach**, never to entertain. If an animation doesn't explain something, it
shouldn't exist.

| What | Duration | Easing |
|---|---|---|
| Hover, focus, colour change | 120ms | ease-out |
| Panel slide-in | 200ms | ease-out |
| **Evidence highlight drawing itself** | 400ms | ease-out |
| Row re-sorting as documents finish | 250ms | ease-in-out |
| Toast in / out | 150ms | ease-out |

**The highlight draw is the one animation that matters.** It's the moment a user learns, without
being told, that the cell and the document are connected. It earns its 400ms; nothing else in the
product would.

All motion respects `prefers-reduced-motion` — under which the highlight appears immediately rather
than drawing, and nothing else moves at all.

---

## Interaction Principles

1. **Prefer inline editing.** Correct a value where it sits. No modal, no separate edit mode, no
   round trip to a form.

2. **Show system progress clearly.** Never a bare spinner. Always say what is happening and, where
   we can, how much is left. "Waking up" beats a silent 20 seconds.

3. **Don't hide validation errors.** Errors appear next to what caused them, stay until resolved,
   and never live in a toast.

4. **Preserve user input.** A failed submit never clears a field. A dropped connection never loses a
   correction. If we can't save something yet, we say so and keep it.

5. **Use animation to communicate state changes.** Rows re-sorting as work finishes. The highlight
   drawing itself. Both carry information; neither is decoration.

6. **Colour means one thing.** Amber is *check this*. Red is *this failed*. Blue-grey is *paused*.
   They are never borrowed for emphasis.

7. **Evidence is always one click away.** From any cell, marked or not. The moment it's buried
   behind a menu, the product's claim stops being credible.

8. **Say the true thing, even when it's unflattering.** "4 failed" on screen beats a clean interface
   that quietly dropped four documents.

9. **The keyboard can do everything.** Review is keyboard-*first*; everywhere else is
   keyboard-*complete*, with visible focus and a sensible order.

10. **Nothing appears in the user's workspace that they didn't put there.**

---

## Accessibility

- Text contrast **4.5:1** minimum; interactive borders and icons **3:1**.
- Colour is never the only carrier of state.
- Every interactive element is reachable and operable by keyboard, with a visible focus ring.
- Live regions announce status changes — documents finishing, a batch pausing — without stealing
  focus.
- The evidence panel is a focus trap while open, and `Esc` closes it.
- `prefers-reduced-motion` is honoured throughout.
- Touch targets 44px minimum on small screens.

---

## What this design system deliberately avoids

| Avoided | Because |
|---|---|
| A second accent colour | The status colours need the room to mean something |
| Gradients, glows, glass | Decoration on a product whose pitch is verifiability reads as a distraction |
| Illustration in empty states | A short true sentence does the job; a cartoon lowers the register |
| Spinners without words | They say "wait" without saying why — the opposite of this product |
| Celebration on success | Success is the expected case, not an achievement |
| Dense borders everywhere | Space separates better than lines at this data density |
| Toast for errors | It vanishes; errors must not |
