import type { MessageKey } from '../../shared/i18n.js'
import { LocalizedError } from '../localized-error.js'

/** The sentence for each common network error Chromium reports when a page load fails. */
const LOAD_FAILURE_MESSAGES: Record<string, MessageKey> = {
  ERR_NAME_NOT_RESOLVED: 'appErrors.loadFailure.nameNotResolved',
  ERR_CONNECTION_REFUSED: 'appErrors.loadFailure.connectionRefused',
  ERR_INTERNET_DISCONNECTED: 'appErrors.loadFailure.offline',
  ERR_TIMED_OUT: 'appErrors.loadFailure.timedOut',
  ERR_CONNECTION_TIMED_OUT: 'appErrors.loadFailure.timedOut',
  ERR_CONNECTION_RESET: 'appErrors.loadFailure.connectionReset',
  ERR_NAME_RESOLUTION_FAILED: 'appErrors.loadFailure.nameResolutionFailed',
  ERR_ADDRESS_UNREACHABLE: 'appErrors.loadFailure.addressUnreachable',
  ERR_CONNECTION_CLOSED: 'appErrors.loadFailure.connectionClosed',
  ERR_EMPTY_RESPONSE: 'appErrors.loadFailure.emptyResponse'
}

/** Certificate codes that report a changed certificate store or verifier, not a certificate the site presented. */
const NOT_SITE_CERTIFICATE_FAILURES = new Set(['ERR_CERT_DATABASE_CHANGED', 'ERR_CERT_VERIFIER_CHANGED'])

/** Electron's code for a failed load, from the error it rejects loadURL with: "ERR_… (-105) loading '<url>'". */
function loadFailureCode(error: Error): string | undefined {
  const code = (error as Error & { code?: unknown }).code
  if (typeof code === 'string' && /^ERR_[A-Z0-9_]+$/.test(code)) return code
  return /^(ERR_[A-Z0-9_]+) \(-\d+\) loading\b/.exec(error.message)?.[1]
}

/**
 * A failed page load as a person reads it. A common network failure, or a
 * certificate the site presented that Hronaut does not trust, becomes a
 * sentence that ends with its code and leaves out the address; its message
 * stays Electron's, for MCP results and the code that reads it, and so do
 * the code, errno and url Electron gave. Any other failure is returned as it
 * is, so a person sees Electron's text.
 */
export function localizedLoadFailure(error: unknown): unknown {
  if (!(error instanceof Error) || error instanceof LocalizedError) return error
  const code = loadFailureCode(error)
  if (!code) return error
  const key = Object.hasOwn(LOAD_FAILURE_MESSAGES, code)
    ? LOAD_FAILURE_MESSAGES[code]
    : code.startsWith('ERR_CERT_') && !NOT_SITE_CERTIFICATE_FAILURES.has(code) ? 'appErrors.loadFailure.certificate' : undefined
  if (!key) return error
  const localized = new LocalizedError(key, { code }, { message: error.message, cause: error })
  const electron = error as Error & { code?: unknown; errno?: unknown; url?: unknown }
  // Only the details Electron gave, so a missing one stays absent rather than undefined.
  for (const detail of ['code', 'errno', 'url'] as const) {
    if (electron[detail] !== undefined) Object.assign(localized, { [detail]: electron[detail] })
  }
  return localized
}
