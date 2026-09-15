"use client"

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import { ApiError, api } from "@/lib/api"
import type {
  Failure,
  SchemaEntry,
  SchemaPollResponse,
  SchemaSaveEntry,
  SignedUrlFile,
  SchemaField,
} from "@/lib/api/types"
import { usePoll } from "@/lib/polling"
import { stageFiles, type StagedFile } from "@/lib/preflight"
import { uploadAll, type UploadTask } from "@/lib/upload"
import type { SchemaState } from "@/lib/schema"
import { readRememberedFiles, rememberFiles, type RememberedFile } from "@/state/batchFiles"
import { takeStagedFiles } from "@/state/staged"

/* ------------------------------------------------------------------ */
/* Shape                                                               */
/* ------------------------------------------------------------------ */

export type UploadStage =
  | "staged"
  | "checking"
  | "rejected"
  | "uploading"
  | "uploaded"
  | "failed"

export type BatchFile = {
  localId: string
  fileId?: string
  name: string
  location: string
  size: number
  stage: UploadStage
  progress?: { loaded: number; total: number }
  failure?: Failure
  signed?: SignedUrlFile
  /** Kept so a single file can be retried without re-staging the drop. */
  file?: File
}

export type BatchState = {
  files: BatchFile[]
  /** Keyed by `${fileId}:${schemaId}` — a three-table file holds three. */
  schemas: SchemaState[]
  /** Files that settled without a shape. Carried as failures, never as blockers. */
  wontConvert: { fileId: string; fileName: string; failure: Failure }[]
  pending: number
  convertAvailable: boolean
  convertBlockedReason: string | null
  /** A failure that belongs to the batch rather than to one file. */
  failure: Failure | null
}

type Action =
  | { type: "staged"; files: BatchFile[] }
  | { type: "rehydrated"; files: BatchFile[] }
  | { type: "signing" }
  | { type: "signed"; signed: Record<string, SignedUrlFile> }
  | { type: "signing-failed"; failure: Failure }
  | { type: "progress"; localId: string; loaded: number; total: number }
  | { type: "upload-settled"; localId: string; failure?: Failure }
  | { type: "upload-confirmed"; entries: { fileId: string; failure?: Failure }[] }
  | { type: "retrying"; localId: string }
  | { type: "restaged"; localIds: string[] }
  | { type: "added"; files: BatchFile[] }
  | { type: "discarded"; localIds: string[] }
  | { type: "schema-poll"; response: SchemaPollResponse }
  | { type: "schema-saved"; schemaIds: string[]; fields: SchemaField[]; versions: Record<string, number> }

const EMPTY: BatchState = {
  files: [],
  schemas: [],
  wontConvert: [],
  pending: 0,
  convertAvailable: false,
  // The server owns this sentence. Until it answers there is nothing honest to
  // say, and the gate says it by staying shut rather than by explaining itself.
  convertBlockedReason: null,
  failure: null,
}

function toSchemaState(entry: SchemaEntry): SchemaState | null {
  if (entry.status !== "ready" || !entry.schema || !entry.schemaId) return null
  return {
    fileId: entry.fileId,
    fileName: entry.fileName,
    filePath: entry.filePath,
    schemaId: entry.schemaId,
    tableLabel: entry.schema.tableLabel,
    version: entry.schema.version,
    original: entry.schema.fields,
    current: entry.schema.fields,
  }
}

