import type { MessageKey } from '../../shared/i18n.js'
import { LocalizedError } from '../localized-error.js'

/** The sentence for each common network error Chromium reports when a page load fails. */
const LOAD_FAILURE_MESSAGES: Record<string, MessageKey> = {
  ERR_NAME_NOT_RESOLVED: 'appErrors.loadFailure.nameNotResolved',
  ERR_CONNECTION_REFUSED: 'appErrors.loadFailure.connectionRefused',
  ERR_INTERNET_DISCONNECTED: 'appErrors.loadFailure.offline',
  ERR_TIMED_OUT: 'appErrors.loadFailure.timedOut',
  ERR_CONNECTION_TIMED_OUT: 'appErrors.loadFailure.timedOut',
  ERR_CONNECTION_RESET: 'appErrors.loadFailure.connectionReset'
}

/** Electron's code for a failed load, from the error it rejects loadURL with: "ERR_… (-105) loading '<url>'". */
function loadFailureCode(error: Error): string | undefined {
  const code = (error as Error & { code?: unknown }).code
  if (typeof code === 'string' && /^ERR_[A-Z0-9_]+$/.test(code)) return code
  return /^(ERR_[A-Z0-9_]+) \(-\d+\) loading\b/.exec(error.message)?.[1]
}

/**
 * A failed page load as a person reads it. A common network or certificate
 * failure becomes a sentence that ends with its code and leaves out the
 * address; its message stays Electron's, for MCP results and the code that
 * reads it, and so do its code, errno and url. Any other failure is returned
 * as it is, so a person sees Electron's text.
 */
export function localizedLoadFailure(error: unknown): unknown {
  if (!(error instanceof Error) || error instanceof LocalizedError) return error
  const code = loadFailureCode(error)
  if (!code) return error
  const key = Object.hasOwn(LOAD_FAILURE_MESSAGES, code)
    ? LOAD_FAILURE_MESSAGES[code]
    : code.startsWith('ERR_CERT_') ? 'appErrors.loadFailure.certificate' : undefined
  if (!key) return error
  const { code: electronCode, errno, url } = error as Error & { code?: unknown; errno?: unknown; url?: unknown }
  return Object.assign(new LocalizedError(key, { code }, { message: error.message, cause: error }), { code: electronCode, errno, url })
}
