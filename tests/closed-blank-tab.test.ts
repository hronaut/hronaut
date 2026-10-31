import { describe, expect, it } from 'vitest'
import type { NavigationEntry } from 'electron'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import { rememberClosedTab } from '../src/main/browser/tab-reopening/tab-reopening.js'
import type { BrowserClosedTabState } from '../src/shared/types.js'

// A new tab closed unused was remembered, so Reopen closed tab (Ctrl+Shift+T) brought it back empty rather than the
// tab closed before it, which Chrome brings back.

const BLANK: NavigationEntry = { url: 'about:blank', title: '' }
const SITE: NavigationEntry = { url: 'https://example.test/', title: 'Example' }

/** The addresses Recently closed holds once this tab, which showed these pages, closes. */
function closing(changes: Partial<BrowserTab>, entries: NavigationEntry[]): string[] {
  const closedTabs: BrowserClosedTabState[] = []
  const browser = { closedTabs, tabs: new Map(), mcpTabGroups: new Map() } as unknown as Browser
  const tab = {
    id: 'tab', url: 'about:blank', title: 'New tab', pinned: false, zoomIsolated: false, tabMuted: false,
    tabAgentPaused: false, humanInteractionLocked: false, ...changes
  } as BrowserTab
  rememberClosedTab(browser, tab, { entries, index: entries.length - 1 })
  return closedTabs.map((closed) => closed.url)
}

describe('a closed blank tab', () => {
  it('is left out of Recently closed when it only ever showed the blank page, as in Chrome', () => {
    expect(closing({}, [BLANK])).toEqual([])
    // Closed before its blank page came.
    expect(closing({}, [])).toEqual([])
  })

  it('is remembered when pinned, named, or once it showed a website', () => {
    expect(closing({ pinned: true }, [BLANK])).toEqual(['about:blank'])
    expect(closing({ label: 'Checkout task' }, [BLANK])).toEqual(['about:blank'])
    // Back on the blank page after a website, which Back shows again.
    expect(closing({}, [SITE, BLANK])).toEqual(['about:blank'])
    expect(closing({ url: SITE.url }, [SITE])).toEqual([SITE.url])
  })
})
