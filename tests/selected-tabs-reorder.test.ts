import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
import { Browser } from '../src/main/browser/browser.js'
import { orderedTabs } from '../src/main/browser/browser-core.js'

// Dragging one of several selected tabs moved only that tab; as in Chrome, the selected tabs move together.

interface Tab { id: string; url: string; pinned: boolean; sleeping: boolean; mcpGroupId?: string; webContents: { isDestroyed: () => boolean } }
interface Internals {
  tabs: Map<string, Tab>
  changed: () => void
  reorderTabs(tabIds: readonly string[], targetTabId: string, placement: 'before' | 'after'): unknown
}

/** A manager with these tabs open in this order: `other:` ones in a second workspace, a `*` one pinned, `home` as Home. */
function manager(ids: string[]): Internals {
  return Object.assign(Object.create(Browser.prototype), {
    mcpTabGroups: new Map([['work', { id: 'work', name: 'work' }], ['other', { id: 'other', name: 'other' }]]),
    tabs: new Map(ids.map((id) => {
      const [group, label] = id.includes(':') ? id.split(':') : ['work', id]
      const name = label!.replace('*', '')
      const url = name === 'home' ? 'hronaut://home/' : `https://${name}.example/`
      return [name, { id: name, url, pinned: label!.endsWith('*'), sleeping: false, mcpGroupId: group, webContents: { isDestroyed: () => false } }]
    })),
    activeTabId: ids[0],
    splitView: null,
    changed: vi.fn(),
    getState: () => ({})
  }) as unknown as Internals
}

const order = (tabs: Internals) => orderedTabs(tabs as never).map((tab) => tab.id)

describe('moving the selected tabs together', () => {
  it('puts them before or after the target in the order they had, whatever order they were named in', () => {
    const tabs = manager(['a', 'b', 'c', 'd', 'e'])
    tabs.reorderTabs(['d', 'b'], 'e', 'after')
    expect(order(tabs)).toEqual(['a', 'c', 'e', 'b', 'd'])
    tabs.reorderTabs(['b', 'd'], 'a', 'before')
    expect(order(tabs)).toEqual(['b', 'd', 'a', 'c', 'e'])
    // Beside a tab between them, they close up around it.
    tabs.reorderTabs(['b', 'c', 'e'], 'a', 'after')
    expect(order(tabs)).toEqual(['d', 'a', 'b', 'c', 'e'])
    expect(tabs.changed).toHaveBeenCalledTimes(3)
  })

  it('moves nothing onto one of the tabs it moves, and names a tab only once', () => {
    const tabs = manager(['a', 'b', 'c'])
    tabs.reorderTabs(['a', 'b'], 'b', 'after')
    expect(order(tabs)).toEqual(['a', 'b', 'c'])
    expect(tabs.changed).not.toHaveBeenCalled()
    tabs.reorderTabs(['a', 'a'], 'c', 'after')
    expect(order(tabs)).toEqual(['b', 'c', 'a'])
  })

  it('refuses Home, another workspace and the other side of the pinned boundary, moving nothing', () => {
    const tabs = manager(['home', 'p*', 'a', 'b', 'other:x'])
    expect(() => tabs.reorderTabs(['a', 'home'], 'b', 'after')).toThrow('Hronaut Home cannot be reordered')
    expect(() => tabs.reorderTabs(['a', 'b'], 'home', 'after')).toThrow('Hronaut Home cannot be reordered')
    expect(() => tabs.reorderTabs(['a', 'x'], 'b', 'after')).toThrow('Tabs can only be reordered within the same workspace')
    expect(() => tabs.reorderTabs(['a', 'b'], 'x', 'after')).toThrow('Tabs can only be reordered within the same workspace')
    expect(() => tabs.reorderTabs(['a', 'p'], 'b', 'after')).toThrow('Pin or unpin a tab before moving it across the pinned boundary')
    expect(() => tabs.reorderTabs(['a', 'gone'], 'b', 'after')).toThrow('Tab not found: gone')
    expect(order(tabs)).toEqual(['home', 'p', 'a', 'b', 'x'])
  })
})
