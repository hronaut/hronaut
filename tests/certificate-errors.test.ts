import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  acceptsOnlySecureConnections,
  answerCertificateError,
  certificateRefusal,
  contentLoaded,
  proceedPastCertificateError,
  showsUntrustedCertificate,
  trustRefusedCertificate,
  trustsRefusedCertificate,
  type CertificateQuestion,
  type StrictTransportProbe
} from '../src/main/browser/certificate-errors/certificate-errors.js'

const PAGE = 'https://staging.example/login'
const FINGERPRINT = 'sha256/abc='

type Outcome = { redirect: string } | { error: string } | 'response' | 'throw' | 'silent'

/** Chromium's answer to the request asking whether a host accepts only secure connections. */
function probeAnswering(outcome: Outcome) {
  const urls: string[] = []
  const requests: Array<{ abort: ReturnType<typeof vi.fn> }> = []
  const probe = vi.fn((_session: object, url: string): StrictTransportProbe => {
    urls.push(url)
    if (outcome === 'throw') throw new Error('No session')
    const request: EventEmitter & { abort: ReturnType<typeof vi.fn>, end(): void } = Object.assign(new EventEmitter(), {
      abort: vi.fn(() => { request.emit('abort'); request.emit('close') }),
      // As Electron does, the request closes once it is sent, and Chromium answers a moment later.
      end: () => {
        request.emit('finish')
        request.emit('close')
        if (outcome === 'silent') return
        setTimeout(() => {
          if (outcome === 'response') request.emit('response')
          else if ('redirect' in outcome) request.emit('redirect', 307, 'GET', outcome.redirect, { 'Non-Authoritative-Reason': ['HSTS'] })
          else request.emit('error', new Error(outcome.error))
        }, 5)
      }
    })
    requests.push(request)
    return request as unknown as StrictTransportProbe
  })
  return { probe, urls, requests }
}

/** A tab in a workspace, and the certificate errors Chromium reports for it. */
function harness(outcome: Outcome = { error: 'net::ERR_UNSAFE_PORT' }, session: object = {}) {
  const { probe, urls, requests } = probeAnswering(outcome)
  const access = { probe, changed: vi.fn() }
  const tab: { url: string, documentGeneration: number, pageProblem?: { certificate?: object }, webContents: { session: object } } = {
    url: PAGE, documentGeneration: 0, webContents: { session }
  }
  const report = (url: string, options: { error?: string, fingerprint?: string, mainFrame?: boolean } = {}) => {
    const event = { preventDefault: vi.fn() }
    const callback = vi.fn()
    answerCertificateError(access, tab as never, event, url, options.error ?? 'net::ERR_CERT_AUTHORITY_INVALID',
      { fingerprint: options.fingerprint ?? FINGERPRINT }, callback, options.mainFrame ?? true)
    return { trusted: event.preventDefault.mock.calls.length > 0 && callback.mock.calls[0]?.[0] === true, answered: callback.mock.calls.length > 0 }
  }
  /** Lets Chromium answer whether the website accepts only secure connections. */
  const settled = () => new Promise((resolve) => setTimeout(resolve, 20))
  return { access, tab, report, settled, urls, requests, session }
}

