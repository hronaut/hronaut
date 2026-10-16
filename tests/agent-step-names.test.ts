import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'
import { BROWSER_SNAPSHOT_FORMAT_VERSION } from '../src/shared/snapshot.js'

function fixture() {
  let targetNames: unknown = []
  const page = (id: string, mcpGroupId: string) => ({
    id, mcpGroupId, navigationGeneration: 1, observationGeneration: 0, humanInteractionGeneration: 0,
    webContents: {
      isDestroyed: () => false,
      executeJavaScriptInIsolatedWorld: vi.fn(async () => ({
        formatVersion: BROWSER_SNAPSHOT_FORMAT_VERSION, text: '[e1] button "Review order"', maxChars: 30_000, returnedChars: 26,
        truncated: false, omitted: { headings: false, controls: false, bodyText: false, characters: false }, targetNames
      }))
    }
  })
  const checkout = page('tab-1', 'workspace-a')
  const admin = page('tab-2', 'workspace-b')
  const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
    tabs: new Map([[checkout.id, checkout], [admin.id, admin]]),
    activeTabId: admin.id,
    mcpTabGroups: new Map([['workspace-a', { activeTabId: checkout.id }], ['workspace-b', { activeTabId: admin.id }]])
  }) as BrowserTabsManager
  return { manager, checkout, show: (names: unknown) => { targetNames = names } }
}

it('keeps the control names a snapshot showed for the shell, never returns them to agents, and forgets them after navigation', async () => {
  const { manager, checkout, show } = fixture()
  show([['e1', 'Review order'], ['e2', 'Promo code'], ['bad', 'Not a ref'], ['e3', 42], 'junk', ['e4', 'x'.repeat(500)]])
  const snapshot = await manager.snapshotDetails('tab-1')
  expect(snapshot).not.toHaveProperty('targetNames')
  expect(snapshot.text).toBe('[e1] button "Review order"')
  expect(manager.agentStepName('workspace-a', 'tab-1', 'e1')).toBe('Review order')
  // Without a tab, the one a workspace tool would use.
  expect(manager.agentStepName('workspace-a', undefined, 'e2')).toBe('Promo code')
  expect(manager.agentStepName('workspace-a', 'tab-1', 'bad')).toBeUndefined()
  expect(manager.agentStepName('workspace-a', 'tab-1', 'e3')).toBeUndefined()
  expect(manager.agentStepName('workspace-a', 'tab-1', 'e4')).toHaveLength(120)
  // Another workspace never reads them, and an unknown one reads nothing.
  expect(manager.agentStepName('workspace-b', 'tab-1', 'e1')).toBeUndefined()
  expect(manager.agentStepName('workspace-b', undefined, 'e1')).toBeUndefined()
  expect(manager.agentStepName('workspace-z', 'tab-1', 'e1')).toBeUndefined()

  // A component capture adds names; a capture of the whole page replaces them.
  show([['e9', 'Pay now']])
  await manager.snapshotDetails('tab-1', 30_000, '#checkout')
  expect([manager.agentStepName('workspace-a', 'tab-1', 'e1'), manager.agentStepName('workspace-a', 'tab-1', 'e9')]).toEqual(['Review order', 'Pay now'])
  await manager.snapshotDetails('tab-1')
  expect([manager.agentStepName('workspace-a', 'tab-1', 'e1'), manager.agentStepName('workspace-a', 'tab-1', 'e9')]).toEqual([undefined, 'Pay now'])

  // A new page: the names belong to the old one.
  checkout.navigationGeneration = 2
  expect(manager.agentStepName('workspace-a', 'tab-1', 'e9')).toBeUndefined()
  show([['e9', 'Continue']])
  await manager.snapshotDetails('tab-1', 30_000, '#next')
  expect(manager.agentStepName('workspace-a', 'tab-1', 'e9')).toBe('Continue')
})
