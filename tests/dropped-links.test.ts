import { describe, expect, it, vi } from 'vitest'
import type { DroppedLinksAccess, DroppedLinksTab } from '../src/main/browser/dropped-links/dropped-links-access.js'
import { openDroppedLink } from '../src/main/browser/dropped-links/dropped-links.js'
import type { BrowserState } from '../src/shared/types.js'

const STATE = { tabs: [] } as unknown as BrowserState

function tab(id: string, overrides: Partial<DroppedLinksTab> = {}): DroppedLinksTab {
  return { id, url: `https://example.test/${id}`, mcpGroupId: 'workspace-1', pinned: false, ...overrides }
}

/** The tab manager's tabs in display order, where a new tab opens last in its workspace, as createTab adds it. */
function manager(initial: DroppedLinksTab[], options: { beforeCreated?: (tabs: Map<string, DroppedLinksTab>) => void } = {}) {
  const tabs = new Map(initial.map((candidate) => [candidate.id, candidate]))
  const access: DroppedLinksAccess<DroppedLinksTab> = {
    getTab: (tabId) => {
      const found = tabs.get(tabId)
      if (!found) throw new Error(`No tab ${tabId}`)
      return found
    },
    tabs: () => tabs,
    // The workspaces as the strip shows them, and each workspace's pinned tabs before its others.
    orderedTabs: () => [...tabs.values()].sort((first, second) => (
      (first.mcpGroupId ?? '').localeCompare(second.mcpGroupId ?? '') || Number(second.pinned) - Number(first.pinned)
    )),
    navigate: vi.fn(async () => STATE),
    newTab: vi.fn(async (newTab: { url: string; mcpGroupId?: string }, onCreated?: (created: DroppedLinksTab) => void) => {
      const created = tab('new', { url: newTab.url, mcpGroupId: newTab.mcpGroupId ?? 'workspace-1' })
      tabs.set(created.id, created)
      options.beforeCreated?.(tabs)
      onCreated?.(created)
      return STATE
    }),
    getState: () => STATE
  }
  return { access, order: () => [...access.orderedTabs()].map((candidate) => candidate.id) }
}

