import type {
  ConvertResponse, DiscardResponse, Evidence, MergeOverview, MergeResult, MergeSubmission,
  RawText, RegisterResponse, ResultPollResponse, SchemaPollResponse, SchemaSaveEntry,
  SignedUrlResponse, TableData, UpdateSchemaResponse, UploadResponse, UploadedFile,
} from "./types"

export interface QuarryApi {
  /* the seven — live */
  register(userId: string): Promise<RegisterResponse>
  getSignedUrls(userId: string, requestId: string, fileNames: string[]): Promise<SignedUrlResponse>
  confirmUploads(userId: string, requestId: string, files: UploadedFile[]): Promise<UploadResponse>
  pollSchemas(
    userId: string,
    requestId: string,
    received: string[],
    signal?: AbortSignal,
  ): Promise<SchemaPollResponse>
  updateSchemas(
    userId: string,
    requestId: string,
    files: SchemaSaveEntry[],
  ): Promise<UpdateSchemaResponse>
  convert(userId: string, requestId: string): Promise<ConvertResponse>
  pollResult(userId: string, requestId: string, signal?: AbortSignal): Promise<ResultPollResponse>

  /* the way out of a file that will not convert */
  discardFiles(userId: string, requestId: string, fileIds: string[]): Promise<DiscardResponse>

  /* combining tables */
  getMergeOverview(requestId: string): Promise<MergeOverview>
  /** Several groups in one submit — 4 of one shape and 2 of another is one press. */
  createMerges(
    userId: string,
    requestId: string,
    merges: MergeSubmission[],
  ): Promise<MergeResult>
  deleteMerge(userId: string, requestId: string, mergeId: string): Promise<{ status: "ok" }>

  /* not on the server yet — §0.9 */
  getTable(requestId: string, schemaId: string): Promise<TableData>
  getEvidence(valueId: string): Promise<Evidence>
  getRawText(requestId: string, schemaId: string): Promise<RawText>
}
