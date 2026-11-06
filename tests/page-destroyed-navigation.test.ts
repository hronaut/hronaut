import { describe, expect, it, vi } from 'vitest'
import type { Browser } from '../src/main/browser/browser.js'
import { back, forward, navigate, reload, reloadIgnoringCache, stop } from '../src/main/browser/page-navigation/page-navigation.js'
import { PAGE_DESTROYED_REASON } from '../src/shared/types/page-problems.js'

// A tab whose page Electron destroyed while the tab stayed open shows that the page is gone. Its Try again, and an
// agent's navigation, reload or stop in it, then called the destroyed page and failed with Electron's English "Object
// has been destroyed", and Try again cleared what the tab showed first.

function tabWithDestroyedPage() {
  const destroyed = () => { throw new TypeError('Object has been destroyed') }
  const webContents = {
    isDestroyed: () => true,
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
  const tab = { id: 'tab', url: 'https://example.test/app', sleeping: false, pageProblem, webContents }
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: tab.id,
    options: {},
    rendererRecovery: { isRecovering: vi.fn(() => false) },
    prepareDiagnosticNavigation: vi.fn(),
    wakeTab: vi.fn()
  } as unknown as Browser
  return { browser, tab, pageProblem }
}

describe('a tab whose page was destroyed while it stayed open', () => {
  it.each([
    ['Try again and an agent\'s reload', (browser: Browser) => reload(browser, 'tab', { byPerson: true })],
    ['a reload ignoring the cache', (browser: Browser) => reloadIgnoringCache(browser, 'tab')],
    ['an agent\'s navigation', (browser: Browser) => navigate(browser, 'https://example.test/next', 'tab')],
    ['Back', (browser: Browser) => back(browser, 'tab')],
    ['Forward', (browser: Browser) => forward(browser, 'tab')],
    ['Stop', async (browser: Browser) => stop(browser, 'tab')]
  ])('says, in the person\'s language, that %s cannot reach the page, and keeps showing that it is gone', async (_name, act) => {
    const { browser, tab, pageProblem } = tabWithDestroyedPage()
    const failure = await Promise.resolve().then(() => act(browser)).catch((error: unknown) => error)
    expect(failure).toMatchObject({
      key: 'appErrors.navigation.pageDestroyed',
      message: 'This page is no longer available. Close this tab and reopen it from Recently closed.'
    })
    expect(tab.pageProblem).toBe(pageProblem)
    expect(browser.prepareDiagnosticNavigation).not.toHaveBeenCalled()
    expect(browser.wakeTab).not.toHaveBeenCalled()
  })
})
