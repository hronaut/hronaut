import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
import { Browser } from '../src/main/browser/browser.js'
import { orderedTabs } from '../src/main/browser/browser-core.js'
import { sleepFallbackTab } from '../src/main/browser/tab-sleep/tab-sleep.js'

// Closing, or putting to sleep, the last tab of a workspace's row showed the first tab of the next workspace, though
// the tab to its left in the same workspace was still open. Close Other Tabs and Close Tabs to the Right, which close
// the shown tab last, did the same; the e2e close-tab-workspace-neighbour drives them through the menu.

interface Tab { id: string; url: string; pinned: boolean; sleeping: boolean; mcpGroupId: string; webContents: { isDestroyed: () => boolean } }
interface Internals {
  activeTabId: string | null
  tabs: Map<string, Tab>
  closeTabTransition(tab: Tab): { splitPartnerId: string | null; nextId: string | undefined }
}

function fixture(tabs: Array<{ id: string; mcpGroupId: string; sleeping?: boolean }>) {
  const group = (id: string) => ({ id, name: id, lastUsedAt: '2026-10-21T09:00:00.000Z' })
  return Object.assign(Object.create(Browser.prototype), {
    mcpTabGroups: new Map([['work', group('work')], ['docs', group('docs')]]),
    tabs: new Map(tabs.map(tab => [tab.id, {
      ...tab, url: `https://${tab.id}.example/`, pinned: false, sleeping: tab.sleeping ?? false, webContents: { isDestroyed: () => false }
    }])),
    activeTabId: null,
    splitView: null
  }) as unknown as Internals
}

const nextAfterClosing = (manager: Internals, id: string) => {
  manager.activeTabId = id
  return manager.closeTabTransition(manager.tabs.get(id)!).nextId
}

const fallbackWhenSleeping = (manager: Internals, id: string) => (
  sleepFallbackTab({ orderedTabs: () => orderedTabs(manager as never) } as never, manager.tabs.get(id)! as never) as Tab | undefined
)?.id

describe('closing the shown tab', () => {
  it('shows the tab to its left in the same workspace when it was the workspace\'s last tab', () => {
    const manager = fixture([{ id: 'work-1', mcpGroupId: 'work' }, { id: 'work-2', mcpGroupId: 'work' }, { id: 'docs-1', mcpGroupId: 'docs' }])
    expect(nextAfterClosing(manager, 'work-2')).toBe('work-1')
  })

  it('still shows the tab to its right in the same workspace first', () => {
    const manager = fixture([{ id: 'work-1', mcpGroupId: 'work' }, { id: 'work-2', mcpGroupId: 'work' }, { id: 'docs-1', mcpGroupId: 'docs' }])
    expect(nextAfterClosing(manager, 'work-1')).toBe('work-2')
  })

  it('shows another workspace\'s tab only when its own workspace has no other tab', () => {
    const manager = fixture([{ id: 'work-1', mcpGroupId: 'work' }, { id: 'docs-1', mcpGroupId: 'docs' }])
    expect(nextAfterClosing(manager, 'work-1')).toBe('docs-1')
    expect(nextAfterClosing(manager, 'docs-1')).toBe('work-1')
  })
})

describe('putting the shown tab to sleep', () => {
  it('shows the awake tab to its left in the same workspace when it was the workspace\'s last tab', () => {
    const manager = fixture([{ id: 'work-1', mcpGroupId: 'work' }, { id: 'work-2', mcpGroupId: 'work' }, { id: 'docs-1', mcpGroupId: 'docs' }])
    expect(fallbackWhenSleeping(manager, 'work-2')).toBe('work-1')
  })

  it('stays in the workspace when its other tabs sleep too', () => {
    const manager = fixture([{ id: 'work-1', mcpGroupId: 'work', sleeping: true }, { id: 'work-2', mcpGroupId: 'work' }, { id: 'docs-1', mcpGroupId: 'docs' }])
    expect(fallbackWhenSleeping(manager, 'work-2')).toBe('work-1')
  })

  it('shows an awake tab of another workspace when its own workspace has no other tab', () => {
    const manager = fixture([{ id: 'work-1', mcpGroupId: 'work' }, { id: 'docs-1', mcpGroupId: 'docs', sleeping: true }, { id: 'docs-2', mcpGroupId: 'docs' }])
    expect(fallbackWhenSleeping(manager, 'work-1')).toBe('docs-2')
  })
})