function reduce(state: BatchState, action: Action): BatchState {
  switch (action.type) {
    case "staged":
      return { ...state, files: action.files }

    case "rehydrated":
      // These landed before the reload, so they start where they left off:
      // uploaded, with their shape already being read on the server.
      return { ...state, files: action.files }

    case "signing":
      return {
        ...state,
        failure: null,
        files: state.files.map((f) => (f.stage === "staged" ? { ...f, stage: "checking" } : f)),
      }

    case "signing-failed":
      // A file that could not even be signed has not uploaded, so it says so and
      // offers a retry. The reason belongs to the batch, not to each row, so it
      // is stated once above the list rather than four times inside it.
      return {
        ...state,
        failure: action.failure,
        files: state.files.map((f) => (f.stage === "checking" ? { ...f, stage: "failed" } : f)),
      }

    case "signed":
      return {
        ...state,
        files: state.files.map((f) => {
          const signed = action.signed[f.localId]
          if (!signed) return f
          return {
            ...f,
            fileId: signed.fileId,
            signed,
            stage: "uploading",
            progress: { loaded: 0, total: f.size },
          }
        }),
      }

    case "progress":
      return {
        ...state,
        files: state.files.map((f) =>
          f.localId === action.localId
            ? { ...f, progress: { loaded: action.loaded, total: action.total } }
            : f,
        ),
      }

    case "upload-settled":
      return {
        ...state,
        files: state.files.map((f) =>
          f.localId === action.localId
            ? {
                ...f,
                stage: action.failure ? "failed" : "uploaded",
                failure: action.failure,
              }
            : f,
        ),
      }

    case "upload-confirmed": {
      const byId = new Map(action.entries.map((e) => [e.fileId, e]))
      return {
        ...state,
        files: state.files.map((f) => {
          const entry = f.fileId ? byId.get(f.fileId) : undefined
          if (!entry) return f
          return entry.failure
            ? { ...f, stage: "failed", failure: entry.failure }
            : { ...f, stage: "uploaded", failure: undefined }
        }),
      }
    }

    case "retrying":
      return {
        ...state,
        files: state.files.map((f) =>
          f.localId === action.localId
            ? { ...f, stage: "uploading", failure: undefined, progress: { loaded: 0, total: f.size } }
            : f,
        ),
      }

    case "restaged": {
      const ids = new Set(action.localIds)
      return {
        ...state,
        failure: null,
        files: state.files.map((f) =>
          ids.has(f.localId)
            ? { ...f, stage: "staged", failure: undefined, progress: undefined }
            : f,
        ),
      }
    }

    case "added":
      return { ...state, files: [...state.files, ...action.files] }

    case "discarded": {
      const ids = new Set(action.localIds)
      const files = state.files.filter((f) => !ids.has(f.localId))
      // The banner named files that are no longer on screen.
      return { ...state, files, failure: files.length === 0 ? null : state.failure }
    }

    case "schema-poll": {
      const { response } = action
      const known = new Set(state.schemas.map((s) => `${s.fileId}:${s.schemaId}`))
      const ready = response.files
        .map(toSchemaState)
        .filter((s): s is SchemaState => s !== null)
        .filter((s) => !known.has(`${s.fileId}:${s.schemaId}`))

      const knownFailures = new Set(state.wontConvert.map((w) => w.fileId))
      const failures = response.files
        .filter((entry) => entry.status === "failed" && !knownFailures.has(entry.fileId))
        .map((entry) => ({
          fileId: entry.fileId,
          fileName: entry.fileName,
          failure: entry.failure ?? { class: "schema_inference_failed" as const },
        }))

      return {
        ...state,
        schemas: [...state.schemas, ...ready],
        wontConvert: [...state.wontConvert, ...failures],
        pending: response.pending,
        convertAvailable: response.convertAvailable,
        convertBlockedReason: response.convertBlockedReason,
      }
    }

    case "schema-saved":
      return {
        ...state,
        schemas: state.schemas.map((schema) =>
          action.schemaIds.includes(schema.schemaId)
            ? {
                ...schema,
                current: action.fields,
                version: action.versions[schema.schemaId] ?? schema.version + 1,
              }
            : schema,
        ),
      }

    default:
      return state
  }
}

/** Rehydrated rows carry no File handle — there is nothing left to re-send. */
const fromRememberedFile = (file: RememberedFile): BatchFile => ({
  localId: `rem_${file.fileId}`,
  fileId: file.fileId,
  name: file.fileName,
  location: file.fileLocation,
  size: file.size,
  stage: "uploaded",
})

