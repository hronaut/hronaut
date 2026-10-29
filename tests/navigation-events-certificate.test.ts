import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
// The certificate each case says the tab refused for its page, which the browser keeps when it answers Chromium.
const { certificateRefusal } = vi.hoisted(() => ({ certificateRefusal: vi.fn<(webContents: object, url: string) => unknown>() }))
vi.mock('../src/main/browser/certificate-errors/certificate-errors.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/certificate-errors/certificate-errors.js')>(),
  certificateRefusal
}))
import { attachNavigationEvents } from '../src/main/browser/tab-events/navigation-events.js'

const PAGE = 'https://staging.example/login'

/** A stand-in for whatever the handlers call on the tab manager: any call or property gives another stand-in. */
function anything(): unknown {
  const stand: unknown = new Proxy(() => undefined, {
    get: (_target, key) => key === 'then' ? undefined : stand,
    apply: () => stand
  })
  return stand
}

/** A tab whose page failed to load, and the certificate the tab refused for it, if any. */
function tabWithRefusal(refusal?: { host: string; canProceed?: boolean; locked?: 'strict' | 'blocked' }) {
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => PAGE,
    getTitle: () => '',
    isLoading: () => false,
    isLoadingMainFrame: () => false,
    isDestroyed: () => false
  })
  const tab = {
    id: 'tab', url: 'about:blank', title: 'New tab', loading: true, sleeping: false,
    discoveryTitle: anything(), navigationGeneration: 0, documentGeneration: 0, faviconRequestId: 0, pendingHistoryUrl: null as string | null,
    suppressInitialHistory: false, navigationPolicyDenialSequence: 0, emulationContextGeneration: 0,
    pageProblem: undefined as unknown, consoleMessages: [], webContents: contents
  }
  certificateRefusal.mockReset().mockImplementation((_webContents, url) => (refusal && url === PAGE ? refusal : undefined))
  const answerCertificateError = vi.fn()
  const own: Record<string, unknown> = {
    answerCertificateError,
    options: { getLocale: () => 'en-US' },
    destroyed: false
  }
  const fallback = anything() as Record<string | symbol, unknown>
  const browser = new Proxy({}, { get: (_target, key) => (typeof key === 'string' && key in own ? own[key] : fallback[key]) })
  attachNavigationEvents(browser as never, tab as never, contents as never)
  const fail = (errorCode: number, errorDescription: string, isMainFrame = true) => {
    contents.emit('did-fail-load', {}, errorCode, errorDescription, PAGE, isMainFrame)
  }
  return { tab, contents, fail, answerCertificateError }
}

describe('a page whose website presented a certificate the tab refused', () => {
  it('passes every certificate error to the tab manager, which answers Chromium', () => {
    const { tab, contents, answerCertificateError } = tabWithRefusal()
    const event = { preventDefault: vi.fn() }
    const callback = vi.fn()
    contents.emit('certificate-error', event, PAGE, 'net::ERR_CERT_AUTHORITY_INVALID', { fingerprint: 'sha256/abc=' }, callback, true)
    expect(answerCertificateError).toHaveBeenCalledExactlyOnceWith(tab, event, PAGE, 'net::ERR_CERT_AUTHORITY_INVALID', { fingerprint: 'sha256/abc=' }, callback, true)
  })

  it('shows Chrome’s privacy error, with the choice to open it anyway only where the person may', () => {
    for (const [refusal, message, canProceed] of [
      [{ host: 'staging.example', canProceed: true }, 'Someone might be trying to steal your information from staging.example', true],
      [{ host: 'staging.example' }, 'Someone might be trying to steal your information from staging.example', false],
      [{ host: 'staging.example', canProceed: false, locked: 'strict' }, 'staging.example accepts only secure connections', false],
      [{ host: 'staging.example', canProceed: false, locked: 'blocked' }, 'You cannot open staging.example', false]
    ] as const) {
      const { tab, fail } = tabWithRefusal(refusal)
      fail(-202, 'ERR_CERT_AUTHORITY_INVALID')
      expect(tab.title).toBe('Privacy error')
      expect(tab.pageProblem).toMatchObject({
        kind: 'load-error',
        title: 'Your connection is not private',
        url: PAGE,
        errorCode: -202,
        errorDescription: 'ERR_CERT_AUTHORITY_INVALID',
        certificate: { host: 'staging.example', canProceed }
      })
      expect((tab.pageProblem as { message: string }).message).toContain(message)
    }
  })

  it('shows the usual load error for another failure, or a certificate error the tab kept nothing for', () => {
    for (const [refusal, errorCode, description] of [
      [{ host: 'staging.example', canProceed: true }, -105, 'ERR_NAME_NOT_RESOLVED'],
      [undefined, -202, 'ERR_CERT_AUTHORITY_INVALID']
    ] as const) {
      const { tab, contents, fail } = tabWithRefusal(refusal)
      fail(errorCode, description)
      expect(tab.title, description).toBe('Site unavailable')
      expect(tab.pageProblem, description).toMatchObject({ title: 'This site could not be reached', errorDescription: description })
      expect(tab.pageProblem, description).not.toHaveProperty('certificate')
      if (description !== 'ERR_NAME_NOT_RESOLVED') expect(certificateRefusal).toHaveBeenCalledWith(contents, PAGE)
    }
  })
})
