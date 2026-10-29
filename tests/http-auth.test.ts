import { EventEmitter } from 'node:events'
import type { AuthenticationResponseDetails, AuthInfo } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { answerHttpAuth, asksToSignIn, followSignIns, pageLoadTimedOut, type HttpAuthQuestion, type SignInAnswer } from '../src/main/browser/http-auth/http-auth.js'
import { navigate } from '../src/main/browser/page-navigation/page-navigation.js'
import { PAGE_LOAD_WAIT_MS } from '../src/main/browser/page-waits/page-load-limit.js'
import { ANSWERED_ELSEWHERE } from '../src/main/trusted-dialogs/trusted-dialogs.js'

const PAGE = 'https://intranet.example/reports'

/** A main-frame navigation as Electron reports it: started by the browser, or by a frame such as the page's own. */
function navigation(url: string, initiator: 'browser' | 'page' = 'page', options: { mainFrame?: boolean, sameDocument?: boolean } = {}) {
  return { url, isMainFrame: options.mainFrame ?? true, isSameDocument: options.sameDocument ?? false, ...(initiator === 'page' ? { initiator: {} } : {}) }
}

/** What Electron tells, once it started, of a page that a page, or its service worker, opens in the main frame. */
const PAGE_OPENS = { isMainFrame: true }

/**
 * A tab showing the page, in a workspace, whose questions to the person wait until the test answers them; Hronaut
 * follows its sign-ins as it creates it, as a tab the given tab's page opened, if any.
 */