describe('a certificate Chromium does not trust', () => {
  it('is refused for a page, which the tab keeps so the person can choose to open it, once Hronaut knows the website allows that', async () => {
    const { access, tab, report, settled, urls } = harness()
    expect(report(PAGE)).toEqual({ trusted: false, answered: false })
    expect(certificateRefusal(tab.webContents, PAGE)).toMatchObject({ host: 'staging.example', error: 'ERR_CERT_AUTHORITY_INVALID' })
    expect(certificateRefusal(tab.webContents, PAGE)?.canProceed).toBeUndefined()
    await settled()
    expect(urls).toEqual(['http://staging.example:1/'])
    expect(certificateRefusal(tab.webContents, PAGE)).toMatchObject({ canProceed: true })
    expect(access.changed).toHaveBeenCalledOnce()
    expect(certificateRefusal(tab.webContents, 'https://staging.example/other')).toBeUndefined()
  })

  it('cannot be opened anyway for a website that accepts only secure connections, nor when revoked, unreadable or blocked, as in Chrome', async () => {
    const strict = harness({ redirect: 'https://bank.example:1/' })
    strict.report('https://bank.example/')
    await strict.settled()
    expect(certificateRefusal(strict.tab.webContents, 'https://bank.example/')).toMatchObject({ canProceed: false, locked: 'strict' })
    for (const error of ['net::ERR_CERT_REVOKED', 'net::ERR_CERT_INVALID', 'net::ERR_CERT_KNOWN_INTERCEPTION_BLOCKED']) {
      const blocked = harness()
      blocked.report(PAGE, { error })
      expect(certificateRefusal(blocked.tab.webContents, PAGE), error).toMatchObject({ canProceed: false, locked: 'blocked' })
      expect(blocked.urls, error).toEqual([])
      expect(() => trustRefusedCertificate(blocked.tab, certificateRefusal(blocked.tab.webContents, PAGE)!), error).toThrow()
    }
  })

  it('counts any answer but Chromium refusing port 1 as a website that accepts only secure connections', async () => {
    for (const outcome of [{ redirect: 'https://staging.example:1/' }, { error: 'net::ERR_FAILED' }, 'response', 'throw'] as const) {
      const { access, requests, session } = harness(outcome)
      await expect(acceptsOnlySecureConnections(access, session, 'staging.example'), JSON.stringify(outcome)).resolves.toBe(true)
      // A request Chromium let through to the website goes no further.
      if (outcome === 'response' || typeof outcome === 'object' && 'redirect' in outcome) expect(requests[0]!.abort, JSON.stringify(outcome)).toHaveBeenCalled()
    }
    // A request Chromium never answers counts as strict, after a while.
    vi.useFakeTimers()
    try {
      const { access, requests, session } = harness('silent')
      const answer = acceptsOnlySecureConnections(access, session, 'staging.example')
      await vi.advanceTimersByTimeAsync(4_999)
      let settled = false
      void answer.then(() => { settled = true })
      await Promise.resolve()
      expect(settled).toBe(false)
      expect(requests[0]!.abort).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await expect(answer).resolves.toBe(true)
      expect(requests[0]!.abort).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
    const { access, session } = harness()
    await expect(acceptsOnlySecureConnections(access, session, 'staging.example')).resolves.toBe(false)
  })

  it('makes a page not private while the tab refuses its certificate, and a page that loaded content the person chose to trust it for', async () => {
    const { access, tab, report, settled } = harness()
    expect(showsUntrustedCertificate(tab)).toBe(false)
    tab.pageProblem = { certificate: {} }
    expect(showsUntrustedCertificate(tab)).toBe(true)
    report(PAGE)
    await settled()
    trustRefusedCertificate(tab, certificateRefusal(tab.webContents, PAGE)!)
    access.changed.mockClear()
    // Another website's page, with a certificate Chromium trusts, loads a frame and a script of the website the person
    // chose to trust; content from any other website changes nothing.
    Object.assign(tab, { url: 'https://intranet.example/', pageProblem: undefined, documentGeneration: 1 })
    contentLoaded(access, tab, 'https://cdn.example/app.js')
    contentLoaded(access, tab, 'http://staging.example/plain.js')
    expect(showsUntrustedCertificate(tab)).toBe(false)
    contentLoaded(access, tab, 'https://staging.example/frame')
    expect(showsUntrustedCertificate(tab)).toBe(true)
    contentLoaded(access, tab, 'https://staging.example/app.js')
    expect(access.changed).toHaveBeenCalledOnce()
    // The next page the tab shows is private again, until it loads such content too; another workspace's tab never is.
    tab.documentGeneration = 2
    expect(showsUntrustedCertificate(tab)).toBe(false)
    contentLoaded(access, tab, 'https://staging.example/app.js')
    expect(showsUntrustedCertificate(tab)).toBe(true)
    expect(access.changed).toHaveBeenCalledTimes(2)
    const other = harness()
    contentLoaded(other.access, other.tab, 'https://staging.example/app.js')
    expect(showsUntrustedCertificate(other.tab)).toBe(false)
    expect(other.access.changed).not.toHaveBeenCalled()
  })

  it('tells the tab only of the refusal it keeps for its page, once Hronaut knows whether the person may open it', async () => {
    const { access, tab, report, settled } = harness()
    // The website presents another certificate before Hronaut knew about the first.
    report(PAGE)
    report(PAGE, { fingerprint: 'sha256/new=' })
    await settled()
    expect(access.changed).toHaveBeenCalledOnce()
    expect(certificateRefusal(tab.webContents, PAGE)).toMatchObject({ fingerprint: 'sha256/new=', canProceed: true })
  })

  it('cannot be trusted when the person may not open its page anyway', () => {
    const workspace = {}
    const tab = { webContents: { session: workspace } }
    for (const canProceed of [false, undefined]) {
      expect(() => trustRefusedCertificate(tab, { url: PAGE, host: 'staging.example', error: 'ERR_CERT_AUTHORITY_INVALID', fingerprint: FINGERPRINT, canProceed })).toThrow()
    }
    expect(trustsRefusedCertificate(workspace, PAGE)).toBe(false)
  })

  it('is refused for a frame or request without keeping anything for the tab', () => {
    const { tab, report, urls } = harness()
    expect(report(PAGE, { mainFrame: false })).toEqual({ trusted: false, answered: false })
    expect(certificateRefusal(tab.webContents, PAGE)).toBeUndefined()
    expect(urls).toEqual([])
  })

  it('is trusted once the person chose to, for that host, certificate and error in the workspace, for the page and its requests', async () => {
    const workspace = {}
    const { tab, report, settled } = harness(undefined, workspace)
    report(PAGE)
    await settled()
    expect(trustsRefusedCertificate(workspace, PAGE)).toBe(false)
    trustRefusedCertificate(tab, certificateRefusal(tab.webContents, PAGE)!)
    expect(report('https://staging.example/next')).toEqual({ trusted: true, answered: true })
    expect(report('https://staging.example/app.js', { mainFrame: false })).toEqual({ trusted: true, answered: true })
    expect(trustsRefusedCertificate(workspace, 'https://staging.example/anything')).toBe(true)
    // Another certificate, error, host or workspace is not.
    expect(report(PAGE, { fingerprint: 'sha256/other=' }).trusted).toBe(false)
    expect(report(PAGE, { error: 'net::ERR_CERT_DATE_INVALID' }).trusted).toBe(false)
    expect(report('https://other.example/').trusted).toBe(false)
    expect(trustsRefusedCertificate(workspace, 'https://other.example/')).toBe(false)
    expect(trustsRefusedCertificate(workspace, 'http://staging.example/')).toBe(false)
    const elsewhere = harness(undefined, {})
    expect(elsewhere.report(PAGE).trusted).toBe(false)
  })
})

describe('opening a page anyway after its certificate was refused', () => {
  /** A tab in a workspace whose page's certificate was refused, and the person's answer to Hronaut's question. */
  async function refusedPage(outcome: Outcome = { error: 'net::ERR_UNSAFE_PORT' }, error?: string) {
    const workspace = {}
    const { report, settled } = harness(outcome, workspace)
    const webContents = Object.assign(new EventEmitter(), { session: workspace, isDestroyed: () => false })
    const tab = { mcpGroupId: 'workspace-1', webContents }
    const questions: Array<CertificateQuestion & { answer(proceed: boolean): void }> = []
    const access = {
      confirm: vi.fn((question: CertificateQuestion) => new Promise<boolean>((resolve) => {
        questions.push({ ...question, answer: resolve })
        question.signal.addEventListener('abort', () => resolve(false))
      })),
      open: vi.fn(async () => undefined)
    }
    answerCertificateError({ probe: harness(outcome).access.probe, changed: vi.fn() }, tab as never, { preventDefault: vi.fn() }, PAGE,
      error ?? 'net::ERR_CERT_AUTHORITY_INVALID', { fingerprint: FINGERPRINT }, vi.fn(), true)
    await settled()
    return { tab, webContents, workspace, access, questions, report, settled }
  }

  it('asks the person, naming the website, the error and the workspace, then trusts the certificate and opens the page', async () => {
    const { access, questions, webContents, workspace } = await refusedPage()
    const proceeding = proceedPastCertificateError(access, { mcpGroupId: 'workspace-1', webContents } as never, PAGE)
    await Promise.resolve()
    expect(questions).toHaveLength(1)
    expect(questions[0]).toMatchObject({ host: 'staging.example', error: 'ERR_CERT_AUTHORITY_INVALID', workspaceId: 'workspace-1' })
    expect(trustsRefusedCertificate(workspace, PAGE)).toBe(false)
    questions[0]!.answer(true)
    await expect(proceeding).resolves.toBe(true)
    expect(trustsRefusedCertificate(workspace, PAGE)).toBe(true)
    expect(access.open).toHaveBeenCalledExactlyOnceWith(PAGE)
    expect([webContents.listenerCount('did-start-navigation'), webContents.listenerCount('destroyed')]).toEqual([0, 0])
  })

  it('trusts nothing and opens nothing when the person goes back or the question fails', async () => {
    for (const answer of ['back', 'throw'] as const) {
      const { access, questions, tab, workspace } = await refusedPage()
      if (answer === 'throw') access.confirm.mockRejectedValueOnce(new Error('No window'))
      const proceeding = proceedPastCertificateError(access, tab as never, PAGE)
      await Promise.resolve()
      questions[0]?.answer(false)
      await expect(proceeding, answer).resolves.toBe(false)
      expect(trustsRefusedCertificate(workspace, PAGE), answer).toBe(false)
      expect(access.open, answer).not.toHaveBeenCalled()
    }
  })

  it('never asks for a page the person cannot open anyway, or one the tab did not refuse', async () => {
    const strict = await refusedPage({ redirect: 'https://staging.example:1/' })
    await expect(proceedPastCertificateError(strict.access, strict.tab as never, PAGE)).resolves.toBe(false)
    const blocked = await refusedPage(undefined, 'net::ERR_CERT_REVOKED')
    await expect(proceedPastCertificateError(blocked.access, blocked.tab as never, PAGE)).resolves.toBe(false)
    const other = await refusedPage()
    await expect(proceedPastCertificateError(other.access, other.tab as never, 'https://staging.example/other')).resolves.toBe(false)
    for (const { access } of [strict, blocked, other]) expect(access.confirm).not.toHaveBeenCalled()
  })

  it('changes nothing when the tab starts another page or closes while the person is asked', async () => {
    for (const [event, args] of [
      ['did-start-navigation', [{ isMainFrame: true, isSameDocument: false }]],
      ['destroyed', []]
    ] as const) {
      const { access, questions, tab, webContents, workspace } = await refusedPage()
      const proceeding = proceedPastCertificateError(access, tab as never, PAGE)
      await Promise.resolve()
      // A frame's navigation or a same-document change keeps the question.
      webContents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
      webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
      expect(questions[0]!.signal.aborted, event).toBe(false)
      webContents.emit(event, ...args)
      expect(questions[0]!.signal.aborted, event).toBe(true)
      questions[0]!.answer(true)
      await expect(proceeding, event).resolves.toBe(false)
      expect(trustsRefusedCertificate(workspace, PAGE), event).toBe(false)
      expect(access.open, event).not.toHaveBeenCalled()
    }
  })

  it('changes nothing when the person chooses to proceed just after the tab started another page', async () => {
    const { access, questions, tab, webContents, workspace } = await refusedPage()
    // The person's answer was on its way as the question closed.
    access.confirm.mockImplementationOnce((question: CertificateQuestion) => new Promise<boolean>((resolve) => {
      questions.push({ ...question, answer: resolve })
    }))
    const proceeding = proceedPastCertificateError(access, tab as never, PAGE)
    await Promise.resolve()
    webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    questions[0]!.answer(true)
    await expect(proceeding).resolves.toBe(false)
    expect(trustsRefusedCertificate(workspace, PAGE)).toBe(false)
    expect(access.open).not.toHaveBeenCalled()
  })

  it('changes nothing when the tab refused another certificate for the page meanwhile', async () => {
    const { access, questions, tab, workspace } = await refusedPage()
    const proceeding = proceedPastCertificateError(access, tab as never, PAGE)
    await Promise.resolve()
    answerCertificateError({ probe: harness().access.probe, changed: vi.fn() }, tab as never, { preventDefault: vi.fn() }, PAGE,
      'net::ERR_CERT_AUTHORITY_INVALID', { fingerprint: 'sha256/new=' }, vi.fn(), true)
    questions[0]!.answer(true)
    await expect(proceeding).resolves.toBe(false)
    expect(trustsRefusedCertificate(workspace, PAGE)).toBe(false)
  })
})
