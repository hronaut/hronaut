import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'

// A sign-in popup that closed itself showed the first tab of the next workspace, rather than the tab that opened it.

interface Tab { id: string; url: string; pinned: boolean; mcpGroupId: string; openerTabId?: string; webContents: { isDestroyed: () => boolean } }
interface Internals {
  activeTabId: string | null
  tabs: Map<string, Tab>
  closeTabTransition(tab: Tab): { splitPartnerId: string | null; nextId: string | undefined }
}

function fixture(tabs: Array<Omit<Tab, 'webContents' | 'pinned' | 'url'>>) {
  const group = (id: string) => ({ id, name: id, lastUsedAt: '2026-10-21T09:00:00.000Z' })
  const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
    mcpTabGroups: new Map([['alpha', group('alpha')], ['beta', group('beta')]]),
    tabs: new Map(tabs.map(tab => [tab.id, { ...tab, url: `https://${tab.id}.example/`, pinned: false, webContents: { isDestroyed: () => false } }])),
    activeTabId: null,
    splitView: null
  }) as unknown as Internals
  return manager
}

it('shows the tab that opened a popup when the popup closes', () => {
  const manager = fixture([
    { id: 'app', mcpGroupId: 'alpha' },
    { id: 'docs', mcpGroupId: 'alpha' },
    { id: 'popup', mcpGroupId: 'alpha', openerTabId: 'app' },
    { id: 'other', mcpGroupId: 'beta' }
  ])
  manager.activeTabId = 'popup'
  expect(manager.closeTabTransition(manager.tabs.get('popup')!).nextId).toBe('app')
  // Once its opener is closed, the popup's tab closes as any other.
  manager.tabs.delete('app')
  expect(manager.closeTabTransition(manager.tabs.get('popup')!).nextId).toBe('other')
})
