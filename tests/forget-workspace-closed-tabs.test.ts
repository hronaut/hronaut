import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
import { Browser } from '../src/main/browser/browser.js'
import type { BrowserClosedTabState } from '../src/shared/types.js'
import { forgetWorkspaceClosedTabs } from '../src/main/browser/tab-reopening/tab-reopening.js'

// Restricting a workspace's Site access forgets its closed tabs on pages the rules now deny; the policy change's own
// test covers which pages. Here only that workspace's closed tabs go, also those held aside while a tab reopens.

interface Internals {
  closedTabs: BrowserClosedTabState[]
  detachedClosedTabs: Set<BrowserClosedTabState[]>
}

const closed = (id: string, mcpGroupId?: string): BrowserClosedTabState => ({
  id, title: id, url: 'https://shared.example/', pinned: false, closedAt: '2026-10-21T09:00:00.000Z', mcpGroupId
})

describe('forgetting a workspace\'s closed tabs', () => {
  it('forgets only that workspace\'s closed tabs on the matching pages, including one held aside', () => {
    const held = [closed('held', 'work')]
    const manager = Object.assign(Object.create(Browser.prototype), {
      closedTabs: [closed('work', 'work'), closed('docs', 'docs'), closed('home')],
      detachedClosedTabs: new Set([held])
    }) as Internals

    forgetWorkspaceClosedTabs(manager as unknown as Browser, 'work', (url) => url === 'https://shared.example/')

    expect(manager.closedTabs.map((tab) => tab.id)).toEqual(['docs', 'home'])
    expect(held).toEqual([])
  })
})
