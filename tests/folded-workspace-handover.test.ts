import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
import { Browser } from '../src/main/browser/browser.js'
import { setFoldedWorkspaces } from '../src/main/browser/folded-workspaces/folded-workspaces.js'
import { closeTabTransition } from '../src/main/browser/tab-close/close-transition.js'
import { sleepFallbackTab } from '../src/main/browser/tab-sleep/tab-sleep.js'
import { registerWorkspacesIpc } from '../src/main/workspaces-ipc.js'
import { WORKSPACES_IPC } from '../src/shared/ipc/workspaces.js'

// Closing, or putting to sleep, the last tab of a workspace showed the first tab of the next one even when the tab strip
// folded it, and the strip then unfolded it to show that tab. Chrome's view never goes to a tab of a collapsed group.

interface Tab { id: string; url: string; pinned: boolean; sleeping: boolean; mcpGroupId: string; webContents: { isDestroyed: () => boolean } }
interface Internals {
  activeTabId: string | null
  tabs: Map<string, Tab>
  splitView: { firstTabId: string; secondTabId: string } | null
  splitViewContains(tabId: string): boolean
}

function fixture(tabs: Array<{ id: string; mcpGroupId: string; sleeping?: boolean }>, folded: string[] = []) {
  const group = (id: string) => ({ id, name: id, lastUsedAt: '2026-10-21T09:00:00.000Z' })
  const manager = Object.assign(Object.create(Browser.prototype), {
    mcpTabGroups: new Map(['work', 'docs', 'notes'].map(id => [id, group(id)])),
    tabs: new Map(tabs.map(tab => [tab.id, {
      ...tab, url: `https://${tab.id}.example/`, pinned: false, sleeping: tab.sleeping ?? false, webContents: { isDestroyed: () => false }
    }])),
    activeTabId: null,
    splitView: null
  }) as unknown as Internals
  setFoldedWorkspaces(manager as never, folded)
  return manager
}

const nextAfterClosing = (manager: Internals, id: string) => {
  manager.activeTabId = id
  return closeTabTransition(manager as never, manager.tabs.get(id)! as never).nextId
}

const fallbackWhenSleeping = (manager: Internals, id: string) => (
  sleepFallbackTab(manager as never, manager.tabs.get(id)! as never) as Tab | undefined
)?.id

const threeWorkspaces = [{ id: 'work-1', mcpGroupId: 'work' }, { id: 'docs-1', mcpGroupId: 'docs' }, { id: 'notes-1', mcpGroupId: 'notes' }]

describe('a tab closing or going to sleep beside a folded workspace', () => {
  it('shows the next tab of a workspace the strip does not fold, as Chrome passes over a collapsed group', () => {
    expect(nextAfterClosing(fixture(threeWorkspaces, ['docs']), 'work-1')).toBe('notes-1')
    expect(nextAfterClosing(fixture(threeWorkspaces, ['docs']), 'notes-1')).toBe('work-1')
    expect(fallbackWhenSleeping(fixture(threeWorkspaces, ['docs']), 'work-1')).toBe('notes-1')
  })

  it('passes over the other tabs of its own workspace when the strip folds that too', () => {
    const tabs = [{ id: 'work-1', mcpGroupId: 'work' }, { id: 'work-2', mcpGroupId: 'work' }, { id: 'docs-1', mcpGroupId: 'docs' }]
    expect(nextAfterClosing(fixture(tabs, ['work']), 'work-2')).toBe('docs-1')
    expect(fallbackWhenSleeping(fixture(tabs, ['work']), 'work-2')).toBe('docs-1')
  })

  it('still shows a folded workspace\'s tab when no other is left', () => {
    const tabs = [{ id: 'work-1', mcpGroupId: 'work' }, { id: 'docs-1', mcpGroupId: 'docs' }]
    expect(nextAfterClosing(fixture(tabs, ['docs']), 'work-1')).toBe('docs-1')
    expect(fallbackWhenSleeping(fixture(tabs, ['docs']), 'work-1')).toBe('docs-1')
  })

  it('keeps a split view\'s other tab on screen, folded or not', () => {
    const manager = fixture(threeWorkspaces, ['docs'])
    manager.splitView = { firstTabId: 'work-1', secondTabId: 'docs-1' }
    manager.splitViewContains = (tabId) => tabId === 'work-1' || tabId === 'docs-1'
    expect(nextAfterClosing(manager, 'work-1')).toBe('docs-1')
  })
})

describe('the shell saying which workspaces the strip folds', () => {
  function register(manager: Internals) {
    const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>()
    registerWorkspacesIpc({
      assertTrustedSender: () => undefined,
      handleBrowserIpc: (name: string, listener: Parameters<IpcMain['handle']>[1]) => { handlers.set(name, listener) },
      tabs: () => manager
    } as never)
    return (...args: unknown[]) => handlers.get(WORKSPACES_IPC.setFolded)!({} as IpcMainInvokeEvent, ...args)
  }

  it('takes the latest list in place of the one before', async () => {
    const manager = fixture(threeWorkspaces)
    const setFolded = register(manager)
    expect(nextAfterClosing(manager, 'work-1')).toBe('docs-1')
    await setFolded(['docs'])
    expect(nextAfterClosing(manager, 'work-1')).toBe('notes-1')
    await setFolded([])
    expect(nextAfterClosing(manager, 'work-1')).toBe('docs-1')
  })

  it('refuses anything but a list of workspace ids, and keeps the list it had', async () => {
    const manager = fixture(threeWorkspaces, ['docs'])
    const setFolded = register(manager)
    for (const invalid of ['docs', [7], ['x'.repeat(201)], Array.from({ length: 10_001 }, (_, index) => `w${index}`), null]) {
      expect(() => setFolded(invalid)).toThrow(TypeError)
    }
    expect(nextAfterClosing(manager, 'work-1')).toBe('notes-1')
  })
})
