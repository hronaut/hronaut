import { EventEmitter } from 'node:events'
import type { AuthenticationResponseDetails, AuthInfo } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { answerHttpAuth, asksToSignIn, type HttpAuthQuestion } from '../src/main/browser/http-auth/http-auth.js'
import { navigate } from '../src/main/browser/page-navigation/page-navigation.js'
import { PAGE_LOAD_WAIT_MS } from '../src/main/browser/page-waits/page-load-limit.js'
import type { TrustedDialogCredentials } from '../src/shared/trusted-dialogs.js'

const PAGE = 'https://intranet.example/reports'

/** A tab showing the page, in a workspace, whose questions to the person wait until the test answers them. */
function harness(shown = PAGE) {
  const webContents = Object.assign(new EventEmitter(), { getURL: () => shown, isDestroyed: () => false })
  const tab = { sleeping: false, mcpGroupId: 'workspace-1', webContents }
  const questions: Array<HttpAuthQuestion & { answer(credentials: TrustedDialogCredentials | null): void }> = []
  const access = {
    askToSignIn: vi.fn((question: HttpAuthQuestion) => new Promise<TrustedDialogCredentials | null>((resolve) => {
      questions.push({ ...question, answer: resolve })
    }))
  }
  /** A challenge the page's request gets; returns whether Hronaut takes it and the request's callback. */
  const challenge = (url: string, options: { navigation?: boolean, mainFrame?: boolean, proxy?: boolean, realm?: string, scheme?: string } = {}) => {
    const event = { preventDefault: vi.fn() }
    const callback = vi.fn()
    const details = { url, pid: 1, isRequestForNavigation: options.navigation ?? false, firstAuthAttempt: true, isMainFrame: options.mainFrame ?? false } as AuthenticationResponseDetails
    const authInfo: AuthInfo = { isProxy: options.proxy ?? false, scheme: options.scheme ?? 'basic', host: new URL(url).hostname, port: 443, realm: options.realm ?? 'Reports' }
    answerHttpAuth(access, tab as never, event, details, authInfo, callback)
    return { taken: event.preventDefault.mock.calls.length > 0, callback }
  }
  /** Lets the answer reach the requests waiting for it. */
  const settled = () => new Promise((resolve) => setImmediate(resolve))
  return { webContents, tab, access, questions, challenge, settled }
}

