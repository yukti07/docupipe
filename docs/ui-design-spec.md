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
| **Data / mono** | Geist Mono | Numbers, file names, field names, type names, stage names |

Both are already installed in the project.

### The one non-obvious rule

**Every number in a table uses tabular figures.**

```css
font-variant-numeric: tabular-nums;
```

Proportional digits make columns of numbers ragged and genuinely harder to scan for errors — which
is the whole job here. This applies to the tables, the status sentence, and the counts on the
Convert and Download buttons.

### Scale

| Use | Size | Weight | Line height |
|---|---|---|---|
| Page title | 24px | 600 | 1.2 |
| Section heading | 18px | 600 | 1.3 |
| Body | 14px | 400 | 1.5 |
| Table cell | 13px | 400 | 1.4 |
| Schema field name | 13px | 500 | 1.4 |
| Secondary / caption | 12px | 400 | 1.4 |
| The reviewed value (S11, P2) | 28px | 500 | 1.2 |

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
| File row | 56px — it carries a progress bar, a state and a button |
| Schema field row | 44px |
| Panel padding | 24px |
| Page gutter | 24px desktop · 16px mobile |

**Density is a user setting on the tables.** Comfortable by default; compact for someone scanning
500 rows. It's two row heights and a font size, and it's the difference between usable and not at
scale.

---

## Layout

### Two screens are split views, and they use the same pattern

**S02 Upload & Schema**

```
┌────────────────────────────────────────────────────────┐
│  Header — batch name · "12 of 50 shapes ready"         │
├────────────────────────────────────────────────────────┤
│                              │                         │
│   Drop zone                  │   Schema editor         │
│   + file rows                │   (slides in on         │
│   (fills the space)          │    Preview / Edit)      │
│                              │                         │
├────────────────────────────────────────────────────────┤
│  Footer — [Review schemas]            [Convert · 50]   │
└────────────────────────────────────────────────────────┘
```

**S04 Processing → S06 File result**

```
┌────────────────────────────────────────────────────────┐
│  Header — batch name · the honest status sentence      │
├────────────────────────────────────────────────────────┤
│                              │                         │
│   File rows, or one          │   Evidence              │
│   file's table               │   (slides in on         │
│   (fills the space)          │    cell click)          │
│                              │                         │
├────────────────────────────────────────────────────────┤
│  Footer — row count · density · [Download all] [Merge] │
└────────────────────────────────────────────────────────┘
```

**The two side panels behave identically**, and that's on purpose — once you've learned that
clicking a thing on the left opens detail on the right without losing your place, you've learned it
for the whole product.

- **Full width.** No max-width container on either. This is a data tool; horizontal space is the
  resource.
- **Panels are side panels, not modals.** You must be able to see the list and the detail at the
  same time — a modal that covers the file list breaks the thing the screen is for.
- **Panel is ~40% of width, resizable, minimum 380px.**
- **Below 1024px** the panel becomes a sheet over the list, since side-by-side stops being legible.

### Page structure elsewhere

Workspace and the **Review schemas** all-files view are centred at **max 1100px** — the latter is a
grid of schema cards and needs more room than a single form, but shouldn't sprawl. The Merge picker
and the Download dialog are centred at **max 880px**. Insights is full-bleed.

---

## Components

Built on shadcn/ui. Listed below are the decisions that differ from the defaults, plus the
product-specific pieces that don't exist in any library.

### Standard

**Button** — default 36px, radius 8px. Four variants: primary (one per screen, at most), secondary,
ghost, destructive. Destructive is spent only on actual destruction. Loading state keeps the label
and swaps the icon, so the button never changes width mid-click.

**A disabled button always says what would enable it** — in its own label where that fits
(*"Convert · 12 files still reading"*), in a tooltip plus adjacent text where it doesn't. Tooltip
alone is never sufficient, because it's invisible on touch. This is a hard rule: the product has
four gated controls (Preview / Edit, Review schemas, Convert, Merge) and a dead button with no
explanation is the fastest way to make a considered product feel broken.

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
the fraction; a labelled indeterminate state where we don't (*"Reading this file"*, *"Waking up"*).
A spinner with no words is a refusal to say what's happening.

**Modal** — for destructive confirmation, Download all and the Merge picker only. Never for
evidence, never for the schema editor, never for anything you need to see the list behind.

**Toast** — transient confirmations only ("Schema saved to 12 files"). **Never used for errors**,
because errors need to persist until they're dealt with and a toast disappears. Bottom-right, 4s,
dismissible.

**Tabs** — Processing / Machine view, and the tables within a multi-table file. Underline style, not
pills — pills read as filters here.

**Dropdown** — Radix. Full keyboard, type-ahead, 6px radius, 4px item spacing.

**Tooltip** — supplementary only. Nothing essential lives in a tooltip; it's invisible on touch and
to most assistive tech. 300ms delay.

### Product-specific

**Cell** — four states now, a fifth at P2, each visually distinct without relying on colour alone:

```
Value        normal, tabular numerals
"not found"  italic, muted, no colour
Marked       amber left edge + marker glyph, reason inline
Failed row   greyed, whole row, with the reason one click away
Corrected    small "edited" marker, primary-tinted     — P2, with the review queue
```

**File row** — the component that carries the most weight in the product, because it appears on two
screens with different jobs.

