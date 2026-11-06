import { describe, expect, it } from 'vitest'
import type { NavigationEntry } from 'electron'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import { rememberClosedTab } from '../src/main/browser/tab-reopening/tab-reopening.js'
import type { BrowserClosedTabState, BrowserPageProblem } from '../src/shared/types.js'

// A tab whose page could not load is titled Site unavailable. It was remembered by that title, so Home's Recently closed
// listed such tabs as identical rows, also after a restart, and the reopened tab was titled so while its page loaded.
// Chrome's Recently closed names them by their page. A tab whose page crashed keeps its page's title, as Chrome's does.

const CRASHED: BrowserPageProblem = { kind: 'renderer-gone', title: 'This page stopped working', message: 'The page stopped.', url: '', reason: 'crashed' }
const FAILED: BrowserPageProblem = { kind: 'load-error', title: 'Site unavailable', message: 'The site could not be reached.', url: '' }

/** The title Recently closed holds once this tab, which showed these pages, closes. */
function closedTitle(changes: Partial<BrowserTab>, entries: NavigationEntry[], index = entries.length - 1): string | undefined {
  const closedTabs: BrowserClosedTabState[] = []
  const browser = { closedTabs, tabs: new Map(), mcpTabGroups: new Map() } as unknown as Browser
  const tab = {
    id: 'tab', url: 'https://mail.example/inbox', title: 'Inbox', pinned: false, zoomIsolated: false, tabMuted: false,
    tabAgentPaused: false, humanInteractionLocked: false, ...changes
  } as BrowserTab
  rememberClosedTab(browser, tab, { entries, index })
  return closedTabs[0]?.title
}

describe('the title a closed tab is remembered by', () => {
  it('is the page\'s title in its history when the page could not load', () => {
    expect(closedTitle(
      { title: 'Site unavailable', pageProblem: FAILED },
      [{ url: 'https://news.example/', title: 'News' }, { url: 'https://mail.example/inbox', title: 'Inbox (3)' }]
    )).toBe('Inbox (3)')
  })

  it('is the tab\'s own title, its page\'s, when the page crashed', () => {
    // The tab kept its page's title through the crash, as Chrome's does.
    expect(closedTitle({ title: 'Inbox (3)', pageProblem: CRASHED }, [])).toBe('Inbox (3)')
  })

  it('is the address as Chromium shows it when the page could not load, or has no title of its own', () => {
    // Chromium names the failed page by its address.
    expect(closedTitle(
      { url: 'http://intranet.example/reports?week=44', title: 'Site unavailable', pageProblem: FAILED },
      [{ url: 'http://intranet.example/reports?week=44', title: 'intranet.example/reports?week=44' }]
    )).toBe('intranet.example/reports?week=44')
    expect(closedTitle({ title: 'Site unavailable', pageProblem: FAILED }, [{ url: 'https://mail.example/inbox', title: '' }]))
      .toBe('https://mail.example/inbox')
    // A page gone with its history, or showing another page in it, is named by its address too.
    expect(closedTitle({ title: 'Site unavailable', pageProblem: FAILED }, [])).toBe('https://mail.example/inbox')
    expect(closedTitle({ title: 'Site unavailable', pageProblem: FAILED }, [{ url: 'https://news.example/', title: 'News' }]))
      .toBe('https://mail.example/inbox')
  })

  it('keeps no address Chromium kept as an untitled page\'s title after the page changed its address', () => {
    // The callback's fragment held a sign-in token; the tab had dropped that title, its history still has it.
    expect(closedTitle(
      { url: 'https://app.example/dashboard', title: 'Site unavailable', pageProblem: FAILED },
      [{ url: 'https://app.example/dashboard', title: 'app.example/oauth/callback#access_token=secret' }]
    )).toBe('https://app.example/dashboard')
  })

  it('is the tab\'s own title when it names no crash or failed load', () => {
    const history = [{ url: 'https://status.example/incidents?id=7', title: 'status.example' }]
    // A page that hangs, or whose contents are gone, keeps its title; a refused certificate keeps Chrome's Privacy error.
    const hung: BrowserPageProblem = { kind: 'unresponsive', title: 'Page not responding', message: 'Wait or close it.', url: '' }
    expect(closedTitle({ url: 'https://status.example/incidents?id=7', title: 'status.example', pageProblem: hung }, history))
      .toBe('status.example')
    const gone: BrowserPageProblem = { ...CRASHED, reason: 'renderer-destroyed' }
    expect(closedTitle({ title: 'Quarterly report', pageProblem: gone }, [])).toBe('Quarterly report')
    const refused: BrowserPageProblem = { ...FAILED, certificate: { host: 'mail.example', canProceed: true } }
    expect(closedTitle({ title: 'Privacy error', pageProblem: refused }, [{ url: 'https://mail.example/inbox', title: 'Privacy error' }]))
      .toBe('Privacy error')
  })

  it('is cut to the length of any tab title', () => {
    const url = `http://sso.example/saml?SAMLRequest=${'a'.repeat(4_000)}`
    const title = closedTitle({ url, title: 'Site unavailable', pageProblem: FAILED }, [{ url, title: url.slice('http://'.length) }])
    expect(title).toHaveLength(512)
    expect(title!.startsWith('sso.example/saml?SAMLRequest=aaa')).toBe(true)
  })

  it('is the tab\'s own title while its page is fine', () => {
    expect(closedTitle({}, [{ url: 'https://mail.example/inbox', title: 'Inbox (3)' }])).toBe('Inbox')
    expect(closedTitle({ title: '' }, [{ url: 'https://mail.example/inbox', title: '' }])).toBe('https://mail.example/inbox')
  })
})
