import { describe, expect, it } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { localizedLoadFailure } from '../src/main/browser/load-failure-error.js'
import { navigate } from '../src/main/browser/page-navigation/page-navigation.js'
import { LocalizedError, personErrorMessage, withTranslatedIpcErrors } from '../src/main/localized-error.js'
import { translate } from '../src/shared/i18n.js'

const SHELL_URL = 'http://127.0.0.1:5173/'
const english = (key: Parameters<typeof translate>[1], parameters?: Parameters<typeof translate>[2]) => translate('en-US', key, parameters)
const ukrainian = (key: Parameters<typeof translate>[1], parameters?: Parameters<typeof translate>[2]) => translate('uk-UA', key, parameters)

/** The error Electron rejects loadURL with when a load fails. */
function electronLoadError(code: string, errno: number, url: string): Error {
  return Object.assign(new Error(`${code} (${errno}) loading '${url}'`), { code, errno, url })
}

describe('a failed page load as a person reads it', () => {
  it.each([
    ['ERR_NAME_NOT_RESOLVED', -105, 'Не вдалося знайти адресу сайту (ERR_NAME_NOT_RESOLVED).'],
    ['ERR_CONNECTION_REFUSED', -102, 'Сайт відхилив з’єднання (ERR_CONNECTION_REFUSED).'],
    ['ERR_INTERNET_DISCONNECTED', -106, 'Схоже, пристрій не в мережі (ERR_INTERNET_DISCONNECTED).'],
    ['ERR_TIMED_OUT', -7, 'Сайт надто довго не відповідав (ERR_TIMED_OUT).'],
    ['ERR_CONNECTION_TIMED_OUT', -118, 'Сайт надто довго не відповідав (ERR_CONNECTION_TIMED_OUT).'],
    ['ERR_CONNECTION_RESET', -101, 'З’єднання скинуто під час завантаження сторінки (ERR_CONNECTION_RESET).'],
    ['ERR_NAME_RESOLUTION_FAILED', -137, 'Не вдалося визначити адресу сайту (ERR_NAME_RESOLUTION_FAILED).'],
    ['ERR_ADDRESS_UNREACHABLE', -109, 'Не вдалося зв’язатися з адресою (ERR_ADDRESS_UNREACHABLE).'],
    ['ERR_CONNECTION_CLOSED', -100, 'З’єднання закрилося до отримання сторінки (ERR_CONNECTION_CLOSED).'],
    ['ERR_EMPTY_RESPONSE', -324, 'Сайт не надіслав жодних даних (ERR_EMPTY_RESPONSE).'],
    ['ERR_CERT_AUTHORITY_INVALID', -202, 'Hronaut не довіряє сертифікату безпеки цього сайту (ERR_CERT_AUTHORITY_INVALID).'],
    ['ERR_CERT_DATE_INVALID', -201, 'Hronaut не довіряє сертифікату безпеки цього сайту (ERR_CERT_DATE_INVALID).']
  ] as const)('names %s in a sentence and keeps Electron’s error for agents', (code, errno, inUkrainian) => {
    const raw = electronLoadError(code, errno, 'https://private.example/account?token=secret')
    const failure = localizedLoadFailure(raw) as LocalizedError & { code: unknown; errno: unknown; url: unknown }

    expect(failure).toBeInstanceOf(LocalizedError)
    expect(failure.message).toBe(`${code} (${errno}) loading 'https://private.example/account?token=secret'`)
    expect([failure.code, failure.errno, failure.url, failure.cause]).toEqual([code, errno, 'https://private.example/account?token=secret', raw])
    expect(personErrorMessage(failure, ukrainian)).toBe(inUkrainian)
    // English people read a sentence too: it still ends with the code, and leaves out the address.
    const inEnglish = personErrorMessage(failure, english)
    expect(inEnglish).toMatch(new RegExp(`\\(${code}\\)\\.$`))
    expect(inEnglish).not.toContain('private.example')
  })

  it('reads the code from the message when the error carries none, and adds no details Electron did not give', () => {
    const failure = localizedLoadFailure(new Error("ERR_NAME_NOT_RESOLVED (-105) loading 'https://example.invalid/'"))
    expect(personErrorMessage(failure, ukrainian)).toBe('Не вдалося знайти адресу сайту (ERR_NAME_NOT_RESOLVED).')
    expect(['code', 'errno', 'url'].filter((detail) => Object.hasOwn(failure as object, detail))).toEqual([])
  })

  it.each([
    ['ERR_CERT_DATABASE_CHANGED', -714],
    ['ERR_CERT_VERIFIER_CHANGED', -716]
  ] as const)('does not call %s an untrusted site certificate', (code, errno) => {
    // These report that the certificate store or verifier changed, not a problem with the site's certificate.
    const raw = electronLoadError(code, errno, 'https://example.test/')
    expect(localizedLoadFailure(raw)).toBe(raw)
    expect(personErrorMessage(localizedLoadFailure(raw), ukrainian)).toBe(`${code} (${errno}) loading 'https://example.test/'`)
  })

  it('leaves an unknown code, any other error and a translated error as they are', () => {
    const unknown = electronLoadError('ERR_SSL_PROTOCOL_ERROR', -107, 'https://example.test/')
    const other = new Error('The tab closed while waiting for the page.')
    const localized = new LocalizedError('appErrors.page.loadTimedOut')
    expect(localizedLoadFailure(unknown)).toBe(unknown)
    expect(personErrorMessage(localizedLoadFailure(unknown), ukrainian)).toBe("ERR_SSL_PROTOCOL_ERROR (-107) loading 'https://example.test/'")
    expect(localizedLoadFailure(other)).toBe(other)
    expect(localizedLoadFailure(localized)).toBe(localized)
    expect(localizedLoadFailure('ERR_CONNECTION_REFUSED')).toBe('ERR_CONNECTION_REFUSED')
  })
})