function harness(shown = PAGE, session: object = {}, openedBy?: { webContents: object }) {
  const webContents = Object.assign(new EventEmitter(), { getURL: () => shown, isDestroyed: () => false, session })
  followSignIns(webContents as never, openedBy?.webContents as never)
  const tab = { sleeping: false, mcpGroupId: 'workspace-1', webContents }
  const questions: Array<HttpAuthQuestion & { answer(answer: SignInAnswer | null): void }> = []
  const access = {
    // As Hronaut's dialog does, a question that closes answers at once, with nobody's answer.
    askToSignIn: vi.fn((question: HttpAuthQuestion) => new Promise<SignInAnswer | null>((resolve) => {
      questions.push({ ...question, answer: resolve })
      question.signal.addEventListener('abort', () => resolve(null))
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
    // Every listener the question added is gone; the tab's guard keeps following its pages.
    for (const name of ['did-fail-provisional-load', 'did-fail-load', 'render-process-gone']) {
      expect(webContents.listenerCount(name), name).toBe(0)
    }
    expect(['did-start-navigation', 'will-frame-navigate', 'did-navigate', 'input-event', 'destroyed'].map(name => webContents.listenerCount(name))).toEqual([1, 1, 1, 1, 1])
  })

  it('warns that the password can be read on the way only for an unencrypted connection that leaves this computer', () => {
    for (const [url, secure] of [['https://intranet.example/', true], ['http://intranet.example/', false], ['http://localhost:8080/', true], ['http://127.0.0.1:3000/', true]] as const) {
      const { challenge, questions } = harness()
      challenge(url, { navigation: true, mainFrame: true })
      expect(questions[0]!.secure, url).toBe(secure)
    }
  })

  it('lets the website show its page without credentials when the person cancels', async () => {
    const { challenge, questions, settled } = harness()
    const page = challenge('http://intranet.example/', { navigation: true, mainFrame: true })
    expect(questions[0]!.secure).toBe(false)
    questions[0]!.answer('cancelled')
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

  it('asks for a page the browser opens in place of what the page it replaces asked', async () => {
    const { challenge, questions, settled, webContents } = harness()
    const old = challenge('https://intranet.example/api/a')
    // An agent opens another page while the question shows.
    webContents.emit('did-start-navigation', navigation('https://login.example/', 'browser'))
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

  it('never lets a page put a question of its own in place of the one that shows', async () => {
    const { challenge, questions, settled, webContents } = harness()
    const old = challenge('https://intranet.example/api/a')
    // The page opens another by itself while its question shows; the question closes, and nobody is asked.
    webContents.emit('did-start-navigation', navigation('https://login.example/'))
    webContents.emit('will-frame-navigate', PAGE_OPENS)
    const opened = challenge('https://login.example/', { navigation: true, mainFrame: true })
    expect(opened.taken).toBe(false)
    expect(questions).toHaveLength(1)
    expect(questions[0]!.signal.aborted).toBe(true)
    await settled()
    expect(old.callback).toHaveBeenCalledExactlyOnceWith()
    // The page it opened asks no more by itself either.
    expect(challenge('https://login.example/', { navigation: true, mainFrame: true }).taken).toBe(false)
  })

  it('never lets a page’s service worker put a question of its own in place of the one that shows', async () => {
    for (const asked of ['page', 'request'] as const) {
      const { challenge, questions, settled, webContents } = harness()
      webContents.emit('did-start-navigation', navigation(PAGE, 'browser'))
      if (asked === 'page') challenge(PAGE, { navigation: true, mainFrame: true })
      else challenge('https://intranet.example/api/a')
      // The page's service worker opens another while its question shows: it names no initiator as it starts, and
      // Electron tells of it as the page's own only after.
      webContents.emit('did-start-navigation', navigation('https://login.example/', 'browser'))
      webContents.emit('will-frame-navigate', PAGE_OPENS)
      expect(challenge('https://login.example/', { navigation: true, mainFrame: true }).taken, asked).toBe(false)
      expect(questions, asked).toHaveLength(1)
      expect(questions[0]!.signal.aborted, asked).toBe(true)
      await settled()
      webContents.emit('did-navigate', {}, 'https://login.example/')
      expect(challenge('https://intranet.example/api/a').taken, asked).toBe(false)
    }
  })

  it('closes the question for a page once another load starts, the load stops or fails, the tab closes or its page crashes', () => {
    for (const [event, args] of [
      ['did-start-navigation', [navigation('https://other.example/')]],
      // Electron reports a stopped load only as a provisional failure.
      ['did-fail-provisional-load', [{}, -3, 'ERR_ABORTED', PAGE, true]],
      ['did-fail-provisional-load', [{}, -105, 'ERR_NAME_NOT_RESOLVED', PAGE, true]],
      ['did-navigate', [{}, PAGE]],
      ['render-process-gone', [{}, { reason: 'crashed' }]],
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
    webContents.emit('did-start-navigation', navigation('https://intranet.example/next'))
    webContents.emit('did-start-navigation', navigation('https://intranet.example/frame', 'page', { mainFrame: false }))
    webContents.emit('did-fail-provisional-load', {}, -3, 'ERR_ABORTED', 'https://intranet.example/next', true)
    webContents.emit('did-fail-provisional-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://intranet.example/frame', false)
    webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://intranet.example/frame', false)
    // The page shown stops loading, as when the person stops it after it showed.
    webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', PAGE, true)
    expect(questions[0]!.signal.aborted).toBe(false)
    webContents.emit('did-navigate', {}, 'https://intranet.example/next')
    expect(questions[0]!.signal.aborted).toBe(true)
  })

  it('closes the question for the page shown once an error page replaces it', () => {
    const { challenge, questions, webContents } = harness()
    challenge('https://intranet.example/api/a')
    webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://intranet.example/next', true)
    expect(questions[0]!.signal.aborted).toBe(true)
  })

  it('cancels the requests when asking fails, throws or no window can show it, and asks again next time', async () => {
    for (const fail of ['reject', 'throw', 'no window'] as const) {
      const { access, challenge, questions, settled, webContents } = harness()
      if (fail === 'reject') access.askToSignIn.mockRejectedValueOnce(new Error('No window'))
      else if (fail === 'throw') access.askToSignIn.mockImplementationOnce(() => { throw new Error('No window') })
      const page = challenge(PAGE, { navigation: true, mainFrame: true })
      if (fail === 'no window') questions[0]!.answer(null)
      await settled()
      expect(page.callback, fail).toHaveBeenCalledExactlyOnceWith()
      expect(asksToSignIn(webContents), fail).toBe(false)
      // Nobody answered, so nothing is remembered and the next request asks.
      expect(challenge('https://intranet.example/api/poll').taken, fail).toBe(true)
    }
  })

  it('never asks again for a sign-in the person cancelled when the page asks by itself, the refusal page and its refreshes included', async () => {
    const { challenge, questions, settled, webContents } = harness()
    const opened = challenge(PAGE, { navigation: true, mainFrame: true })
    questions[0]!.answer('cancelled')
    await settled()
    expect(opened.callback).toHaveBeenCalledExactlyOnceWith()
    // The website's refusal page shows, and its requests ask again and again; Electron cancels each, and nobody is asked.
    webContents.emit('did-navigate', {}, PAGE)
    for (let attempt = 0; attempt < 3; attempt += 1) expect(challenge('https://intranet.example/api/poll').taken).toBe(false)
    // So does the page refreshing itself, or opening another of the website's pages, however often.
    for (let refresh = 0; refresh < 3; refresh += 1) {
      webContents.emit('did-start-navigation', navigation(PAGE))
      expect(challenge(PAGE, { navigation: true, mainFrame: true }).taken).toBe(false)
      webContents.emit('did-navigate', {}, PAGE)
    }
    // Nor does another of its realms, or another website it opens, which a page could take turns with to ask again.
    expect(challenge('https://intranet.example/admin', { realm: 'Admin' }).taken).toBe(false)
    expect(challenge('https://intranet.example/admin', { scheme: 'digest' }).taken).toBe(false)
    webContents.emit('did-start-navigation', navigation('https://other.example/'))
    expect(challenge('https://other.example/', { navigation: true, mainFrame: true, realm: 'Other' }).taken).toBe(false)
    // A page leaving for another website and coming back asks no more.
    webContents.emit('did-start-navigation', navigation(PAGE))
    expect(challenge(PAGE, { navigation: true, mainFrame: true }).taken).toBe(false)
    // A page its service worker opens names no initiator, and Electron tells of it as the page's own, first, even when
    // the workspace refuses it and never tells of it again; a page opening in a frame meanwhile changes nothing.
    webContents.emit('did-start-navigation', navigation(PAGE, 'browser'))
    webContents.emit('will-frame-navigate', PAGE_OPENS)
    expect(challenge(PAGE, { navigation: true, mainFrame: true }).taken).toBe(false)
    webContents.emit('did-start-navigation', navigation('mailto:ada@intranet.example', 'browser'))
    webContents.emit('will-frame-navigate', PAGE_OPENS)
    webContents.emit('did-fail-provisional-load', {}, -3, 'ERR_ABORTED', 'mailto:ada@intranet.example', true)
    expect(challenge('https://intranet.example/api/poll').taken).toBe(false)
    webContents.emit('did-start-navigation', navigation(PAGE, 'browser'))
    webContents.emit('will-frame-navigate', { isMainFrame: false })
    expect(challenge(PAGE, { navigation: true, mainFrame: true }).taken).toBe(true)
    questions.at(-1)!.answer('cancelled')
    await settled()
    // A same-document change or a frame's navigation changes nothing.
    webContents.emit('did-start-navigation', navigation(`${PAGE}#top`, 'browser', { sameDocument: true }))
    webContents.emit('did-start-navigation', navigation('https://intranet.example/frame', 'browser', { mainFrame: false }))
    expect(challenge('https://intranet.example/api/poll').taken).toBe(false)
    expect(questions).toHaveLength(2)
  })

  it('asks again for a sign-in the person cancelled once they or an agent open a page in the tab', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const later = (ms: number): void => { vi.setSystemTime(Date.now() + ms) }
    try {
      const { challenge, questions, settled, webContents } = harness()
      const cancel = async (): Promise<void> => {
        questions.at(-1)!.answer('cancelled')
        await settled()
        expect(challenge('https://intranet.example/api/poll').taken).toBe(false)
      }
      const pageOpens = (initiator: 'browser' | 'page' = 'page'): boolean => {
        webContents.emit('did-start-navigation', navigation('https://intranet.example/next', initiator))
        if (initiator === 'page') webContents.emit('will-frame-navigate', PAGE_OPENS)
        return challenge('https://intranet.example/next', { navigation: true, mainFrame: true }).taken
      }
      challenge('https://intranet.example/api/poll')
      await cancel()
      // The address field, Reload, Back and an agent's navigation start the page in the browser.
      expect(pageOpens('browser')).toBe(true)
      await cancel()
      // A link the person follows opens just after they click or press a key in the page.
      webContents.emit('input-event', {}, { type: 'mouseDown' })
      expect(pageOpens()).toBe(true)
      await cancel()
      webContents.emit('input-event', {}, { type: 'rawKeyDown', key: 'Enter', isAutoRepeat: false })
      later(1_000)
      expect(pageOpens()).toBe(true)
      await cancel()
      // A click held a while ends when the person lets go.
      webContents.emit('input-event', {}, { type: 'mouseDown' })
      later(3_000)
      webContents.emit('input-event', {}, { type: 'mouseUp' })
      expect(pageOpens()).toBe(true)
      await cancel()
      // Moving the mouse is not clicking, Escape and a held key's repeats are no key, and a page opening a while after
      // the click is the page's own.
      webContents.emit('input-event', {}, { type: 'mouseMove' })
      expect(pageOpens()).toBe(false)
      webContents.emit('input-event', {}, { type: 'rawKeyDown', key: 'Escape', isAutoRepeat: false })
      expect(pageOpens()).toBe(false)
      webContents.emit('input-event', {}, { type: 'rawKeyDown', key: 'Enter', isAutoRepeat: true })
      expect(pageOpens()).toBe(false)
      webContents.emit('input-event', {}, { type: 'mouseDown' })
      later(1_001)
      expect(pageOpens()).toBe(false)
      // A click before the person cancelled does not count for a page opened after it.
      expect(pageOpens('browser')).toBe(true)
      webContents.emit('input-event', {}, { type: 'mouseDown' })
      await cancel()
      expect(pageOpens()).toBe(false)
      // A click lets the page it opens ask once: that page cannot open another by itself to ask again.
      webContents.emit('input-event', {}, { type: 'mouseDown' })
      expect(pageOpens()).toBe(true)
      expect(pageOpens()).toBe(false)
      // So does a page its service worker opens just after the click.
      await cancel()
      webContents.emit('input-event', {}, { type: 'mouseDown' })
      webContents.emit('did-start-navigation', navigation('https://intranet.example/next', 'browser'))
      webContents.emit('will-frame-navigate', PAGE_OPENS)
      expect(challenge('https://intranet.example/next', { navigation: true, mainFrame: true }).taken).toBe(true)
      expect(pageOpens()).toBe(false)
      expect(questions).toHaveLength(8)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps refusing once the refusal page of a sign-in the person cancelled shows, though they opened that page', async () => {
    const { challenge, questions, settled, webContents } = harness()
    webContents.emit('did-start-navigation', navigation(PAGE, 'browser'))
    challenge(PAGE)
    webContents.emit('did-start-navigation', navigation(PAGE, 'browser'))
    expect(challenge(PAGE, { navigation: true, mainFrame: true }).taken).toBe(true)
    questions.at(-1)!.answer('cancelled')
    await settled()
    // The website's refusal page shows in place of the page that asked.
    webContents.emit('did-navigate', {}, PAGE)
    expect(challenge('https://intranet.example/api/poll').taken).toBe(false)
  })

  it('lets the page the person or an agent opened ask again by itself once it shows, even when it did not ask as it opened', async () => {
    for (const opener of ['browser', 'click'] as const) {
      const { challenge, questions, settled, webContents } = harness()
      challenge('https://intranet.example/api/poll')
      questions[0]!.answer('cancelled')
      await settled()
      // A page that opened by itself and shows changes nothing.
      webContents.emit('did-start-navigation', navigation('https://intranet.example/next'))
      webContents.emit('did-navigate', {}, 'https://intranet.example/next')
      expect(challenge('https://intranet.example/api/poll').taken, opener).toBe(false)
      if (opener === 'click') webContents.emit('input-event', {}, { type: 'mouseDown' })
      webContents.emit('did-start-navigation', navigation('https://intranet.example/next', opener === 'browser' ? 'browser' : 'page'))
      // While it is on its way, the page shown still asks no more.
      expect(challenge('https://intranet.example/api/poll').taken, opener).toBe(false)
      webContents.emit('did-navigate', {}, 'https://intranet.example/next')
      expect(challenge('https://intranet.example/api/poll').taken, opener).toBe(true)
    }
  })

  it('lets a page the person or an agent opens while the page shown asks ask once it shows', async () => {
    const { challenge, questions, settled, webContents } = harness()
    challenge('https://intranet.example/api/poll')
    // The person opens another page while the page shown asks; it shows, and the question closes.
    webContents.emit('did-start-navigation', navigation('https://intranet.example/next', 'browser'))
    webContents.emit('did-navigate', {}, 'https://intranet.example/next')
    expect(questions[0]!.signal.aborted).toBe(true)
    await settled()
    expect(challenge('https://intranet.example/api/poll').taken).toBe(true)
  })

  it('lets a page an agent opens while the person is asked for the page shown ask, after they cancel that question', async () => {
    const { challenge, questions, settled, webContents } = harness()
    webContents.emit('did-start-navigation', navigation(PAGE, 'browser'))
    challenge('https://intranet.example/api/poll')
    webContents.emit('did-start-navigation', navigation(PAGE, 'browser'))
    webContents.emit('did-navigate', {}, PAGE)
    challenge('https://intranet.example/api/poll')
    // The agent's page starts while the person is asked; the page shown asked, so its question stays.
    webContents.emit('did-start-navigation', navigation('https://intranet.example/next', 'browser'))
    expect(questions[1]!.signal.aborted).toBe(false)
    questions[1]!.answer('cancelled')
    await settled()
    expect(challenge('https://intranet.example/api/poll').taken).toBe(false)
    expect(challenge('https://intranet.example/next', { navigation: true, mainFrame: true }).taken).toBe(true)
  })

  it('lets a page an agent opened ask once it shows, though the page shown asked while it was on its way and the person cancelled', async () => {
    const { challenge, questions, settled, webContents } = harness()
    webContents.emit('did-start-navigation', navigation(PAGE, 'browser'))
    webContents.emit('did-navigate', {}, PAGE)
    webContents.emit('did-start-navigation', navigation('https://intranet.example/next', 'browser'))
    challenge('https://intranet.example/api/poll')
    questions[0]!.answer('cancelled')
    await settled()
    expect(challenge('https://intranet.example/api/poll').taken).toBe(false)
    webContents.emit('did-navigate', {}, 'https://intranet.example/next')
    expect(challenge('https://intranet.example/api/poll').taken).toBe(true)
  })

  it('refuses for the tabs a page opened and the tab whose page opened them once the person cancels in any of them', async () => {
    const opener = harness()
    const popup = harness(PAGE, {}, opener)
    // A page opens a tab of its own, which asks as it opens; the person cancels.
    popup.webContents.emit('did-start-navigation', navigation(PAGE))
    expect(popup.challenge(PAGE, { navigation: true, mainFrame: true }).taken).toBe(true)
    popup.questions[0]!.answer('cancelled')
    await popup.settled()
    // The opener's page asks no more by itself, nor do the pages it opens, in the tab or in new tabs, nor theirs.
    expect(opener.challenge('https://intranet.example/api/poll').taken).toBe(false)
    opener.webContents.emit('did-start-navigation', navigation(PAGE))
    expect(opener.challenge(PAGE, { navigation: true, mainFrame: true }).taken).toBe(false)
    const next = harness(PAGE, {}, opener)
    next.webContents.emit('did-start-navigation', navigation(PAGE))
    expect(next.challenge(PAGE, { navigation: true, mainFrame: true }).taken).toBe(false)
    const third = harness(PAGE, {}, next)
    third.webContents.emit('did-start-navigation', navigation(PAGE))
    expect(third.challenge(PAGE, { navigation: true, mainFrame: true }).taken).toBe(false)
    // A page the person opens in one of them asks again there, and the others still refuse.
    popup.webContents.emit('did-start-navigation', navigation(PAGE, 'browser'))
    expect(popup.challenge(PAGE, { navigation: true, mainFrame: true }).taken).toBe(true)
    expect(opener.challenge('https://intranet.example/api/poll').taken).toBe(false)
    expect([opener, next, third].map(tab => tab.questions.length)).toEqual([0, 0, 0])

    // A Cancel in the opener reaches the tabs it opened before.
    const second = harness()
    const tab = harness(PAGE, {}, second)
    second.challenge('https://intranet.example/api/poll')
    second.questions[0]!.answer('cancelled')
    await second.settled()
    expect(tab.challenge('https://intranet.example/api/poll').taken).toBe(false)
    tab.webContents.emit('did-start-navigation', navigation(PAGE))
    expect(tab.challenge(PAGE, { navigation: true, mainFrame: true }).taken).toBe(false)
  })

  it('lets a tab a page opened just after a click or key in it ask, as a link the person follows does', async () => {
    const opener = harness()
    opener.challenge('https://intranet.example/api/poll')
    opener.questions[0]!.answer('cancelled')
    await opener.settled()
    for (const clicked of [false, true]) {
      if (clicked) opener.webContents.emit('input-event', {}, { type: 'mouseDown' })
      const popup = harness(PAGE, {}, opener)
      popup.webContents.emit('did-start-navigation', navigation(PAGE))
      expect(popup.challenge(PAGE, { navigation: true, mainFrame: true }).taken, String(clicked)).toBe(clicked)
    }
    // One click opens one tab, as in Chrome: a page cannot open a second that asks, nor open one in its own tab.
    opener.webContents.emit('input-event', {}, { type: 'mouseDown' })
    const first = harness(PAGE, {}, opener)
    const second = harness(PAGE, {}, opener)
    for (const tab of [first, second, opener]) tab.webContents.emit('did-start-navigation', navigation(PAGE))
    expect([first, second, opener].map(tab => tab.challenge(PAGE, { navigation: true, mainFrame: true }).taken)).toEqual([true, false, false])
    // Nor when the page the click opens in the tab starts before the tab it opens, or the new tab's page before it
    // opens another.
    opener.webContents.emit('input-event', {}, { type: 'mouseDown' })
    opener.webContents.emit('did-start-navigation', navigation(PAGE))
    const late = harness(PAGE, {}, opener)
    late.webContents.emit('did-start-navigation', navigation(PAGE))
    expect([opener, late].map(tab => tab.challenge(PAGE, { navigation: true, mainFrame: true }).taken)).toEqual([true, false])
    opener.webContents.emit('input-event', {}, { type: 'mouseDown' })
    const opened = harness(PAGE, {}, opener)
    opened.webContents.emit('did-start-navigation', navigation(PAGE))
    const further = harness(PAGE, {}, opened)
    further.webContents.emit('did-start-navigation', navigation(PAGE))
    expect([opened, further].map(tab => tab.challenge(PAGE, { navigation: true, mainFrame: true }).taken)).toEqual([true, false])
  })

  it('asks again, for a page the browser opens, after a question that closed before the person answered', async () => {
    const { challenge, questions, settled, webContents } = harness()
    challenge(PAGE, { navigation: true, mainFrame: true })
    webContents.emit('did-start-navigation', navigation('https://other.example/', 'browser'))
    // A late Cancel is not the person's answer to the question that closed.
    questions[0]!.answer('cancelled')
    await settled()
    expect(challenge('https://other.example/', { navigation: true, mainFrame: true }).taken).toBe(true)
  })

  it('refuses the sign-ins a page asks for by itself after it moved on while the person was asked, until a page opens that the browser opens', async () => {
    for (const [event, args] of [
      ['did-start-navigation', [navigation('https://other.example/')]],
      ['did-fail-provisional-load', [{}, -3, 'ERR_ABORTED', PAGE, true]],
      ['did-fail-load', [{}, -105, 'ERR_NAME_NOT_RESOLVED', PAGE, true]],
      ['did-navigate', [{}, PAGE]],
      ['render-process-gone', [{}, { reason: 'crashed' }]]
    ] as const) {
      const { challenge, questions, settled, webContents } = harness()
      challenge(PAGE, { navigation: true, mainFrame: true })
      webContents.emit(event, ...args)
      await settled()
      webContents.emit('did-start-navigation', navigation(PAGE))
      expect(challenge(PAGE, { navigation: true, mainFrame: true }).taken, event).toBe(false)
      expect(challenge('https://intranet.example/api/poll').taken, event).toBe(false)
      webContents.emit('did-start-navigation', navigation(PAGE, 'browser'))
      expect(challenge(PAGE, { navigation: true, mainFrame: true }).taken, event).toBe(true)
      expect(questions, event).toHaveLength(2)
    }
  })

  it('asks anew rather than letting a request join a question that already closed', async () => {
    const { challenge, questions, settled, webContents } = harness()
    const before = challenge('https://intranet.example/api/a')
    webContents.emit('did-start-navigation', navigation(PAGE, 'browser'))
    webContents.emit('did-navigate', {}, PAGE)
    // The closed question's answer has not reached its requests yet when the next page's request asks.
    const after = challenge('https://intranet.example/api/a')
    expect(after.taken).toBe(true)
    expect(questions).toHaveLength(2)
    questions[1]!.answer({ username: 'ada', password: 's3cret' })
    await settled()
    expect(before.callback).toHaveBeenCalledExactlyOnceWith()
    expect(after.callback).toHaveBeenCalledExactlyOnceWith('ada', 's3cret')
  })

  it('closes a request’s question once a page that joined it stops loading', () => {
    const { challenge, questions, webContents } = harness()
    challenge('https://intranet.example/api/a')
    challenge('https://intranet.example/api/a', { navigation: true, mainFrame: true })
    expect(asksToSignIn(webContents)).toBe(true)
    webContents.emit('did-fail-provisional-load', {}, -3, 'ERR_ABORTED', 'https://intranet.example/api/a', true)
    expect(questions[0]!.signal.aborted).toBe(true)
  })

  it('answers the workspace’s other tabs asking for the same sign-in with the person’s answer, as Chrome does', async () => {
    const workspace = {}
    const first = harness(PAGE, workspace)
    const second = harness(PAGE, workspace)
    const otherRealm = harness(PAGE, workspace)
    const otherWorkspace = harness(PAGE, {})
    const asked = [first, second, otherRealm, otherWorkspace].map((tab, index) => tab.challenge('https://intranet.example/api', { realm: index === 2 ? 'Admin' : 'Reports' }))
    first.questions[0]!.answer({ username: 'ada', password: 's3cret' })
    await first.settled()
    // It closes as answered, so the keyboard goes back to the page.
    expect(second.questions[0]!.signal.reason).toBe(ANSWERED_ELSEWHERE)
    expect(asked[1]!.callback).toHaveBeenCalledExactlyOnceWith('ada', 's3cret')
    expect(otherRealm.questions[0]!.signal.aborted).toBe(false)
    expect(otherWorkspace.questions[0]!.signal.aborted).toBe(false)
    expect(asked[2]!.callback).not.toHaveBeenCalled()
    expect(asked[3]!.callback).not.toHaveBeenCalled()

    // A Cancel counts for them too, and neither tab asks again for the page it shows.
    const third = harness(PAGE, workspace)
    const fourth = harness(PAGE, workspace)
    const cancelled = [third, fourth].map((tab) => tab.challenge('https://intranet.example/api', { realm: 'Billing' }))
    third.questions[0]!.answer('cancelled')
    await third.settled()
    expect(cancelled[1]!.callback).toHaveBeenCalledExactlyOnceWith()
    expect(fourth.challenge('https://intranet.example/api', { realm: 'Billing' }).taken).toBe(false)

    // A question nobody answered, as when no window could show it, answers nothing for the other tabs.
    const fifth = harness(PAGE, workspace)
    const sixth = harness(PAGE, workspace)
    const unanswered = [fifth, sixth].map((tab) => tab.challenge('https://intranet.example/api', { realm: 'Wiki' }))
    fifth.questions[0]!.answer(null)
    await fifth.settled()
    expect(unanswered[0]!.callback).toHaveBeenCalledExactlyOnceWith()
    expect(sixth.questions[0]!.signal.aborted).toBe(false)
    expect(unanswered[1]!.callback).not.toHaveBeenCalled()
    expect(fifth.challenge('https://intranet.example/api', { realm: 'Wiki' }).taken).toBe(true)
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

  it('says the page timed out when only a request of the page shown asks', () => {
    const { challenge, webContents } = harness()
    challenge('https://intranet.example/api/a')
    expect(asksToSignIn(webContents)).toBe(false)
    expect(pageLoadTimedOut(webContents).key).toBe('appErrors.page.loadTimedOut')
    webContents.emit('did-start-navigation', navigation('https://intranet.example/next', 'browser'))
    challenge('https://intranet.example/next', { navigation: true, mainFrame: true })
    expect(pageLoadTimedOut(webContents).key).toBe('appErrors.page.signInAsked')
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
