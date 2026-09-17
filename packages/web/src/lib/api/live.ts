import { ApiError, postJson } from "./http"
import type { QuarryApi } from "./contract"
import type * as T from "./types"

export const LiveApi: Pick<
  QuarryApi,
  | "register"
  | "getSignedUrls"
  | "confirmUploads"
  | "pollSchemas"
  | "updateSchemas"
  | "convert"
  | "pollResult"
> = {
  register: (userId) => postJson<T.RegisterResponse>("/api/register", { userId }),

  getSignedUrls: (userId, requestId, files) =>
    postJson<T.SignedUrlResponse>("/api/getSignedUrl", { userId, requestId, files }),

  confirmUploads: (userId, requestId, files) =>
    postJson<T.UploadResponse>("/api/upload", { userId, requestId, files }),

  pollSchemas: (userId, requestId, received, signal) =>
    postJson<T.SchemaPollResponse>("/api/polling/schema", { userId, requestId, received }, signal),

  updateSchemas: (userId, requestId, files) =>
    postJson<T.UpdateSchemaResponse>("/api/updateSchema", { userId, requestId, files }),

  convert: (userId, requestId) => postJson<T.ConvertResponse>("/api/convert", { userId, requestId }),

  pollResult: (userId, requestId, signal) =>
    postJson<T.ResultPollResponse>("/api/polling/result", { userId, requestId }, signal),
}

/**
 * §0.9's five surfaces have no route on the server yet.
 *
 * They used to fall through to `FixtureApi` in live mode, which meant the table,
 * evidence and merge screens quietly served invented rows that looked exactly
 * like the user's own data. A screen that is unfinished should say so — it is
 * the one thing worse than an error to hand someone numbers that are not theirs
 * and give them no way to tell.
 *
 * Deleting an entry here is how a surface goes live: write the route, add it to
 * `LiveApi`, drop it from this object.
 */
export const NotBuilt: Pick<
  QuarryApi,
  "getTable" | "getEvidence" | "getRawText" | "getMergeGroups" | "createMerge"
> = {
  getTable: notBuilt("The table screen"),
  getEvidence: notBuilt("Evidence"),
  getRawText: notBuilt("Raw text"),
  getMergeGroups: notBuilt("Combining tables"),
  createMerge: notBuilt("Combining tables"),
}

function notBuilt(what: string): () => Promise<never> {
  return () =>
    Promise.reject(
      new ApiError(
        {
          class: "not_implemented",
          message: `${what} has no endpoint on the server yet.`,
          nextStep: "Run `npm run fixtures:on` to see this screen with sample data.",
        },
        501,
        null,
      ),
    )
}
