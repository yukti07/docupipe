import { Check, Lock } from "lucide-react"
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

/** Convert is a milestone rather than a destination, so it is not in here. */
export type BatchScreen = "files" | "schemas" | "results"

/** Which side of the gate the batch is on, and whether it is still crossing. */
export type BatchPhase = "prepare" | "converting" | "converted"

type StepId = BatchScreen | "convert"
type StepState = "done" | "current" | "upcoming" | "locked"

export type BatchNavProps = {
  requestId: string
  /** The screen being looked at. The rail follows the route, not the progress. */
  current: BatchScreen
  done: { files: boolean; schemas: boolean }
  phase: BatchPhase
  /** A screen underneath Results — "Merge", or a filename. */
  tail?: ReactNode
}

/**
 * Where you are in one batch, as four steps around the one gate in the product.
 *
 * Stateless by design: the two halves of a batch read from different sources —
 * `useBatch` before the gate, `useResultPolling` after — so each screen works
 * out its own props rather than this reaching for both.
 *
 * The lit step is the screen you are on, not the furthest one you have reached.
 * Uploading every file does not move the rail to Schemas; pressing Review
 * schemas does. Otherwise the rail would announce a screen change that had not
 * happened, and pressing Drop more files would appear to walk it backwards.
 */
export function BatchNav({ requestId, current, done, phase, tail }: BatchNavProps) {
  // Four labelled steps plus the rules between them do not fit beside a tail
  // below `lg`. The labels give way to it, since the tail is the most specific
  // thing on its screen — they stay in the accessibility tree, so nothing is
  // lost to anyone reading the bar aloud.
  const labelClass = tail ? "sr-only lg:not-sr-only" : undefined
  const converting = phase === "converting"
  // Convert is the gate, and a gate is only worth naming while it is still
  // ahead of you or being crossed. Once the batch has results it is a padlock
  // between two steps that says nothing the Results step does not.
  const steps = phase === "converted" ? STEPS.filter((s) => s.id !== "convert") : STEPS

  return (
    <nav aria-label="Batch" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1">
        {steps.map(({ id, path }, index) => {
          const state = stateOf(id, { current, done, phase })
          // A table and the merge screen both live *inside* Results, so the
          // step stays lit while you are on one — and stays a link, because it
          // is the way back up out of it. Everywhere else, the lit step is
          // where you already are and linking it would go nowhere.
          const here = state === "current" && !(id === "results" && tail)
          // Convert has no screen at all, and nothing past the gate has one
          // until the gate is crossed.
          const href = !here && path ? path(requestId, phase) : null
          const label = labelOf(id, phase)

          return (
            <li
              key={id}
              data-step={id}
              data-state={state}
              aria-current={here ? "step" : undefined}
              className="contents"
            >
              {/* The two rules either side of Convert carry the wait: while the
                  batch is converting they are marching dashes, which is the
                  whole of the animation the rail does. */}
              {index > 0 && (
                <Connector
                  lit={state !== "upcoming"}
                  // The two rules touching Convert — the one it is reached by
                  // and the one it leads to — and no others.
                  marching={converting && index >= 2}
                />
              )}
              {href ? (
                <Link href={href} className={cn(CHIP[state], "hover:text-foreground", LINK_FOCUS)}>
                  <Marker id={id} state={state} />
                  <span className={labelClass}>{label}</span>
                </Link>
              ) : (
                <span className={CHIP[state]}>
                  <Marker id={id} state={state} />
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
            {/* The thing actually open, given the same chip as the steps — it
                is the most specific place in the bar, and reading as loose text
                beside four chips made it look like a caption on them. */}
            <span className="min-w-0 truncate rounded-full bg-muted px-2.5 py-1 text-[13px] font-medium text-foreground">
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
  { id: "convert", path: null },
  // Only a batch that has been converted has results to go back to.
  { id: "results", path: (id, phase) => (phase === "prepare" ? null : `/request/${id}`) },
]

const BASE =
  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] transition-colors"

const CHIP: Record<StepState, string> = {
  done: `${BASE} bg-muted text-subtle-foreground`,
  current: `${BASE} bg-primary-tint font-medium text-foreground`,
  upcoming: `${BASE} text-muted-foreground`,
  locked: `${BASE} text-muted-foreground`,
}

const LINK_FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"

/** Convert is the only step whose name changes, and it names the gate's state. */
function labelOf(id: StepId, phase: BatchPhase): string {
  if (id !== "convert") return id === "files" ? "Files" : id === "schemas" ? "Schemas" : "Results"
  return phase === "prepare" ? "Convert" : phase === "converting" ? "Converting" : "Converted"
}

function stateOf(
  id: StepId,
  { current, done, phase }: Omit<BatchNavProps, "requestId">,
): StepState {
  // Convert is never somewhere you are and never somewhere you can go. It is
  // locked on both sides of itself, which is what the padlock says.
  if (id === "convert") return "locked"
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
 * Steps tick when they are behind you. Results never does: whether the batch
 * has finished is the status sentence's job, and a tick here would be a second,
 * quieter copy of it.
 */
function Marker({ id, state }: { id: StepId; state: StepState }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-[18px] shrink-0 place-items-center rounded-full",
        state === "current" && "bg-primary",
        state === "done" && id !== "results" && "bg-primary-tint-strong text-primary",
        state === "done" && id === "results" && "border border-border-subtle",
        state === "upcoming" && "border border-border-subtle",
        state === "locked" && "bg-muted text-muted-foreground",
      )}
    >
      {id === "convert" ? (
        <Lock className="size-2.5" strokeWidth={2.2} />
      ) : state === "current" ? (
        <span className="size-1.5 rounded-full bg-primary-foreground" />
      ) : state === "done" && id !== "results" ? (
        <Check className="size-3" strokeWidth={2.4} />
      ) : null}
    </span>
  )
}

function Connector({ lit, marching }: { lit: boolean; marching: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "hidden h-px w-8 shrink-0 lg:block",
        marching
          ? "rail-dashes"
          : lit
            ? "bg-primary-tint-strong"
            : "bg-border-faint",
      )}
    />
  )
}
