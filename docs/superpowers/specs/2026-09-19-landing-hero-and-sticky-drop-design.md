# Landing hero, bigger drop card, sticky drop strip

Status: built
Date: 2026-09-19
Scope: `packages/web/src/app/page.tsx`, `packages/web/src/app/globals.css`,
`packages/web/src/lib/useFileIntake.tsx` (new), `packages/web/src/lib/intro.ts` (new),
`packages/web/src/components/quarry/IntroHero.tsx` (new),
`packages/web/src/components/quarry/DropStrip.tsx` (new),
`packages/web/src/components/quarry/DropZone.tsx`

Reference: `Quarry Landing.html`, a single-file mockup supplied by the user.

## 1 · Why

The landing screen is where someone decides whether Quarry is worth a document. It currently opens
on a modest bordered box that says "Drop your documents here" and a list of batches. Nothing on it
says what comes out the other end.

The mockup answers that in the first eight seconds: files drift in from the left, pass through the
Quarry mark, and land as typed rows in a table. That is the whole product in one loop, shown rather
than described. Three changes carry it:

- **An intro that demonstrates the transformation** instead of naming it.
- **A drop card big enough to be the page**, not a box sitting on it.
- **A sticky strip** so the drop target survives scrolling into the batch history.

## 2 · Goals

- The intro plays on a first visit, is skippable, and never blocks a returning user.
- Every drop surface on the page is a real drop target, sharing one implementation.
- All motion is CSS keyframes, so the existing `prefers-reduced-motion` block disables it wholesale.
- The header is untouched: no pages-today meter, no workspace link. Those were removed deliberately
  and the mockup's copies of them are not adopted.

Non-goals: a marketing page, any content below the batch history, dark-mode treatment of the new
surfaces (the canvas is light-only, per `globals.css`).

## 3 · `src/lib/useFileIntake.tsx`

The drag/pick/hand-off logic is currently welded into `DropZone`. Two surfaces now need it, so it
moves to a hook and neither surface owns it.

```tsx
type Intake = {
  /** "idle" | "dragging" | "dragging-invalid" — drives the surface's own styling. */
  drag: DragState
  /** Disabled, or shut after taking a selection. Nothing here takes input. */
  inert: boolean
  /** Why it is inert, for the surface to show and for aria-label. */
  inertReason: string | null
  handing: boolean
  /** True only after a *drop* that held no files. A cancelled picker says nothing. */
  emptyDrop: boolean
  /** Spread onto the drop surface: onDragOver, onDragLeave, onDrop, data-state. */
  zoneProps: IntakeZoneProps
  openFiles: () => void
  openFolder: () => void
  /** The two hidden inputs. Rendered by the surface so the keyboard path exists. */
  inputs: ReactNode
}

function useFileIntake(args: { onFiles: (files: File[]) => void; disabledReason?: string | null }): Intake
```

The behaviour is carried over unchanged, including the two subtleties that already earn comments in
`DropZone`: the handing lock is set *before* the async folder walk, because that walk is its own
window for a second drop; and a picker already open can answer after the zone has shut, so `inert`
is re-checked in `onChange` rather than trusted from the `disabled` attribute alone.

Two surfaces mean two sets of hidden inputs in the document. They are `sr-only` and separately
labelled ("Choose files" appears twice) — acceptable, because only one surface is reachable at a
time: the strip is `pointer-events:none` and `aria-hidden` while retracted.

## 4 · `src/lib/intro.ts`

```ts
const KEY = "quarry.introSeen"
export function hasSeenIntro(): boolean
export function markIntroSeen(): void
```

Both guard against a throwing `localStorage` (private mode, blocked site data) and treat a failed
read as "seen" — an intro that cannot record itself must not replay on every load.

The page reads it through `useSyncExternalStore` with a subscribe that never emits, and a server
snapshot of `true`. Storage is an external system whose value cannot change under us during a visit;
reading it in an effect and calling `setState` would render the intro and tear it straight back
down, and is what `react-hooks/set-state-in-effect` exists to stop.

## 5 · `IntroHero.tsx`

A fixed overlay inset below the 58px header, above the page, with a soft accent gradient. Click
anywhere dismisses; an 8s timer dismisses it otherwise; both call `onDone`.

Layout, left to right in a 1080px row:

| Column | Width | Contents |
| --- | --- | --- |
| Sources | 300px | Four absolutely-placed file cards, drifting right and shrinking on staggered infinite loops |
| Beam | 90px | The Quarry mark over a vertical gradient rule that pulses |
| Output | fills | A table whose header and four rows animate in on a stagger, closing on a summary row |