const toBatchFile = (staged: StagedFile): BatchFile => ({
  localId: staged.localId,
  name: staged.name,
  location: staged.location,
  size: staged.size,
  file: staged.file,
  stage: staged.rejection ? "rejected" : "staged",
  failure: staged.rejection,
})

/* ------------------------------------------------------------------ */
/* The hook                                                            */
/* ------------------------------------------------------------------ */

/** §0.4, pinned for now: one poll every 5 s, and no more than 60 of them. */
export const SCHEMA_POLL_MS = 5000
export const SCHEMA_POLL_MAX = 60

export type UseBatch = BatchState & {
  /** True while the upload half of Prepare still has work in flight. */
  uploading: boolean
  uploadedCount: number
  acceptedCount: number
  schemaPollFailure: Failure | null
  /** The poll ran out its budget with shapes still missing. */
  schemasStalled: boolean
  /** Uploads that did not land and still hold their bytes, so they can go again. */
  retryableCount: number
  retryUpload: (localId: string) => void
  retryAllUploads: () => void
  /** Drops every row that will not upload, and answers with how many are left. */
  discardFailed: () => number
  addFiles: (files: File[]) => void
  saveSchema: (
    schemaId: string,
    fields: SchemaField[],
    alsoApplyTo: string[],
  ) => Promise<{ ok: true } | { ok: false; failure: Failure }>
  convert: () => Promise<{ ok: true } | { ok: false; failure: Failure }>
}

