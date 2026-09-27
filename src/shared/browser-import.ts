/** Human UI contracts only. Never expose these operations through MCP. */
export interface BrowserImportProfile { id: string; browser: string; name: string }
export interface BrowserImportSite { domain: string; count: number; includesSubdomains: boolean }
export interface BrowserImportPreview {
  id: string
  sites: BrowserImportSite[]
  skipped: number
  expiresAt: number
}
export interface BrowserImportResult {
  imported: number
  skipped: number
  failed: number
  recoveryRequired: boolean
}
export type BrowserImportErrorCode = 'unsupported' | 'readFailed' | 'keyUnavailable' | 'tooLarge' | 'expired' | 'busy' | 'workspaceBusy' | 'restricted' | 'failed'
export type BrowserImportResponse<T> = { ok: true; value: T } | { ok: false; error: BrowserImportErrorCode }
export interface BrowserImportApi {
  list(workspaceId: string): Promise<BrowserImportResponse<BrowserImportProfile[]>>
  preview(workspaceId: string, profileId: string): Promise<BrowserImportResponse<BrowserImportPreview | null>>
  cancel(): Promise<void>
  commit(previewId: string, domains: string[]): Promise<BrowserImportResponse<BrowserImportResult>>
}
