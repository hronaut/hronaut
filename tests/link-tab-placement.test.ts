import { describe, expect, it } from 'vitest'
import { placeTabOpenedFromPage, type LinkTabPlacementTab } from '../src/main/browser/link-tab-placement/link-tab-placement.js'

const HOME = 'hronaut://home/'

function tab(id: string, options: Partial<LinkTabPlacementTab> = {}): LinkTabPlacementTab {
  return { id, url: `https://example.test/${id}`, pinned: false, mcpGroupId: 'client', ...options }
}

/** The ids after placing the last tab, which was just opened, or undefined when it stays last. */
function placed(tabs: LinkTabPlacementTab[], background: boolean): string[] | undefined {
  return placeTabOpenedFromPage(tabs, tabs.at(-1)!, background)?.map((candidate) => candidate.id)
}

describe('placing a tab a page opened', () => {
  // A link opened in a new tab went after the workspace's last tab, far from the page that opened it.
  it('puts a tab opened in front right after the tab that opened it', () => {
    expect(placed([tab('app'), tab('docs'), tab('mail'), tab('new', { openedFromTabId: 'app' })], false))
      .toEqual(['app', 'new', 'docs', 'mail'])
  })

  it('puts tabs opened behind after the tabs the page already opened, keeping their order', () => {
    const first = tab('first', { openedFromTabId: 'app' })
    const second = tab('second', { openedFromTabId: 'app' })
    expect(placed([tab('app'), first, tab('mail'), second], true)).toEqual(['app', 'first', 'second', 'mail'])
    // A tab opened in front still goes right after its opener.
    expect(placed([tab('app'), first, second, tab('mail'), tab('front', { openedFromTabId: 'app' })], false))
      .toEqual(['app', 'front', 'first', 'second', 'mail'])
  })

  it('counts the tabs those tabs opened, and stops at the first tab the page did not open', () => {
    const child = tab('child', { openedFromTabId: 'app' })
    const grandchild = tab('grandchild', { openedFromTabId: 'child' })
    expect(placed([tab('app'), child, grandchild, tab('mail'), tab('later', { openedFromTabId: 'app' }), tab('new', { openedFromTabId: 'app' })], true))
      .toEqual(['app', 'child', 'grandchild', 'new', 'mail', 'later'])
  })

  it('starts a pinned tab\'s links after the workspace\'s pinned tabs', () => {
    const pinned = [tab('pinned-app', { pinned: true }), tab('pinned-mail', { pinned: true })]
    expect(placed([...pinned, tab('docs'), tab('new', { openedFromTabId: 'pinned-app' })], true))
      .toEqual(['pinned-app', 'pinned-mail', 'new', 'docs'])
  })

  it('leaves other workspaces\' tabs and Home where they are', () => {
    const tabs = [tab('home', { url: HOME, mcpGroupId: undefined }), tab('app'), tab('docs'), tab('other', { mcpGroupId: 'other' }), tab('new', { openedFromTabId: 'app' })]
    expect(placed(tabs, true)).toEqual(['home', 'app', 'new', 'docs', 'other'])
  })

  it('leaves the tab last when its opener is last, gone, Home or in another workspace, or when it was not opened by a page', () => {
    expect(placed([tab('docs'), tab('app'), tab('new', { openedFromTabId: 'app' })], true)).toBeUndefined()
    expect(placed([tab('app'), tab('docs'), tab('new', { openedFromTabId: 'closed' })], true)).toBeUndefined()
    expect(placed([tab('home', { url: HOME, mcpGroupId: undefined }), tab('docs'), tab('new', { mcpGroupId: undefined, openedFromTabId: 'home' })], true)).toBeUndefined()
    expect(placed([tab('app', { mcpGroupId: 'other' }), tab('docs'), tab('new', { openedFromTabId: 'app' })], true)).toBeUndefined()
    expect(placed([tab('app'), tab('docs'), tab('new')], true)).toBeUndefined()
  })
})