describe('a link dropped on the tab strip or rail', () => {
  it('opens in the tab it was dropped on, as the person, without a new tab', async () => {
    const { access } = manager([tab('first'), tab('second')])

    await expect(openDroppedLink(access, 'https://example.com/dropped', { tabId: 'second', placement: 'onto' })).resolves.toBe(STATE)

    expect(access.navigate).toHaveBeenCalledExactlyOnceWith('https://example.com/dropped', 'second')
    expect(access.newTab).not.toHaveBeenCalled()
  })

  it.each([
    ['before', ['first', 'new', 'second', 'third']],
    ['after', ['first', 'second', 'new', 'third']]
  ] as const)('opens %s the tab near that edge in a new tab of its workspace', async (placement, order) => {
    const view = manager([tab('first'), tab('second'), tab('third')])

    await openDroppedLink(view.access, 'https://example.com/dropped', { tabId: 'second', placement })

    expect(view.access.newTab).toHaveBeenCalledExactlyOnceWith({ url: 'https://example.com/dropped', mcpGroupId: 'workspace-1' }, expect.any(Function))
    expect(view.access.navigate).not.toHaveBeenCalled()
    expect(view.order()).toEqual(order)
  })

  it('opens in a new tab of the workspace the tab is in, beside it', async () => {
    const view = manager([tab('first'), tab('elsewhere', { mcpGroupId: 'workspace-2' }), tab('last', { mcpGroupId: 'workspace-2' })])

    await openDroppedLink(view.access, 'https://example.com/dropped', { tabId: 'elsewhere', placement: 'after' })

    expect(view.access.newTab).toHaveBeenCalledWith({ url: 'https://example.com/dropped', mcpGroupId: 'workspace-2' }, expect.any(Function))
    expect(view.order()).toEqual(['first', 'elsewhere', 'new', 'last'])
  })

  // As Chrome keeps a tab that is not pinned after the pinned ones.
  it.each(['before', 'after'] as const)('opens a link dropped %s a pinned tab first among the tabs that are not pinned', async (placement) => {
    const view = manager([tab('pinned-1', { pinned: true }), tab('pinned-2', { pinned: true }), tab('first'), tab('second')])

    await openDroppedLink(view.access, 'https://example.com/dropped', { tabId: 'pinned-1', placement })

    expect(view.order()).toEqual(['pinned-1', 'pinned-2', 'new', 'first', 'second'])
  })

  it('leaves the new tab last in its workspace when the tab it was dropped beside closed meanwhile', async () => {
    const view = manager([tab('first'), tab('second'), tab('third')], { beforeCreated: (tabs) => { tabs.delete('second') } })

    await openDroppedLink(view.access, 'https://example.com/dropped', { tabId: 'second', placement: 'before' })

    expect(view.order()).toEqual(['first', 'third', 'new'])
  })

  it('opens at the end of the workspace whose New tab button it was dropped on, or of the person\'s own', async () => {
    const view = manager([tab('first'), tab('second')])

    await openDroppedLink(view.access, 'https://example.com/dropped', { workspaceId: 'workspace-1' })
    await openDroppedLink(view.access, 'example.com', {})

    expect(view.access.newTab).toHaveBeenNthCalledWith(1, { url: 'https://example.com/dropped', mcpGroupId: 'workspace-1' })
    expect(view.access.newTab).toHaveBeenNthCalledWith(2, { url: 'example.com', mcpGroupId: undefined })
  })

  it('reads the text as the address bar reads a paste, so an address split over lines opens whole and words search', async () => {
    const { access } = manager([tab('first')])

    await openDroppedLink(access, '  https://example.com/a\n  /b?c=1 ', { tabId: 'first', placement: 'onto' })
    await openDroppedLink(access, 'spell check\nlanguages', { tabId: 'first', placement: 'onto' })

    expect(access.navigate).toHaveBeenNthCalledWith(1, 'https://example.com/a/b?c=1', 'first')
    // The tab manager's navigation searches for text that is no address, as for text typed in the address bar.
    expect(access.navigate).toHaveBeenNthCalledWith(2, 'spell check languages', 'first')
  })

  // As in Chrome, which refuses a dropped javascript: address, whatever follows the scheme.
  it.each(['javascript:alert(document.cookie)', '  JavaScript:example.com', 'java\nscript:alert(1)', '\u0001javascript:alert(1)'])('opens nothing for %j', async (text) => {
    const { access } = manager([tab('first')])

    for (const target of [{ tabId: 'first', placement: 'onto' }, { tabId: 'first', placement: 'after' }, { workspaceId: 'workspace-1' }] as const) {
      await expect(openDroppedLink(access, text, target)).resolves.toBe(STATE)
    }

    expect(access.navigate).not.toHaveBeenCalled()
    expect(access.newTab).not.toHaveBeenCalled()
  })

  it('opens nothing for empty text or text longer than the longest address Chrome loads', async () => {
    const { access } = manager([tab('first')])

    await openDroppedLink(access, ' \n\t ', { tabId: 'first', placement: 'onto' })
    await openDroppedLink(access, `https://example.com/${'a'.repeat(2 * 1024 * 1024)}`, { tabId: 'first', placement: 'onto' })
    await openDroppedLink(access, `https://example.com/${'a'.repeat(2 * 1024 * 1024 - 20)}`, { tabId: 'first', placement: 'onto' })

    expect(access.navigate).toHaveBeenCalledOnce()
    expect(access.newTab).not.toHaveBeenCalled()
  })

  it('opens nothing on Home, and refuses a tab that is not open', async () => {
    const { access } = manager([tab('home', { url: 'hronaut://home', mcpGroupId: undefined })])

    await expect(openDroppedLink(access, 'https://example.com/', { tabId: 'home', placement: 'onto' })).resolves.toBe(STATE)
    await expect(openDroppedLink(access, 'https://example.com/', { tabId: 'home', placement: 'after' })).resolves.toBe(STATE)
    await expect(openDroppedLink(access, 'https://example.com/', { tabId: 'closed', placement: 'onto' })).rejects.toThrow('No tab closed')

    expect(access.navigate).not.toHaveBeenCalled()
    expect(access.newTab).not.toHaveBeenCalled()
  })
})
