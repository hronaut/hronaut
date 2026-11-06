import { describe, expect, it, vi } from 'vitest'
import type { Browser } from '../src/main/browser/browser.js'
import { back, forward, navigate, reload, reloadIgnoringCache, stop } from '../src/main/browser/page-navigation/page-navigation.js'
import { PAGE_DESTROYED_REASON } from '../src/shared/types/page-problems.js'

// A tab whose page Electron destroyed while the tab stayed open shows that the page is gone. Its Try again, and an
// agent's navigation, reload or stop in it, then called the destroyed page and failed with Electron's English "Object
// has been destroyed", and Try again cleared what the tab showed first.

const ACTIONS: [string, (browser: Browser) => unknown][] = [
  ['Try again and an agent\'s reload', (browser) => reload(browser, 'tab', { byPerson: true })],
  ['a reload ignoring the cache', (browser) => reloadIgnoringCache(browser, 'tab')],
  ['an agent\'s navigation', (browser) => navigate(browser, 'https://example.test/next', 'tab')],
  ['Back', (browser) => back(browser, 'tab')],
  ['Forward', (browser) => forward(browser, 'tab')]
]

/** A sleeping tab whose page is destroyed now, or, with `whileWaking`, as it wakes, as Electron can destroy it then. */
function tabWithDestroyedPage(options: { whileWaking?: boolean } = {}) {
  let pageDestroyed = !options.whileWaking
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
    id: 'tab', url: 'https://example.test/app', sleeping: true,
    pageProblem: options.whileWaking ? undefined : pageProblem as typeof pageProblem | undefined, webContents
  }
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: tab.id,
    options: {},
    rendererRecovery: { isRecovering: vi.fn(() => false) },
    prepareDiagnosticNavigation: vi.fn(),
    // Electron destroys the waking page, and the tab says so, as recoverFromDestroyedPage does.
    wakeTab: vi.fn(() => {
      pageDestroyed = true
      tab.sleeping = false
      tab.pageProblem = pageProblem
      return Promise.resolve({})
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

  it.each(ACTIONS)('says the same when the page is destroyed as %s wakes its tab, and keeps showing that it is gone', async (_name, act) => {
    const { browser, tab, pageProblem, webContents } = tabWithDestroyedPage({ whileWaking: true })
    const failure = await Promise.resolve().then(() => act(browser)).catch((error: unknown) => error)
    expect(browser.wakeTab).toHaveBeenCalledOnce()
    expect(failure).toMatchObject(pageDestroyedFailure)
    expect(tab.pageProblem).toBe(pageProblem)
    expect(webContents.loadURL).not.toHaveBeenCalled()
    expect(webContents.navigationHistory.canGoBack).not.toHaveBeenCalled()
  })
})
