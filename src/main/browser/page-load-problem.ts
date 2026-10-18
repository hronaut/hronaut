import { translate, type MessageKey } from '../../shared/i18n.js'
import type { SupportedLocale } from '../../shared/locale.js'
import type { BrowserPageProblem } from '../../shared/types.js'

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