```
S02   name · size · progress bar · state · retry · [Preview / Edit]
S04   name · stage · state · [View] · [Download]
```

Same visual rhythm, same height, different trailing controls. Building this as one component with
two trailing slots is correct; building it twice is how the two screens drift apart.

**Schema editor** — the panel, and the all-files view, are the same component at two widths.

```
Header      file name · which table, when a file held several
Fields      name (read-only, mono) · type (editable)
Footer      [Add field]  ·  [Apply to all · 12 files]  ·  [Save]
```

Field names render **mono and visibly non-editable** — no input chrome, no hover affordance. The
type control is the only interactive thing on a field row, and it should look it. Showing a greyed
rename control would be worse than showing nothing: an affordance that never works reads as a bug.

**Schema field row** — name, type control, and an "added by you" marker on fields the user created.
A field the user added is the one row on the screen that *didn't* come from the document, and it
should say so.

**Apply-to-all control** — a button that carries its own count (*"Apply to all · 12 files"*),
shown only when other files originally matched. Pressing it reveals the affected file names before
committing; it never applies straight from the button. The count is the whole value of the feature,
so it lives in the label rather than in a tooltip.

**Status sentence** — the single line in the header. Mono numerals, plain prose, updating live.
*"127 of 200 done · 61 waiting · 8 to check · 4 failed."* It must read true in every state, including
paused and total failure. On S02 it counts shapes instead: *"12 of 50 shapes ready."*

**Evidence panel** — header naming the source file and location, the rendered source, the highlight.
Slides in over 200ms; the highlight draws over 400ms after it lands. Read-only.

**Merge picker** — schema groups as cards, each carrying its shape and a count (*"31 tables · Invoice
No, Date, Total"*), selectable in one click per group or individually. An incompatible selection
puts the error **on the offending card**, not only in a summary at the bottom — the user needs to
see which one is the problem, not just that there is one.

**Insight card** (P1) — a chart, one sentence, and a link through to the rows behind it. The link is
mandatory: a card that can't cite its rows is not rendered, which is a rule enforced in the
component rather than in a prompt.

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
| Panel slide-in (schema and evidence) | 200ms | ease-out |
| **Evidence highlight drawing itself** | 400ms | ease-out |
| A file row gaining its View / Download buttons | 150ms | ease-out |
| Rows re-sorting as files finish | 250ms | ease-in-out |
| Toast in / out | 150ms | ease-out |

**The highlight draw is the one animation that matters.** It's the moment a user learns, without
being told, that the cell and the document are connected. It earns its 400ms; nothing else in the
product would.

The file row gaining its buttons is the second-most-load-bearing bit of motion, and it's cheap: it's
how the user learns that finished files become usable *immediately* rather than at the end.

All motion respects `prefers-reduced-motion` — under which the highlight appears immediately rather
than drawing, and nothing else moves at all.

---

## Interaction Principles

1. **Prefer inline editing.** Change a field's type where it sits. No modal, no separate edit mode,
   no round trip to a form.

2. **Show system progress clearly.** Never a bare spinner. Always say what is happening and, where
   we can, how much is left. "Waking up" beats a silent 20 seconds.

3. **Every disabled control explains itself.** Four controls in this product are gated. Each says
   what would open it, in text, not only in a tooltip.

4. **Don't hide validation errors.** Errors appear next to what caused them, stay until resolved,
   and never live in a toast. A merge error names the field.

5. **Preserve user input.** A failed save never clears the schema editor. A dropped connection never
   loses an edit. If we can't save something yet, we say so and keep it.

6. **Use animation to communicate state changes.** Rows gaining buttons as files finish. The
   highlight drawing itself. Both carry information; neither is decoration.

7. **Colour means one thing.** Amber is *check this*. Red is *this failed*. Blue-grey is *paused*.
   They are never borrowed for emphasis.

8. **Evidence is always one click away.** From any cell, marked or not. The moment it's buried
   behind a menu, the product's claim stops being credible.

9. **Say the true thing, even when it's unflattering.** "4 failed" on screen beats a clean interface
   that quietly dropped four documents.

10. **Never show an affordance that doesn't work.** No greyed rename on a schema field, no disabled
    edit control after Convert. If an action isn't available here, it isn't drawn here.

11. **The keyboard can do everything.** Everywhere is keyboard-complete, with visible focus and a
    sensible order. The review queue at P2 will be keyboard-first.

12. **Nothing appears in the user's workspace that they didn't put there.**

---

## Accessibility

- Text contrast **4.5:1** minimum; interactive borders and icons **3:1**.
- Colour is never the only carrier of state.
- Every interactive element is reachable and operable by keyboard, with a visible focus ring.
- **A disabled control's reason is in the accessible name**, not only in a tooltip — otherwise the
  gating logic is invisible to screen readers, which is where it matters most.
- Live regions announce status changes — a shape becoming ready, a file finishing, a batch pausing —
  without stealing focus.
- The side panels are focus traps while open, and `Esc` closes them.
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
| Disabled controls with no reason | The product is mostly gates; an unexplained one reads as broken |
| Greyed-out rename and delete on a schema field | An affordance that never works is worse than none |
| Celebration on success | Success is the expected case, not an achievement |
| A progress screen with nothing to do on it | Finished files are usable immediately — that's the point |
| Dense borders everywhere | Space separates better than lines at this data density |
| Toast for errors | It vanishes; errors must not |
