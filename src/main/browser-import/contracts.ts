import type { Cookie } from 'electron'
import type { BrowserImportErrorCode, BrowserImportProfile } from '../../shared/browser-import.js'

/** Shared import contracts: orchestration and destinations do not depend on source I/O. */
export class BrowserImportError extends Error {
  constructor(readonly code: BrowserImportErrorCode) { super(code) }
}

export interface ImportProfile extends BrowserImportProfile {
  file: string
  kind: 'chromium' | 'firefox'
  keyApplication: string
}

export interface CookieSnapshot { cookies: Cookie[]; skipped: number }
