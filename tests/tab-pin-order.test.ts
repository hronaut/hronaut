import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
// The prototype-built browsers below stub changed and getState; the arrangement functions publish through these.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))
import { Browser } from '../src/main/browser/browser.js'
import { orderedTabs } from '../src/main/browser/browser-core.js'
import { reorderTab, setTabPinned } from '../src/main/browser/tab-arrangement/tab-arrangement.js'

interface Tab { id: string; url: string; pinned: boolean; sleeping: boolean; mcpGroupId?: string; webContents: { isDestroyed: () => boolean } }
interface Internals {
  tabs: Map<string, Tab>
  wakeTab: (tabId: string) => Promise<unknown>
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
    await setTabPinned(tabs as never, 'c', true)
    expect(order(tabs)).toEqual(['c*', 'a', 'b'])
    await setTabPinned(tabs as never, 'a', true)
    expect(order(tabs)).toEqual(['c*', 'a*', 'b'])
  })

  it('puts an unpinned tab first among the tabs that are not pinned', async () => {
    const tabs = manager(['a', 'b', 'c', 'd'])
    for (const id of ['b', 'c', 'd']) await setTabPinned(tabs as never, id, true)
    expect(order(tabs)).toEqual(['b*', 'c*', 'd*', 'a'])
    await setTabPinned(tabs as never, 'b', false)
    expect(order(tabs)).toEqual(['c*', 'd*', 'b', 'a'])
    // Unpinning the last tab opened keeps it beside the pinned tabs too, rather than sending it back to the end.
    await setTabPinned(tabs as never, 'd', false)
    expect(order(tabs)).toEqual(['c*', 'd', 'b', 'a'])
  })

  it('moves the tab only among its own workspace\'s tabs', async () => {
    const tabs = manager(['a', 'b', 'other:x', 'other:y', 'c'])
    await setTabPinned(tabs as never, 'c', true)
    await setTabPinned(tabs as never, 'y', true)
    expect(order(tabs)).toEqual(['c*', 'a', 'b', 'y*', 'x'])
  })

  it('goes by the order the strip shows, with Home first, a pinned workspace before the others and tabs in none', async () => {
    const tabs = manager(['none:n1', 'home', 'a', 'none:n2', 'other:x', 'other:y', 'b'], ['other'])
    expect(order(tabs)).toEqual(['home', 'n1', 'n2', 'x', 'y', 'a', 'b'])
    await setTabPinned(tabs as never, 'y', true)
    await setTabPinned(tabs as never, 'b', true)
    await setTabPinned(tabs as never, 'n2', true)
    expect(order(tabs)).toEqual(['home', 'n2*', 'n1', 'y*', 'x', 'b*', 'a'])
    await setTabPinned(tabs as never, 'y', false)
    expect(order(tabs)).toEqual(['home', 'n2*', 'n1', 'y', 'x', 'b*', 'a'])
  })

  it('puts the tab back where it was when the pinned tab cannot wake', async () => {
    const tabs = manager(['a', 'b', 'c'])
    tabs.tabs.get('b')!.sleeping = true
    tabs.wakeTab = () => Promise.reject(new Error('Wake failed'))
    await expect(setTabPinned(tabs as never, 'b', true)).rejects.toThrow('Wake failed')
    expect(order(tabs)).toEqual(['a', 'b', 'c'])
  })

  it('keeps a move made while the pinned tab wakes when its wake fails', async () => {
    const tabs = manager(['a', 'b', 'c'])
    tabs.tabs.get('b')!.sleeping = true
    let fail!: (error: Error) => void
    tabs.wakeTab = () => new Promise((_resolve, reject) => { fail = reject })
    const pinning = setTabPinned(tabs as never, 'b', true)
    expect(order(tabs)).toEqual(['b*', 'a', 'c'])
    reorderTab(tabs as never, 'c', 'a', 'before')
    fail(new Error('Wake failed'))
    await expect(pinning).rejects.toThrow('Wake failed')
    expect(order(tabs)).toEqual(['b', 'c', 'a'])
  })

  it('leaves a tab that was already pinned in its place when its wake fails after other tabs changed', async () => {
    const tabs = manager(['a', 'b', 'c'])
    await setTabPinned(tabs as never, 'a', true)
    await setTabPinned(tabs as never, 'b', true)
    tabs.tabs.get('a')!.sleeping = true
    let fail!: (error: Error) => void
    tabs.wakeTab = () => new Promise((_resolve, reject) => { fail = reject })
    const pinning = setTabPinned(tabs as never, 'a', true)
    tabs.tabs.delete('c')
    fail(new Error('Wake failed'))
    await expect(pinning).rejects.toThrow('Wake failed')
    expect(order(tabs)).toEqual(['a*', 'b*'])
  })
})
