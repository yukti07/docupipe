import { Check } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import type { WorkspacePhase } from "@/state/workspace"

/** The workspace tracks five phases; the rail only cares which side of the gate. */
export function railPhase(phase: WorkspacePhase | undefined): BatchPhase {
  if (!phase || phase === "prepare") return "prepare"
  if (phase === "done" || phase === "failed") return "converted"
  return "converting"
}

/** Three screens, and nothing in the rail that is not one of them. */
export type BatchScreen = "files" | "schemas" | "results"

/** Which side of the gate the batch is on, and whether it is still crossing. */
export type BatchPhase = "prepare" | "converting" | "converted"

type StepId = BatchScreen
type StepState = "done" | "current" | "upcoming"

export type BatchNavProps = {
  requestId: string
  /** The screen being looked at. The rail follows the route, not the progress. */
  current: BatchScreen
  done: { files: boolean; schemas: boolean }
  phase: BatchPhase
  /**
   * Shapes are still coming back, on a screen that asked for them. It is not
   * read off the batch: the marker is the answer to pressing Review Schemas,
   * and a rail that showed it on Files would be narrating a screen nobody
   * opened.
   */
  detecting?: boolean
  /** A screen underneath Results — "Merge", or a filename. */
  tail?: ReactNode
}

/**
 * Where you are in one batch, as three steps and the waits between them.
 *
 * Stateless by design: the two halves of a batch read from different sources —
 * `useBatch` before the gate, `useResultPolling` after — so each screen works
 * out its own props rather than this reaching for both.
 *
 * The lit step is the screen you are on, not the furthest one you have reached.
 * Uploading every file does not move the rail to Schemas; pressing Review
 * schemas does. Otherwise the rail would announce a screen change that had not
 * happened, and pressing Drop more files would appear to walk it backwards.
 *
 * Between the steps sit the two waits — detecting, converting — and each is
 * there only while it is actually happening. They are not steps: there is no
 * screen behind either of them, nothing ticks them, and the moment the work
 * they name is finished they leave the rail rather than settling into it as a
 * milestone with a padlock on it.
 */
export function BatchNav({ requestId, current, done, phase, detecting, tail }: BatchNavProps) {
  // Three labelled steps plus the rules between them do not fit beside a tail
  // below `lg`. The labels give way to it, since the tail is the most specific
  // thing on its screen — they stay in the accessibility tree, so nothing is
  // lost to anyone reading the bar aloud.
  const labelClass = tail ? "sr-only lg:not-sr-only" : undefined
  // The gate is being crossed right now. Named between Schemas and Results for
  // exactly as long as that is true.
  const converting = phase === "converting"

  return (
    <nav aria-label="Batch" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1">
        {STEPS.map(({ id, path }, index) => {
          const state = stateOf(id, { current, done, phase })
          // A table and the merge screen both live *inside* Results, so the
          // step stays lit while you are on one — and stays a link, because it
          // is the way back up out of it. Everywhere else, the lit step is
          // where you already are and linking it would go nowhere.
          const here = state === "current" && !(id === "results" && tail)
          // Nothing past the gate has a screen until the gate is crossed.
          const href = !here && path ? path(requestId, phase) : null
          const label = LABELS[id]
          const ticked = isTicked(id, state, phase)
          // The wait that leads *into* this step, in place of the plain rule.
          const marker = id === "schemas" ? detecting : id === "results" ? converting : false

          return (
            <li
              key={id}
              data-step={id}
              data-state={state}
              aria-current={here ? "step" : undefined}
              className="contents"
            >
              {index > 0 &&
                (marker ? (
                  <Marker label={id === "schemas" ? "detecting" : "converting"} />
                ) : (
                  <Connector lit={state !== "upcoming"} />
                ))}
              {href ? (
                <Link href={href} className={cn(CHIP[state], "hover:text-foreground", LINK_FOCUS)}>
                  <Dot state={state} ticked={ticked} />
                  <span className={labelClass}>{label}</span>
                </Link>
              ) : (
                <span className={CHIP[state]}>
                  <Dot state={state} ticked={ticked} />
                  <span className={labelClass}>{label}</span>
                </span>
              )}
            </li>
          )
        })}

        {tail && (
          <li data-step="tail" aria-current="step" className="flex min-w-0 items-center gap-1">
            <span aria-hidden className="px-0.5 text-border">
              /
            </span>
            {/* The thing actually open. Plain text rather than a chip of its
                own: it is a name, not a state, and given the same pill as the
                steps it read as a fourth step in the rail. */}
            <span className="min-w-0 truncate px-0.5 text-[13px] text-subtle-foreground">
              {tail}
            </span>
          </li>
        )}
      </ol>
    </nav>
  )
}

