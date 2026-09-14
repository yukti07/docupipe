import type {
  ConvertResponse, Evidence, MergeGroup, MergeResult, RawText, RegisterResponse,
  ResultPollResponse, SchemaPollResponse, SchemaSaveEntry, SignedUrlResponse, TableData,
  UpdateSchemaResponse, UploadResponse, UploadedFile,
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

  /* not on the server yet — §0.9 */
  getTable(requestId: string, schemaId: string): Promise<TableData>
  getEvidence(valueId: string): Promise<Evidence>
  getRawText(requestId: string, schemaId: string): Promise<RawText>
  getMergeGroups(requestId: string): Promise<MergeGroup[]>
  createMerge(requestId: string, schemaIds: string[], name: string): Promise<MergeResult>
}
