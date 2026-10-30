import type {
  BrowserImportPreview,
  BrowserImportProfile,
  BrowserImportResponse,
  BrowserImportResult
} from '../browser-import.js'
import type { InvokeChannel } from './channel.js'

/** Importing another browser's sign-ins into a workspace, for the person only and never through MCP. */
export const BROWSER_IMPORT_IPC = {
  /** Main window → main: the other browsers' profiles that can be imported into the workspace; starts a new import. */
  list: 'browser-import:list' as InvokeChannel<[workspaceId: string], BrowserImportResponse<BrowserImportProfile[]>>,
  /** Main window → main: once the person allows it, reads the profile and answers the sites it has sign-ins for; null when they did not. */
  preview: 'browser-import:preview' as InvokeChannel<[workspaceId: string, profileId: string], BrowserImportResponse<BrowserImportPreview | null>>,
  /** Main window → main: imports the previewed sign-ins of these sites. */
  commit: 'browser-import:commit' as InvokeChannel<[previewId: string, domains: string[]], BrowserImportResponse<BrowserImportResult>>,
  /** Main window → main: stops the import under way and forgets its preview. */
  cancel: 'browser-import:cancel' as InvokeChannel<[], void>
} as const