export function useBatch(
  requestId: string,
  userId: string | null,
  options: { pollSchemas?: boolean } = {},
): UseBatch {
  const { pollSchemas = true } = options
  const [state, dispatch] = useReducer(reduce, EMPTY)
  const [uploading, setUploading] = useState(false)
  // Nothing is polled until the staged drop has been read out of the handoff:
  // the first render has no files yet, and polling then asks the server about a
  // request it has not been told about, which is a 500 by any other name.
  const [hydrated, setHydrated] = useState(false)
  const started = useRef(false)

  // The drop happened on the workspace screen; the bytes are handed over here.
  useEffect(() => {
    if (started.current || !userId) return
    started.current = true

    const staged = takeStagedFiles(requestId)
    setHydrated(true)

    if (!staged || staged.length === 0) {
      // A reload, or this batch was started somewhere else. Whatever already
      // reached the bucket is remembered and comes back as an uploaded row.
      const remembered = readRememberedFiles(requestId)
      if (remembered.length > 0) {
        dispatch({ type: "rehydrated", files: remembered.map(fromRememberedFile) })
      }
      return
    }

    const files = staged.map(toBatchFile)
    dispatch({ type: "staged", files })

    const accepted = files.filter((f) => f.stage === "staged")
    if (accepted.length === 0) return

    void runUpload(userId, requestId, accepted, dispatch, setUploading)
  }, [requestId, userId])

  const received = useMemo(
    () => [...new Set(state.schemas.map((s) => s.fileId))],
    [state.schemas],
  )
  // The poll reads this each time it fires, not when the loop was set up, so
  // the delta the server sends stays correct as entries arrive.
  const receivedRef = useRef(received)
  useEffect(() => {
    receivedRef.current = received
  }, [received])

  const uploadedCount = state.files.filter(
    (f) => f.stage === "uploaded" || f.fileId !== undefined,
  ).length
  const acceptedCount = state.files.filter((f) => f.stage !== "rejected").length
  // A fileId only exists once getSignedUrl has answered, which is the moment
  // the server has a row for this request and these files. Before that there is
  // nothing on the other end to poll for.
  const anyRegistered = state.files.some((f) => f.fileId !== undefined)

  // Upload and shape-reading are two clocks: a row can be uploaded while its
  // shape is still coming, so the poll starts as soon as anything has landed.
  // Every file that has landed, and every one that has settled a shape either
  // way. The poll stops when those two agree and nothing is still going up.
  const settledShapes = useMemo(
    () =>
      new Set([
        ...state.schemas.map((s) => s.fileId),
        ...state.wontConvert.map((w) => w.fileId),
      ]),
    [state.schemas, state.wontConvert],
  )
  const landed = useMemo(
    () => state.files.filter((f) => f.stage === "uploaded" && f.fileId).map((f) => f.fileId!),
    [state.files],
  )
  const allShapesIn =
    !uploading &&
    landed.length > 0 &&
    state.pending === 0 &&
    landed.every((fileId) => settledShapes.has(fileId))

  // Read by the loop after each response, so it is never a render behind by the
  // time the next poll is due.
  const doneRef = useRef(allShapesIn)
  useEffect(() => {
    doneRef.current = allShapesIn
  }, [allShapesIn])

  const poll = usePoll(
    useCallback(
      (signal: AbortSignal) => api.pollSchemas(userId!, requestId, receivedRef.current, signal),
      [requestId, userId],
    ),
    {
      enabled:
        Boolean(userId) &&
        pollSchemas &&
        hydrated &&
        (anyRegistered || state.files.length === 0),
      // Whichever comes first: every file accounted for, or the budget spent.
      stopWhen: () => doneRef.current,
      maxPolls: SCHEMA_POLL_MAX,
      intervalFor: () => SCHEMA_POLL_MS,
      onData: (response) => dispatch({ type: "schema-poll", response }),
    },
  )

  // A loop that has stopped — settled, or out of budget — has to start again
  // when another file lands, which is what Drop more files does. A loop still
  // running already covers it, and restarting would abort its poll mid-flight.
  const landedKey = landed.join(",")
  const restart = poll.refresh
  const stopped = poll.stopped
  const restartedFor = useRef(landedKey)
  useEffect(() => {
    if (!stopped) {
      restartedFor.current = landedKey
      return
    }
    if (landedKey && landedKey !== restartedFor.current) {
      restartedFor.current = landedKey
      restart()
    }
  }, [landedKey, restart, stopped])

  // A row that never got a signed url has nothing to PUT to, so it goes back
  // through signing. One that has one skips straight to the bytes.
  const sendAgain = useCallback(
    (files: BatchFile[]) => {
      if (!userId || files.length === 0) return
      dispatch({ type: "restaged", localIds: files.map((f) => f.localId) })
      void runUpload(
        userId,
        requestId,
        files.map((f) => ({ ...f, stage: "staged" as const, failure: undefined })),
        dispatch,
        setUploading,
      )
    },
    [requestId, userId],
  )

  // A reloaded row has no File handle left, so it is not offered a retry.
  const failedWithBytes = useMemo(
    () => state.files.filter((f) => f.stage === "failed" && f.file),
    [state.files],
  )

  const retryUpload = useCallback(
    (localId: string) => {
      const file = state.files.find((f) => f.localId === localId)
      if (!file?.file || !userId) return
      if (!file.signed) {
        sendAgain([file])
        return
      }
      dispatch({ type: "retrying", localId })
      void retryOne(userId, requestId, file, dispatch)
    },
    [requestId, sendAgain, state.files, userId],
  )

  const retryAllUploads = useCallback(
    () => sendAgain(failedWithBytes),
    [failedWithBytes, sendAgain],
  )

  const discardFailed = useCallback(() => {
    const failed = state.files.filter((f) => f.stage === "failed" || f.stage === "rejected")
    if (failed.length === 0) return state.files.length
    dispatch({ type: "discarded", localIds: failed.map((f) => f.localId) })
    return state.files.length - failed.length
  }, [state.files])

  const addFiles = useCallback(
    (files: File[]) => {
      if (!userId || files.length === 0) return
      const added = stageFiles(files).map(toBatchFile)
      dispatch({ type: "added", files: added })
      const accepted = added.filter((f) => f.stage === "staged")
      if (accepted.length > 0) {
        void runUpload(userId, requestId, accepted, dispatch, setUploading)
      }
    },
    [requestId, userId],
  )

  const saveSchema = useCallback<UseBatch["saveSchema"]>(
    async (schemaId, fields, alsoApplyTo) => {
      if (!userId) return { ok: false, failure: { class: "network" } }
      const schemaIds = [schemaId, ...alsoApplyTo]
      const entries: SchemaSaveEntry[] = schemaIds
        .map((id) => state.schemas.find((s) => s.schemaId === id))
        .filter((s): s is SchemaState => Boolean(s))
        .map((s) => ({
          fileId: s.fileId,
          fileName: s.fileName,
          filePath: s.filePath,
          schemaId: s.schemaId,
          schema: { fields },
        }))

      try {
        const response = await api.updateSchemas(userId, requestId, entries)
        const versions = Object.fromEntries(
          response.updated.map((u) => [u.schemaId, u.version]),
        )
        dispatch({ type: "schema-saved", schemaIds, fields, versions })
        return { ok: true }
      } catch (error) {
        return {
          ok: false,
          failure: error instanceof ApiError ? error.failure : { class: "unknown" },
        }
      }
    },
    [requestId, state.schemas, userId],
  )

  const convert = useCallback<UseBatch["convert"]>(async () => {
    if (!userId) return { ok: false, failure: { class: "network" } }
    try {
      await api.convert(userId, requestId)
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        failure: error instanceof ApiError ? error.failure : { class: "unknown" },
      }
    }
  }, [requestId, userId])

  return {
    ...state,
    uploading,
    uploadedCount,
    acceptedCount,
    schemaPollFailure: poll.failure,
    // Out of polls with shapes still missing: the screen says so and lets the
    // batch go anyway, rather than spinning on a promise it cannot keep.
    schemasStalled: poll.exhausted && !allShapesIn,
    retryableCount: failedWithBytes.length,
    retryUpload,
    retryAllUploads,
    discardFailed,
    addFiles,
    saveSchema,
    convert,
  }
}

