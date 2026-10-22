import { describe, expect, it } from 'vitest'
import {
  forgetTabsOpenedFrom,
  handOverTabsOpenedFrom,
  switchLeavesOpenedTabs,
  tabAfterClosingLinkTab,
  type LinkTabOpenerTab
} from '../src/main/browser/link-tab-placement/link-tab-openers.js'

// Closing a tab opened from a page's link showed the tab to its right, where Chrome shows the page's next tab or the
// page itself, and nothing forgot which page opened which tab once the person turned to another task.

function tabs(spec: string): LinkTabOpenerTab[] {
  // "app docs<app" is a tab app and a tab docs opened from app, in that order, all in workspace work; "@other" puts a
  // tab in workspace other.
  return spec.split(' ').map((entry) => {
    const [name = '', from] = entry.split('<')
    const other = name.startsWith('@')
    return {
      id: other ? name.slice(1) : name,
      mcpGroupId: other ? 'other' : 'work',
      ...(from ? { openedFromTabId: from } : {})
    }
  })
}

const byId = (list: LinkTabOpenerTab[], id: string) => list.find((tab) => tab.id === id)!
const after = (spec: string, closing: string, canShow = (_tab: LinkTabOpenerTab) => true) => {
  const list = tabs(spec)
  return tabAfterClosingLinkTab(list, byId(list, closing), canShow)?.id
}

describe('the tab shown after a tab opened from a page closes', () => {
  it('is the page when the page opened no other tab', () => {
    expect(after('app one<app mail', 'one')).toBe('app')
  })

  it('is the page\'s next tab to the right, then to the left, before the page', () => {
    expect(after('app one<app two<app three<app mail', 'two')).toBe('three')
    expect(after('app one<app two<app mail', 'two')).toBe('one')
  })

  it('counts the tabs the closing tab opened among the page\'s tabs, as they become the page\'s', () => {
    expect(after('app one<app child<one two<app', 'one')).toBe('child')
  })

  it('skips a tab that cannot show, and the page when it cannot show', () => {
    expect(after('app one<app two<app', 'one', (tab) => tab.id !== 'two')).toBe('app')
    expect(after('app one<app mail', 'one', (tab) => tab.id !== 'app')).toBeUndefined()
  })

  it('is none for a tab no page opened, or opened from a page that is gone or in another workspace', () => {
    expect(after('app one mail', 'one')).toBeUndefined()
    expect(after('app one<gone mail', 'one')).toBeUndefined()
    expect(after('@app one<app mail', 'one')).toBeUndefined()
  })

  it('leaves out tabs another workspace\'s page opened, and tabs the page\'s other tabs opened', () => {
    expect(after('app one<app grandchild<two two<app', 'one')).toBe('two')
    expect(after('app one<app @elsewhere<app mail', 'one')).toBe('app')
  })
})

describe('a tab that closes', () => {
  it('hands the tabs it opened to the page that opened it', () => {
    const list = tabs('app one<app child<one mail')
    handOverTabsOpenedFrom(list, byId(list, 'one'))
    expect(byId(list, 'child').openedFromTabId).toBe('app')
    expect(byId(list, 'one').openedFromTabId).toBe('app')
    expect(byId(list, 'mail').openedFromTabId).toBeUndefined()
  })

  it('leaves the tabs it opened opened from no page when no page opened it', () => {
    const list = tabs('app child<app mail')
    handOverTabsOpenedFrom(list, byId(list, 'app'))
    expect(byId(list, 'child')).not.toHaveProperty('openedFromTabId')
  })
})

describe('forgetting which page opened which tab', () => {
  it('forgets it for one workspace only', () => {
    const list = tabs('app one<app @mail @two<mail')
    forgetTabsOpenedFrom(list, 'work')
    expect(byId(list, 'one')).not.toHaveProperty('openedFromTabId')
    expect(byId(list, 'two').openedFromTabId).toBe('mail')
    forgetTabsOpenedFrom(list, undefined)
    expect(byId(list, 'two').openedFromTabId).toBe('mail')
  })

  it('happens when the person goes to a tab unrelated to the shown one, as in Chrome', () => {
    const list = tabs('app one<app two<app mail child<one @other')
    const leaves = (from: string, to: string) => switchLeavesOpenedTabs(byId(list, from), byId(list, to))
    // Between a page and the tabs it opened, and between the tabs one page opened, the person stays on one task.
    expect(leaves('app', 'one')).toBe(false)
    expect(leaves('one', 'app')).toBe(false)
    expect(leaves('one', 'two')).toBe(false)
    expect(leaves('one', 'child')).toBe(false)
    // Chrome keeps them too between two tabs no page opened, such as going from the page to another tab and back.
    expect(leaves('app', 'mail')).toBe(false)
    expect(leaves('mail', 'app')).toBe(false)
    expect(leaves('one', 'one')).toBe(false)
    // Another workspace is another window, whose tabs Chrome never compares.
    expect(leaves('one', 'other')).toBe(false)
    expect(leaves('mail', 'one')).toBe(true)
    expect(leaves('one', 'mail')).toBe(true)
    expect(leaves('app', 'child')).toBe(true)
  })
})
