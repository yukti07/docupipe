import type { Failure } from "@/lib/api/types"

/**
 * fetch cannot report upload progress, and a 500-file drop with no per-file bar
 * is the state this screen exists to avoid — so the PUT goes over XHR.
 */
export type UploadTask = {
  localId: string
  file: File
  /** The signed PUT url from §0.2. filePath *is* the url, not an object key. */
  url: string
  /** Sent verbatim. Adding a header of our own breaks the signature (§19.1). */
  headers: Record<string, string>
}

export type UploadEvents = {
  onProgress?: (localId: string, loaded: number, total: number) => void
  onSettled?: (localId: string, failure?: Failure) => void
}

/** The canvas runs two at a time; more just makes every bar slower. */
export const UPLOAD_CONCURRENCY = 2

const failed = (message: string): Failure => ({
  class: "acquisition",
  message,
  nextStep: "Retry this file.",
})

export function putFile(
  task: UploadTask,
  events: Pick<UploadEvents, "onProgress"> = {},
  signal?: AbortSignal,
): Promise<Failure | undefined> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", task.url, true)

    // Verbatim, and nothing else. GCS signs the Content-Type it handed back;
    // a byte-different one answers 403 and the browser calls it a CORS error.
    for (const [name, value] of Object.entries(task.headers)) {
      xhr.setRequestHeader(name, value)
    }

    xhr.upload.onprogress = (event) => {
      events.onProgress?.(task.localId, event.loaded, event.total || task.file.size)
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        events.onProgress?.(task.localId, task.file.size, task.file.size)
        resolve(undefined)
        return
      }
      resolve(failed("Upload didn't finish."))
    }

    xhr.onerror = () => resolve(failed("Upload didn't finish."))
    xhr.ontimeout = () => resolve(failed("The upload timed out."))
    xhr.onabort = () => resolve(failed("Upload was cancelled."))

    if (signal) {
      if (signal.aborted) {
        xhr.abort()
        return
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true })
    }

    xhr.send(task.file)
  })
}

/**
 * Runs the queue at a fixed width. Every task settles — a failure is reported
 * against its own file and the other twenty-eight carry on untouched.
 */
export async function uploadAll(
  tasks: UploadTask[],
  events: UploadEvents = {},
  options: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<Map<string, Failure | undefined>> {
  const width = Math.max(1, options.concurrency ?? UPLOAD_CONCURRENCY)
  const outcomes = new Map<string, Failure | undefined>()
  let next = 0

  async function worker() {
    while (next < tasks.length) {
      if (options.signal?.aborted) return
      const task = tasks[next]
      next += 1
      const failure = await putFile(task, events, options.signal)
      outcomes.set(task.localId, failure)
      events.onSettled?.(task.localId, failure)
    }
  }

  await Promise.all(Array.from({ length: Math.min(width, tasks.length) }, worker))
  return outcomes
}