describe('a failed address bar load', () => {
  function navigationBrowser(failure: Error) {
    const tab = {
      id: 'tab',
      navigationPolicyDenialSequence: 0,
      webContents: { on: () => undefined, once: () => undefined, removeListener: () => undefined, isDestroyed: () => false, isCrashed: () => false, loadURL: () => Promise.reject(failure) }
    }
    return {
      tabs: new Map([[tab.id, tab]]),
      activeTabId: tab.id,
      options: {},
      prepareDiagnosticNavigation: () => undefined
    } as never
  }

  it('reaches the shell in its language and keeps Electron’s text for agents and websites', async () => {
    const raw = electronLoadError('ERR_CONNECTION_REFUSED', -102, 'http://127.0.0.1:3000/temporarily-unavailable')
    const thrown = await navigate(navigationBrowser(raw), 'http://127.0.0.1:3000/temporarily-unavailable').catch((error: unknown) => error)
    expect((thrown as Error).message).toBe("ERR_CONNECTION_REFUSED (-102) loading 'http://127.0.0.1:3000/temporarily-unavailable'")

    const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>()
    const ipcMain = { handle: (channel: string, listener: Parameters<IpcMain['handle']>[1]) => { handlers.set(channel, listener) }, on: () => ipcMain }
    withTranslatedIpcErrors(ipcMain as unknown as Pick<IpcMain, 'handle' | 'on'>, {
      isHronautPage: (event) => event.senderFrame?.url === SHELL_URL,
      text: ukrainian
    }).handle('browser:navigate', () => { throw thrown })
    const shown = (url: string) => Promise.resolve(handlers.get('browser:navigate')!({ senderFrame: { url } } as unknown as IpcMainInvokeEvent))
      .catch((error: unknown) => (error as Error).message)

    await expect(shown(SHELL_URL)).resolves.toBe('Сайт відхилив з’єднання (ERR_CONNECTION_REFUSED).')
    await expect(shown('https://site.example/')).resolves.toBe("ERR_CONNECTION_REFUSED (-102) loading 'http://127.0.0.1:3000/temporarily-unavailable'")
    // The English shell notice keeps the code the shell's own test looks for.
    expect(personErrorMessage(thrown, english)).toBe('The website refused the connection (ERR_CONNECTION_REFUSED).')
  })
})
