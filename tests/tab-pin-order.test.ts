import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
import { Browser } from '../src/main/browser/browser.js'
import { orderedTabs } from '../src/main/browser/browser-core.js'

interface Tab { id: string; url: string; pinned: boolean; sleeping: boolean; mcpGroupId?: string; webContents: { isDestroyed: () => boolean } }
interface Internals {
  tabs: Map<string, Tab>
  wakeTab: (tabId: string) => Promise<unknown>
  setTabPinned(tabId: string, pinned: boolean): Promise<unknown>
  reorderTab(tabId: string, targetTabId: string, placement: 'before' | 'after'): unknown
}

/**
 * A manager with these tabs open in this order: `other:` ones in a second workspace, `none:` ones in none, and `home`
 * as Home. A workspace named in `pinnedWorkspaces` is pinned, so the strip shows it first.
 */
function manager(ids: string[], pinnedWorkspaces: string[] = []): Internals {
  const workspace = (id: string) => ({ id, name: id, ...(pinnedWorkspaces.includes(id) ? { pinnedAt: '2026-10-29T00:00:00.000Z' } : {}) })
  return Object.assign(Object.create(Browser.prototype), {
    mcpTabGroups: new Map([['work', workspace('work')], ['other', workspace('other')]]),
    tabs: new Map(ids.map((id) => {
      const [group, name] = id.includes(':') ? id.split(':') : ['work', id]
      const url = name === 'home' ? 'hronaut://home/' : `https://${name}.example/`
      return [name, { id: name, url, pinned: false, sleeping: false, mcpGroupId: group === 'none' ? undefined : group, webContents: { isDestroyed: () => false } }]
    })),
    activeTabId: ids[0],
    splitView: null,
    changed: () => undefined,
    getState: () => ({})
  }) as unknown as Internals
}

const order = (tabs: Internals) => orderedTabs(tabs as never).map((tab) => `${tab.id}${tab.pinned ? '*' : ''}`)

describe('pinning a tab moves it to the pinned tabs\' edge, as in Chrome', () => {
  it('puts a newly pinned tab after the tabs pinned before it', async () => {
    const tabs = manager(['a', 'b', 'c'])
    await tabs.setTabPinned('c', true)
    expect(order(tabs)).toEqual(['c*', 'a', 'b'])
    await tabs.setTabPinned('a', true)
    expect(order(tabs)).toEqual(['c*', 'a*', 'b'])
  })

  it('puts an unpinned tab first among the tabs that are not pinned', async () => {
    const tabs = manager(['a', 'b', 'c', 'd'])
    for (const id of ['b', 'c', 'd']) await tabs.setTabPinned(id, true)
    expect(order(tabs)).toEqual(['b*', 'c*', 'd*', 'a'])
    await tabs.setTabPinned('b', false)
    expect(order(tabs)).toEqual(['c*', 'd*', 'b', 'a'])
    // Unpinning the last tab opened keeps it beside the pinned tabs too, rather than sending it back to the end.
    await tabs.setTabPinned('d', false)
    expect(order(tabs)).toEqual(['c*', 'd', 'b', 'a'])
  })

  it('moves the tab only among its own workspace\'s tabs', async () => {
    const tabs = manager(['a', 'b', 'other:x', 'other:y', 'c'])
    await tabs.setTabPinned('c', true)
    await tabs.setTabPinned('y', true)
    expect(order(tabs)).toEqual(['c*', 'a', 'b', 'y*', 'x'])
  })

  it('goes by the order the strip shows, with Home first, a pinned workspace before the others and tabs in none', async () => {
    const tabs = manager(['none:n1', 'home', 'a', 'none:n2', 'other:x', 'other:y', 'b'], ['other'])
    expect(order(tabs)).toEqual(['home', 'n1', 'n2', 'x', 'y', 'a', 'b'])
    await tabs.setTabPinned('y', true)
    await tabs.setTabPinned('b', true)
    await tabs.setTabPinned('n2', true)
    expect(order(tabs)).toEqual(['home', 'n2*', 'n1', 'y*', 'x', 'b*', 'a'])
    await tabs.setTabPinned('y', false)
    expect(order(tabs)).toEqual(['home', 'n2*', 'n1', 'y', 'x', 'b*', 'a'])
  })

  it('puts the tab back where it was when the pinned tab cannot wake', async () => {
    const tabs = manager(['a', 'b', 'c'])
    tabs.tabs.get('b')!.sleeping = true
    tabs.wakeTab = () => Promise.reject(new Error('Wake failed'))
    await expect(tabs.setTabPinned('b', true)).rejects.toThrow('Wake failed')
    expect(order(tabs)).toEqual(['a', 'b', 'c'])
  })

  it('keeps a move made while the pinned tab wakes when its wake fails', async () => {
    const tabs = manager(['a', 'b', 'c'])
    tabs.tabs.get('b')!.sleeping = true
    let fail!: (error: Error) => void
    tabs.wakeTab = () => new Promise((_resolve, reject) => { fail = reject })
    const pinning = tabs.setTabPinned('b', true)
    expect(order(tabs)).toEqual(['b*', 'a', 'c'])
    tabs.reorderTab('c', 'a', 'before')
    fail(new Error('Wake failed'))
    await expect(pinning).rejects.toThrow('Wake failed')
    expect(order(tabs)).toEqual(['b', 'c', 'a'])
  })

  it('leaves a tab that was already pinned in its place when its wake fails after other tabs changed', async () => {
    const tabs = manager(['a', 'b', 'c'])
    await tabs.setTabPinned('a', true)
    await tabs.setTabPinned('b', true)
    tabs.tabs.get('a')!.sleeping = true
    let fail!: (error: Error) => void
    tabs.wakeTab = () => new Promise((_resolve, reject) => { fail = reject })
    const pinning = tabs.setTabPinned('a', true)
    tabs.tabs.delete('c')
    fail(new Error('Wake failed'))
    await expect(pinning).rejects.toThrow('Wake failed')
    expect(order(tabs)).toEqual(['a*', 'b*'])
  })
})