const STEPS: { id: StepId; path: ((id: string, phase: BatchPhase) => string | null) | null }[] = [
  {
    id: "files",
    // Past the gate the batch screen shows its results, so reaching the files
    // again has to ask for them by name. They come back read-only.
    path: (id, phase) => (phase === "prepare" ? `/request/${id}` : `/request/${id}?view=files`),
  },
  { id: "schemas", path: (id) => `/request/${id}/schemas` },
  // Only a batch that has been converted has results to go back to.
  { id: "results", path: (id, phase) => (phase === "prepare" ? null : `/request/${id}`) },
]

const LABELS: Record<StepId, string> = {
  files: "Files",
  schemas: "Schemas",
  results: "Results",
}

const BASE =
  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] transition-colors"

const CHIP: Record<StepState, string> = {
  done: `${BASE} bg-muted text-subtle-foreground`,
  current: `${BASE} bg-primary-tint font-medium text-foreground`,
  upcoming: `${BASE} text-muted-foreground`,
}

const LINK_FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"

function stateOf(
  id: StepId,
  { current, done, phase }: Pick<BatchNavProps, "current" | "done" | "phase">,
): StepState {
  // A tail means the screen is underneath Results rather than Results itself.
  // The step still reads as where you are — you are inside it — and the tail
  // beside it says which part of it.
  if (id === current) return "current"
  if (id === "results") return phase === "prepare" ? "upcoming" : "done"
  // Converting settles both of the steps before it, whatever the counts this
  // browser happens to hold: the server has the files and has read them.
  if (phase !== "prepare") return "done"
  return done[id] ? "done" : "upcoming"
}

/**
 * Steps tick when they are behind you and there is something behind you to
 * tick. Results is the one step that can read "done" before it is: it is the
 * step you are heading for from the moment Convert is pressed, and a tick
 * while the batch is still converting would claim results that have not
 * arrived. So it ticks on `converted` alone — and then it does tick, because
 * standing on Schemas with a finished batch next door, an empty circle on
 * Results says the opposite of what is true.
 */
function Dot({ state, ticked }: { state: StepState; ticked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-[18px] shrink-0 place-items-center rounded-full",
        state === "current" && "bg-primary",
        ticked && "bg-primary-tint-strong text-primary",
        !ticked && state !== "current" && "border border-border-subtle",
      )}
    >
      {state === "current" ? (
        <span className="size-1.5 rounded-full bg-primary-foreground" />
      ) : ticked ? (
        <Check className="size-3" strokeWidth={2.4} />
      ) : null}
    </span>
  )
}

/** A step is ticked once it is behind you — Results, only once it has landed. */
const isTicked = (id: StepId, state: StepState, phase: BatchPhase) =>
  state === "done" && (id !== "results" || phase === "converted")

/**
 * A wait, between two steps. Lower case and in the mono face, so it reads as a
 * machine saying what it is doing rather than as a fourth place to go.
 */
function Marker({ label }: { label: string }) {
  return (
    <span data-marker={label} className="flex shrink-0 items-center gap-2 px-1">
      <Rule />
      <span className="font-mono text-[12.5px] lowercase tracking-[-0.01em] text-muted-foreground">
        {label}
      </span>
      <Rule />
    </span>
  )
}

const Rule = () => (
  <span aria-hidden className="rail-crawl hidden h-[2px] w-9 shrink-0 rounded-full sm:block" />
)

function Connector({ lit }: { lit: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "hidden h-px w-8 shrink-0 lg:block",
        lit ? "bg-primary-tint-strong" : "bg-border-faint",
      )}
    />
  )
}
