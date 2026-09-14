import { postJson } from "./http"
import type { QuarryApi } from "./contract"
import type * as T from "./types"

const notLive = (what: string) => () => {
  throw new Error(`${what} has no endpoint yet — see backend plan §0.9. Use FixtureApi.`)
}

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

export { notLive }
