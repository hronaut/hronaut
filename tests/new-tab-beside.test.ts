import { afterEach, describe, expect, it, vi } from 'vitest'

const publishChange = vi.hoisted(() => vi.fn())
vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({ publishChange, browserState: vi.fn() }))

const { placeNewTabBeside } = await import('../src/main/browser/tab-arrangement/tab-arrangement.js')

type FakeTab = { id: string; url: string; mcpGroupId?: string; pinned: boolean }

function fakeBrowser(tabs: FakeTab[]) {
  return {
    tabs: new Map(tabs.map(tab => [tab.id, tab])),
    mcpTabGroups: new Map([['w1', { id: 'w1' }], ['w2', { id: 'w2' }]])
  } as unknown as Parameters<typeof placeNewTabBeside>[0]
}

const order = (browser: Parameters<typeof placeNewTabBeside>[0]) => [...browser.tabs.keys()]

describe('placeNewTabBeside', () => {
  afterEach(() => { publishChange.mockReset() })

  it('puts a new tab right after the tab given, as Chrome\'s New tab to the right', () => {
    const browser = fakeBrowser([
      { id: 'a', url: 'https://a.test/', mcpGroupId: 'w1', pinned: false },
      { id: 'b', url: 'https://b.test/', mcpGroupId: 'w1', pinned: false },
      { id: 'new', url: 'about:blank', mcpGroupId: 'w1', pinned: false }
    ])
    placeNewTabBeside(browser, 'new', 'a')
    expect(order(browser)).toEqual(['a', 'new', 'b'])
    expect(publishChange).toHaveBeenCalledTimes(1)
  })

  it('puts it after the pinned tabs when the tab given is pinned, since the new tab is not', () => {
    const browser = fakeBrowser([
      { id: 'p1', url: 'https://p1.test/', mcpGroupId: 'w1', pinned: true },
      { id: 'p2', url: 'https://p2.test/', mcpGroupId: 'w1', pinned: true },
      { id: 'a', url: 'https://a.test/', mcpGroupId: 'w1', pinned: false },
      { id: 'new', url: 'about:blank', mcpGroupId: 'w1', pinned: false }
    ])
    placeNewTabBeside(browser, 'new', 'p1')
    expect(order(browser)).toEqual(['p1', 'p2', 'new', 'a'])
  })

  it('leaves the tab at the end when the tab given has gone or is in another workspace', () => {
    const browser = fakeBrowser([
      { id: 'a', url: 'https://a.test/', mcpGroupId: 'w1', pinned: false },
      { id: 'other', url: 'https://o.test/', mcpGroupId: 'w2', pinned: false },
      { id: 'new', url: 'about:blank', mcpGroupId: 'w1', pinned: false }
    ])
    placeNewTabBeside(browser, 'new', 'other')
    placeNewTabBeside(browser, 'new', 'gone')
    expect(order(browser)).toEqual(['a', 'other', 'new'])
    expect(publishChange).not.toHaveBeenCalled()
  })
})