The four cards are `SCAN-0091.PDF` (lines), `CALL-NOTES.M4A` (a waveform), `RECEIPT.JPG` (lines with
one accent line), `Q3-SHEET.XLSX` (a grid) — four shapes, so the point reads as *anything in*. Each
drifts on its own path (`qdrift1`–`qdrift4`), 4.6s, offset by 0.8s.

The table fills over the same span: header at 0, rows at 1.2s/2.1s/3.0s/3.9s, then a tinted footer
at 4.8s reading `4 rows · 4 typed fields · ready to query`. Content matches the mockup's invoices.

The heading is `Anything in. Tables out.` over `Invoices, scans, recordings, spreadsheets — read,
typed, filled.` A `Click anywhere to skip` line sits under the animation.

Narrow windows: the sources column and the beam are hidden below `md`, and the table sheds `supplier`
then `net`, down to `invoice_no` and `total` on a phone. A four-column grid at 375px would clip the
one column that carries the point.

Accessibility: the overlay is `role="dialog"` labelled by the heading, takes focus on mount, and
dismisses on Escape as well as click — a full-screen thing that swallows clicks has to be closable
from the keyboard. The animation itself is `aria-hidden`; the heading carries the meaning.

## 6 · `DropZone.tsx` grows into the hero card

Same component, same props, same states — scaled to the mockup:

| | Now | After |
| --- | --- | --- |
| Height | content, `py-12` | `min-h-[460px]` |
| Radius | `rounded-xl` | `rounded-[20px]` |
| Border | 1px solid | 1.5px dashed accent |
| Icon tile | 56px, bordered | 74px, white, shadowed |
| Heading | 14px medium | 32px semibold, `-0.03em` |
| Buttons | 36px | 46px, 12px radius |

The idle gradient it already carries stays; dragging, invalid-drag, handing and disabled keep their
current treatments at the new scale. A `Replay intro` chip sits top-right, shown only once the intro
has been dismissed, and calls back up to the page.

## 7 · `DropStrip.tsx`

58px, `position:sticky; top:0`, translucent white with `backdrop-filter: blur(8px)`, holding the
mark, `Drop your documents here`, the format line, and both buttons. It is a full drop target via
the same hook.

Shown / hidden by `translateY` and `opacity` on a 260ms transition, driven by an IntersectionObserver
on a sentinel `<div>` placed directly under the hero card. When the sentinel leaves the top of the
viewport the strip comes down. An observer, not a scroll listener, because this app scrolls the body
rather than the mockup's inner `overflow-y:auto` div, and a sentinel needs no threshold constant.

While retracted it is `pointer-events:none` and `aria-hidden`, so its buttons and hidden inputs are
out of the tab order and out of the accessibility tree.

Drag highlight matters more here than on the card: at 58px the strip is a small target, so
`dragging` gives it a solid accent tint and an accent border rather than the card's dashed outline.

## 8 · Keyframes, in `globals.css`

`qdrift1`–`qdrift4` (drift right, shrink, fade), `qrowin` (rise 10px and fade), `qbeam` (opacity
pulse), `qfade`, `qrise`. All under the existing `@media (prefers-reduced-motion: reduce)` block,
which already collapses every animation to 0.01ms — the intro then shows the finished table and
dismisses on its timer, which is the correct degradation.

## 9 · `page.tsx`

```
AppHeader
main
  IntroHero            — while the intro is playing (§4)
  DropStrip            — sticky, sibling before the card
  DropZone             — hero card, with the Replay chip
  <div ref={sentinel}/>
  previous-workspace note
  Batches section      — unchanged
```

`onFiles` is unchanged and passed to both surfaces.

## 10 · Tests

| File | Covers |
| --- | --- |
| `DropZone.test.tsx` | Drop, pick, folder walk, the handing lock, empty drop, inert gating — unchanged, and covering the hook through its real consumer rather than in isolation |
| `DropStrip.test.tsx` | Takes a drop; hidden and untabbable while retracted |
| `IntroHero.test.tsx` | Dismisses on click, on Escape, and on its timer |
| `app/page.test.tsx` | Intro on a first visit; no intro when `quarry.introSeen` is set; existing cases still pass |

The existing page tests find the drop zone by the text `Drop your documents here`, which the strip
now says too. Those queries move to the card's `data-testid="drop-card"` container.

The hook is deliberately *not* given a test file of its own. `DropZone.test.tsx` already exercises
every path through it against a real surface; a second suite around a bare hook would duplicate that
and leave the card's own composition untested.
