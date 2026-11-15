import { describe, expect, it, vi } from 'vitest'
import type { Browser } from '../src/main/browser/browser.js'
import { back, forward, navigate, reload, reloadIgnoringCache, stop } from '../src/main/browser/page-navigation/page-navigation.js'
import { PAGE_DESTROYED_REASON } from '../src/shared/types/page-problems.js'

// The fixture below decides what happens while a workspace's session cookies come back.
const cookies = vi.hoisted(() => ({ restored: (): void => undefined }))
vi.mock('../src/main/browser/session-cookies/saved-session-cookies.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/session-cookies/saved-session-cookies.js')>(),
  keepSessionCookies: async () => { cookies.restored() }
}))

// A tab whose page Electron destroyed while the tab stayed open shows that the page is gone. A reload from its tab menu,
// and an agent's navigation, reload or stop in it, then called the destroyed page and failed with Electron's English
// "Object has been destroyed", and a reload cleared what the tab showed first.

const ACTIONS: [string, (browser: Browser) => unknown][] = [
  ['a person\'s reload', (browser) => reload(browser, 'tab', { byPerson: true })],
  ['a reload ignoring the cache', (browser) => reloadIgnoringCache(browser, 'tab')],
  ['an agent\'s navigation', (browser) => navigate(browser, 'https://example.test/next', 'tab')],
  ['Back', (browser) => back(browser, 'tab')],
  ['Forward', (browser) => forward(browser, 'tab')]
]

/**
 * A sleeping tab whose page is destroyed now, or, as Electron can destroy it later, as the tab wakes, as its wake then
 * fails, or, in a tab awake, as its workspace's session cookies come back.
 */
function tabWithDestroyedPage(options: { during?: 'wake' | 'failed wake' | 'cookies' } = {}) {
  let pageDestroyed = !options.during
  const destroyed = () => { throw new TypeError('Object has been destroyed') }
  const webContents = {
    isDestroyed: () => pageDestroyed,
    loadURL: vi.fn(destroyed),
    reload: vi.fn(destroyed),
    reloadIgnoringCache: vi.fn(destroyed),
    stop: vi.fn(destroyed),
    navigationHistory: { canGoBack: vi.fn(destroyed), canGoForward: vi.fn(destroyed), goBack: vi.fn(destroyed), goForward: vi.fn(destroyed) }
  }
  const pageProblem = {
    kind: 'renderer-gone',
    title: 'This page is no longer available',
    message: 'Close this tab and reopen it from Recently closed.',
    url: 'https://example.test/app',
    reason: PAGE_DESTROYED_REASON
  }
  const tab = {
    id: 'tab', url: 'https://example.test/app', sleeping: options.during !== 'cookies',
    pageProblem: options.during ? undefined : pageProblem as typeof pageProblem | undefined, webContents
  }
  // Electron destroys the page, and the tab says so, as recoverFromDestroyedPage does.
  const destroy = (): void => {
    pageDestroyed = true
    tab.sleeping = false
    tab.pageProblem = pageProblem
  }
  cookies.restored = options.during === 'cookies' ? destroy : () => undefined
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: tab.id,
    options: {},
    rendererRecovery: { isRecovering: vi.fn(() => false) },
    prepareDiagnosticNavigation: vi.fn(),
    wakeTab: vi.fn(() => {
      destroy()
      return options.during === 'failed wake' ? Promise.reject(new TypeError('Object has been destroyed')) : Promise.resolve({})
    })
  } as unknown as Browser
  return { browser, tab, pageProblem, webContents }
}

const pageDestroyedFailure = {
  key: 'appErrors.navigation.pageDestroyed',
  message: 'This page is no longer available. Close this tab and reopen it from Recently closed.'
}

describe('a tab whose page was destroyed while it stayed open', () => {
  it.each([
    ...ACTIONS,
    ['Stop', (browser: Browser) => stop(browser, 'tab')]
  ])('says, in the person\'s language, that %s cannot reach the page, and keeps showing that it is gone', async (_name, act) => {
    const { browser, tab, pageProblem } = tabWithDestroyedPage()
    const failure = await Promise.resolve().then(() => act(browser)).catch((error: unknown) => error)
    expect(failure).toMatchObject(pageDestroyedFailure)
    expect(tab.pageProblem).toBe(pageProblem)
    expect(browser.prepareDiagnosticNavigation).not.toHaveBeenCalled()
    expect(browser.wakeTab).not.toHaveBeenCalled()
  })

  it.each(ACTIONS.flatMap(([name, act]) => (['wake', 'failed wake'] as const).map((during) => [name, during, act] as const)))(
    'says the same when the page is destroyed as %s wakes its tab, in a %s, and keeps showing that it is gone', async (_name, during, act) => {
    const { browser, tab, pageProblem, webContents } = tabWithDestroyedPage({ during })
    const failure = await Promise.resolve().then(() => act(browser)).catch((error: unknown) => error)
    expect(browser.wakeTab).toHaveBeenCalledOnce()
    expect(failure).toMatchObject(pageDestroyedFailure)
    expect(tab.pageProblem).toBe(pageProblem)
    expect(webContents.loadURL).not.toHaveBeenCalled()
    expect(webContents.navigationHistory.canGoBack).not.toHaveBeenCalled()
  })

  it('says the same when the page is destroyed as an agent\'s navigation waits for its workspace\'s cookies', async () => {
    const { browser, tab, pageProblem, webContents } = tabWithDestroyedPage({ during: 'cookies' })
    await expect(navigate(browser, 'https://example.test/next', 'tab')).rejects.toMatchObject(pageDestroyedFailure)
    expect(tab.pageProblem).toBe(pageProblem)
    expect(webContents.loadURL).not.toHaveBeenCalled()
    expect(browser.wakeTab).not.toHaveBeenCalled()
  })
})