/* ------------------------------------------------------------------ */
/* The upload flow — sign, PUT, confirm                                */
/* ------------------------------------------------------------------ */

async function runUpload(
  userId: string,
  requestId: string,
  accepted: BatchFile[],
  dispatch: (action: Action) => void,
  setUploading: (value: boolean) => void,
) {
  setUploading(true)
  dispatch({ type: "signing" })

  let signedFiles: SignedUrlFile[]
  try {
    const response = await api.getSignedUrls(
      userId,
      requestId,
      accepted.map((f) => f.name),
    )
    signedFiles = response.files
  } catch (error) {
    dispatch({
      type: "signing-failed",
      failure: error instanceof ApiError ? error.failure : { class: "unknown" },
    })
    setUploading(false)
    return
  }

  // The server answers in the order it was asked, one entry per name.
  const byLocalId: Record<string, SignedUrlFile> = {}
  accepted.forEach((file, index) => {
    const signed = signedFiles[index]
    if (signed) byLocalId[file.localId] = signed
  })
  dispatch({ type: "signed", signed: byLocalId })

  const tasks: UploadTask[] = accepted
    .filter((file) => byLocalId[file.localId] && file.file)
    .map((file) => ({
      localId: file.localId,
      file: file.file!,
      url: byLocalId[file.localId].filePath,
      headers: byLocalId[file.localId].uploadHeaders,
    }))

  // Each file is confirmed the moment its own bytes land, not when the last
  // file in the drop does: inspection of the first file then runs while the
  // third is still going up, and the row's eye starts filling with it.
  const confirmed = new Set<string>()
  const inFlight: Promise<void>[] = []

  const outcomes = await uploadAll(tasks, {
    onProgress: (localId, loaded, total) =>
      dispatch({ type: "progress", localId, loaded, total }),
    onSettled: (localId, failure) => {
      dispatch({ type: "upload-settled", localId, failure })
      if (failure) return
      const file = accepted.find((f) => f.localId === localId)
      if (!file || !byLocalId[localId]) return
      inFlight.push(
        // Quiet: a confirm that does not go through says nothing yet, because
        // the sweep below gets one more go at it before the row is called bad.
        confirm(userId, requestId, [file], byLocalId, dispatch, { quiet: true }).then((ok) => {
          if (ok) confirmed.add(localId)
        }),
      )
    },
  })

  await Promise.all(inFlight)

  // Anything that reached the bucket but whose confirm did not reach us. Left
  // alone it would sit at Uploaded here and UPLOADING on the server, with
  // nothing queued to read it.
  const missed = accepted.filter(
    (file) =>
      !outcomes.get(file.localId) && byLocalId[file.localId] && !confirmed.has(file.localId),
  )
  await confirm(userId, requestId, missed, byLocalId, dispatch)
  setUploading(false)
}

