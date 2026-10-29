import { translate, type MessageKey } from '../../shared/i18n.js'
import type { SupportedLocale } from '../../shared/locale.js'
import type { BrowserPageProblem } from '../../shared/types.js'
import type { CertificateRefusal } from './certificate-errors/certificate-errors.js'

/** The message explaining each network error Chromium reports for a failed page load. */
const LOAD_FAILURE_MESSAGES: Record<string, MessageKey> = {
  ERR_ADDRESS_UNREACHABLE: 'native.pageProblem.addressUnreachable',
  ERR_CONNECTION_CLOSED: 'native.pageProblem.connectionClosed',
  ERR_CONNECTION_REFUSED: 'native.pageProblem.connectionRefused',
  ERR_CONNECTION_RESET: 'native.pageProblem.connectionReset',
  ERR_INTERNET_DISCONNECTED: 'native.pageProblem.offline',
  ERR_NAME_NOT_RESOLVED: 'native.pageProblem.nameNotResolved',
  ERR_NETWORK_CHANGED: 'native.pageProblem.networkChanged',
  ERR_TIMED_OUT: 'native.pageProblem.timedOut'
}

/** The problem a tab shows after its page failed to load, localized, with the error code and description. */
export function loadFailureProblem(locale: SupportedLocale, url: string, errorCode: number, errorDescription: string): BrowserPageProblem {
  return {
    kind: 'load-error',
    title: translate(locale, 'native.pageProblem.loadTitle'),
    message: translate(locale, LOAD_FAILURE_MESSAGES[errorDescription] ?? 'native.pageProblem.loadDefault'),
    url,
    errorCode,
    errorDescription
  }
}

/**
 * The problem a tab shows after it refused the certificate a website presented for its page, as Chrome's privacy error
 * says it, and whether the person can open the page anyway: never for a website that accepts only secure connections,
 * or a certificate that was revoked, cannot be read or is blocked.
 */
export function certificateProblem(locale: SupportedLocale, url: string, errorCode: number, errorDescription: string,
  refusal: Pick<CertificateRefusal, 'host' | 'canProceed' | 'locked'>): BrowserPageProblem {
  const message: MessageKey = refusal.locked === 'strict'
    ? 'native.pageProblem.certificateStrict'
    : refusal.locked === 'blocked' ? 'native.pageProblem.certificateBlocked' : 'native.pageProblem.certificate'
  return {
    kind: 'load-error',
    title: translate(locale, 'native.pageProblem.certificateTitle'),
    message: translate(locale, message, { host: refusal.host }),
    url,
    errorCode,
    errorDescription,
    certificate: { host: refusal.host, canProceed: refusal.canProceed === true }
  }
}
