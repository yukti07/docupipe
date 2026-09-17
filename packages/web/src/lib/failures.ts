import type { Failure, FailureClass } from "@/lib/api/types"

export type FailureTone = "error" | "review" | "paused"

export type FailureCopy = {
  message: string
  nextStep: string
  tone: FailureTone
  /** Settled-but-failed schema states never hold a good batch hostage. */
  blocksConvert: boolean
}

export const FAILURES: Record<FailureClass, FailureCopy> = {
  acquisition: {
    message: "Upload didn't finish.",
    nextStep: "Retry this file.",
    tone: "error",
    blocksConvert: false,
  },
  format_locked: {
    message: "This PDF is password protected.",
    nextStep: "Remove the password and upload it again.",
    tone: "error",
    blocksConvert: false,
  },
  format_corrupt: {
    message: "This file says it is one thing but isn't.",
    nextStep: "Check the file and upload it again.",
    tone: "error",
    blocksConvert: false,
  },
  format_unsupported: {
    message: "That format isn't supported.",
    nextStep: "Save it as PDF, .docx, .xlsx or CSV and upload it again.",
    tone: "error",
    blocksConvert: false,
  },
  extract_empty: {
    message: "Its pages are images with no readable text.",
    nextStep: "Remove it, or convert anyway and it will be skipped.",
    tone: "error",
    blocksConvert: false,
  },
  schema_not_found: {
    message: "Couldn't find a table in this one.",
    nextStep: "Add fields yourself, or leave it out.",
    tone: "error",
    blocksConvert: false,
  },
  schema_inference_failed: {
    message: "Couldn't work out this file's shape.",
    nextStep: "Convert anyway and it'll be skipped, or remove it.",
    tone: "error",
    blocksConvert: false,
  },
  merge_incompatible: {
    message: "These tables don't have the same fields and types.",
    nextStep: "Untick the table named on the card, or merge within its own schema.",
    tone: "error",
    blocksConvert: false,
  },
  too_large: {
    message: "This file is past the size we can read in one go.",
    nextStep: "Split it, or raise the cap.",
    tone: "error",
    blocksConvert: false,
  },
  provider_quota_exhausted: {
    message: "Daily page allowance used up.",
    nextStep: "Nothing — it picks up on its own, and finished tables stay downloadable.",
    tone: "paused",
    blocksConvert: false,
  },
  provider_refused: {
    message: "The model declined to process this document.",
    nextStep: "Remove it from the batch.",
    tone: "error",
    blocksConvert: false,
  },
  response_unparseable: {
    message: "Couldn't get a clean answer for this one.",
    nextStep: "Retry it.",
    tone: "error",
    blocksConvert: false,
  },
  field_unresolved: {
    message: "This value isn't in the document.",
    nextStep: "Nothing — the cell reads “not found” rather than guessing.",
    tone: "review",
    blocksConvert: false,
  },
  field_unsupported_by_evidence: {
    message: "I couldn't find this value in the document.",
    nextStep: "Check it against the evidence beside it.",
    tone: "review",
    blocksConvert: false,
  },
  verification_failed: {
    message: "An automatic check on this value didn't pass.",
    nextStep: "Check it against the evidence beside it.",
    tone: "review",
    blocksConvert: false,
  },
  budget_exceeded: {
    message: "You've hit your processing cap.",
    nextStep: "Raise the cap, or take the tables you have.",
    tone: "paused",
    blocksConvert: false,
  },
  gate_not_met: {
    message: "Some files are still reading their shape.",
    nextStep: "Wait for them to finish, or remove them.",
    tone: "error",
    blocksConvert: true,
  },
  empty_file: {
    message: "This file is empty.",
    nextStep: "Remove it; the rest carry on.",
    tone: "error",
    blocksConvert: false,
  },
  archive_not_expanded: {
    message: "Archives aren't read yet.",
    nextStep: "Unzip it first and drop the files.",
    tone: "error",
    blocksConvert: false,
  },
  processing_failed: {
    message: "Something went wrong working through this one.",
    nextStep: "Retry it; the rest of the batch is unaffected.",
    tone: "error",
    blocksConvert: false,
  },
  max_attempts: {
    message: "This one failed repeatedly, so we stopped trying.",
    nextStep: "Remove it, or upload it again.",
    tone: "error",
    blocksConvert: false,
  },
  internal: {
    message: "Something went wrong on our side.",
    nextStep: "Retry it — we've logged what happened.",
    tone: "error",
    blocksConvert: false,
  },
  not_implemented: {
    message: "This part isn't wired to the backend yet.",
    nextStep: "Run `npm run fixtures:on` to see it with sample data instead.",
    tone: "error",
    blocksConvert: false,
  },
  network: {
    message: "Couldn't reach the server.",
    nextStep: "Check your connection — we'll keep trying.",
    tone: "error",
    blocksConvert: false,
  },
  unknown: {
    message: "Something went wrong that we don't have a name for.",
    nextStep: "Retry, and tell us if it happens again.",
    tone: "error",
    blocksConvert: false,
  },
}

export function failureCopy(failure: Failure): FailureCopy {
  const base = FAILURES[failure.class] ?? FAILURES.unknown
  return {
    ...base,
    message: failure.message ?? base.message,
    nextStep: failure.nextStep ?? base.nextStep,
  }
}