/**
 * Never mark a file uploaded because a signed URL came back — §0.3 confirms
 * against the object that is actually in the bucket.
 */
async function confirm(
  userId: string,
  requestId: string,
  landed: BatchFile[],
  byLocalId: Record<string, SignedUrlFile>,
  dispatch: (action: Action) => void,
  options: { quiet?: boolean } = {},
): Promise<boolean> {
  if (landed.length === 0) return true
  try {
    const response = await api.confirmUploads(
      userId,
      requestId,
      landed.map((file) => ({
        fileId: byLocalId[file.localId].fileId,
        fileName: file.name,
        filePath: byLocalId[file.localId].filePath,
        fileLocation: file.location,
      })),
    )
    dispatch({
      type: "upload-confirmed",
      entries: response.files.map((entry) => ({
        fileId: entry.fileId,
        failure:
          entry.stage === "FAILED"
            ? {
                class: entry.failureClass ?? "acquisition",
                message: entry.message,
                nextStep: entry.nextStep,
              }
            : undefined,
      })),
    })

    // Remember only what the server agreed is in the bucket — a reload after
    // this point still shows these files and picks their shapes up.
    const landedIds = new Set(
      response.files.filter((entry) => entry.stage === "UPLOADED").map((entry) => entry.fileId),
    )
    rememberFiles(
      requestId,
      landed
        .map((file) => ({
          fileId: byLocalId[file.localId].fileId,
          fileName: file.name,
          fileLocation: file.location,
          size: file.size,
          filePath: byLocalId[file.localId].filePath,
          expiresAt: byLocalId[file.localId].expiresAt,
        }))
        .filter((file) => landedIds.has(file.fileId)),
    )
    return true
  } catch (error) {
    // Quiet leaves the rows exactly where they are: the caller has another
    // attempt in hand, and a row that flickers through failed and back is a
    // worse account of what happened than one that waits a moment.
    if (options.quiet) return false
    const failure = error instanceof ApiError ? error.failure : { class: "unknown" as const }
    dispatch({
      type: "upload-confirmed",
      entries: landed.map((file) => ({ fileId: byLocalId[file.localId].fileId, failure })),
    })
    return false
  }
}

async function retryOne(
  userId: string,
  requestId: string,
  file: BatchFile,
  dispatch: (action: Action) => void,
) {
  const outcomes = await uploadAll(
    [
      {
        localId: file.localId,
        file: file.file!,
        url: file.signed!.filePath,
        headers: file.signed!.uploadHeaders,
      },
    ],
    {
      onProgress: (localId, loaded, total) =>
        dispatch({ type: "progress", localId, loaded, total }),
      onSettled: (localId, failure) => dispatch({ type: "upload-settled", localId, failure }),
    },
  )
  if (!outcomes.get(file.localId)) {
    await confirm(userId, requestId, [file], { [file.localId]: file.signed! }, dispatch)
  }
}