describe('a website asking for a username and password', () => {
  it('asks the person for a page opened in the tab, naming the website and the workspace, and signs in with what they typed', async () => {
    const { challenge, questions, settled, webContents } = harness('https://start.example/')
    const page = challenge('https://intranet.example/reports?id=7', { navigation: true, mainFrame: true })
    expect(page.taken).toBe(true)
    expect(questions).toHaveLength(1)
    expect(questions[0]).toMatchObject({ origin: 'https://intranet.example', secure: true, workspaceId: 'workspace-1' })
    expect(asksToSignIn(webContents)).toBe(true)
    questions[0]!.answer({ username: 'ada', password: 's3cret' })
    await settled()
    expect(page.callback).toHaveBeenCalledExactlyOnceWith('ada', 's3cret')
    expect(asksToSignIn(webContents)).toBe(false)
    // Every listener the question added is gone.
    for (const name of ['did-start-navigation', 'did-fail-load', 'did-navigate', 'destroyed']) expect(webContents.listenerCount(name)).toBe(0)
  })

  it('lets the website show its page without credentials when the person cancels', async () => {
    const { challenge, questions, settled } = harness()
    const page = challenge('http://intranet.example/', { navigation: true, mainFrame: true })
    expect(questions[0]!.secure).toBe(false)
    questions[0]!.answer(null)
    await settled()
    expect(page.callback).toHaveBeenCalledExactlyOnceWith()
  })

  it('asks for a frame or request of the page’s own website, and never for another website’s, a proxy or a sleeping tab', () => {
    const { challenge, questions, tab } = harness()
    expect(challenge('https://ads.example/pixel').taken).toBe(false)
    expect(challenge('https://ads.example/frame', { navigation: true }).taken).toBe(false)
    expect(challenge('https://intranet.example/', { navigation: true, mainFrame: true, proxy: true }).taken).toBe(false)
    expect(challenge('ftp://intranet.example/').taken).toBe(false)
    tab.sleeping = true
    expect(challenge('https://intranet.example/', { navigation: true, mainFrame: true }).taken).toBe(false)
    tab.sleeping = false
    expect(questions).toHaveLength(0)
    expect(challenge('https://intranet.example/frame', { navigation: true }).taken).toBe(true)
    expect(questions).toHaveLength(1)
  })

  it('answers every request asking for the same sign-in with one question, and refuses another while it shows', async () => {
    const { challenge, questions, settled } = harness()
    const first = challenge('https://intranet.example/api/a')
    const second = challenge('https://intranet.example/api/b')
    const otherRealm = challenge('https://intranet.example/admin', { realm: 'Admin' })
    expect([first.taken, second.taken, otherRealm.taken]).toEqual([true, true, false])
    expect(questions).toHaveLength(1)
    questions[0]!.answer({ username: 'ada', password: 's3cret' })
    await settled()
    expect(first.callback).toHaveBeenCalledWith('ada', 's3cret')
    expect(second.callback).toHaveBeenCalledWith('ada', 's3cret')
    expect(otherRealm.callback).not.toHaveBeenCalled()
  })

  it('asks for a page that opens in place of what the page it replaces asked', async () => {
    const { challenge, questions, settled } = harness()
    const old = challenge('https://intranet.example/api/a')
    const opened = challenge('https://login.example/', { navigation: true, mainFrame: true })
    expect(opened.taken).toBe(true)
    expect(questions).toHaveLength(2)
    expect(questions[0]!.signal.aborted).toBe(true)
    // The closed question's late answer signs nothing in.
    questions[0]!.answer({ username: 'ada', password: 's3cret' })
    await settled()
    expect(old.callback).toHaveBeenCalledExactlyOnceWith()
    expect(questions[1]!.signal.aborted).toBe(false)
  })

  it('closes the question for a page once another load starts, the load ends or the tab closes', () => {
    for (const [event, args] of [
      ['did-start-navigation', [{}, 'https://other.example/', false, true]],
      ['did-fail-load', [{}, -3, 'ERR_ABORTED', PAGE, true]],
      ['did-navigate', [{}, PAGE]],
      ['destroyed', []]
    ] as const) {
      const { challenge, questions, webContents } = harness()
      challenge(PAGE, { navigation: true, mainFrame: true })
      webContents.emit(event, ...args)
      expect(questions[0]!.signal.aborted, event).toBe(true)
    }
  })

  it('keeps the question for the page shown while a frame navigates or a load that never commits is stopped, and closes it once another page replaces it', () => {
    const { challenge, questions, webContents } = harness()
    challenge('https://intranet.example/api/a')
    webContents.emit('did-start-navigation', {}, 'https://intranet.example/next', false, true)
    webContents.emit('did-start-navigation', {}, 'https://intranet.example/frame', false, false)
    webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://intranet.example/next', true)
    webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://intranet.example/frame', false)
    expect(questions[0]!.signal.aborted).toBe(false)
    webContents.emit('did-navigate', {}, 'https://intranet.example/next')
    expect(questions[0]!.signal.aborted).toBe(true)
  })

  it('cancels the requests when asking fails', async () => {
    const { access, challenge, settled, webContents } = harness()
    access.askToSignIn.mockRejectedValueOnce(new Error('No window'))
    const page = challenge(PAGE, { navigation: true, mainFrame: true })
    await settled()
    expect(page.callback).toHaveBeenCalledExactlyOnceWith()
    expect(asksToSignIn(webContents)).toBe(false)
  })
})

describe('an agent opening a page that asks the person to sign in', () => {
  /** A tab whose load waits for the person's answer, as Chromium holds a page that asks to sign in. */
  function signInPage() {
    const webContents = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      isCrashed: () => false,
      getURL: () => 'https://start.example/',
      loadURL: vi.fn(() => new Promise<void>(() => {}))
    })
    const tab = { id: 'tab', sleeping: false, navigationGeneration: 0, documentGeneration: 0, navigationPolicyDenialSequence: 0, webContents }
    const access = {
      getTab: () => tab,
      findTab: (id: string) => (id === tab.id ? tab : undefined),
      searchEngine: () => undefined,
      prepareDiagnosticNavigation: vi.fn(),
      confirmLeavePage: vi.fn(),
      getState: () => ({ ok: true })
    }
    return { tab, webContents, go: () => navigate(access as never, PAGE, undefined, { byPerson: false }) }
  }

  it('tells the agent the person was asked to sign in, rather than that the page timed out', async () => {
    vi.useFakeTimers()
    try {
      const { tab, go } = signInPage()
      const opening = go()
      const outcome = expect(opening).rejects.toMatchObject({ key: 'appErrors.page.signInAsked', message: expect.stringContaining('Hronaut asked the person to sign in') })
      answerHttpAuth({ askToSignIn: () => new Promise(() => {}) }, tab as never, { preventDefault: vi.fn() },
        { url: PAGE, pid: 1, isRequestForNavigation: true, firstAuthAttempt: true, isMainFrame: true } as AuthenticationResponseDetails,
        { isProxy: false, scheme: 'basic', host: 'intranet.example', port: 443, realm: 'Reports' }, vi.fn())
      await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS)
      await outcome
    } finally {
      vi.useRealTimers()
    }
  })

  it('still says the page timed out when nothing asks', async () => {
    vi.useFakeTimers()
    try {
      const opening = signInPage().go()
      const outcome = expect(opening).rejects.toMatchObject({ key: 'appErrors.page.loadTimedOut' })
      await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS)
      await outcome
    } finally {
      vi.useRealTimers()
    }
  })
})
