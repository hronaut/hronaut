import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'
import { BROWSER_SNAPSHOT_FORMAT_VERSION } from '../src/shared/snapshot.js'

function fixture() {
  let targetNames: unknown = []
  const page = (id: string, mcpGroupId: string) => ({
    id, mcpGroupId, navigationGeneration: 1, walletNavigationGeneration: 1, observationGeneration: 0, humanInteractionGeneration: 0,
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
    // Snapshots read the person's settings, here the defaults.
    options: {},
    tabs: new Map([[checkout.id, checkout], [admin.id, admin]]),
    activeTabId: admin.id,
    mcpTabGroups: new Map([['workspace-a', { activeTabId: checkout.id }], ['workspace-b', { activeTabId: admin.id }]])
  }) as BrowserTabsManager
  return { manager, checkout, show: (names: unknown) => { targetNames = names } }
}

it('keeps the control names the latest snapshot showed for the shell, never returns them to agents, and forgets them with the document', async () => {
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
  // Another workspace never reads them, and an unknown workspace or tab reads nothing.
  expect(manager.agentStepName('workspace-b', 'tab-1', 'e1')).toBeUndefined()
  expect(manager.agentStepName('workspace-b', undefined, 'e1')).toBeUndefined()
  expect(manager.agentStepName('workspace-z', 'tab-1', 'e1')).toBeUndefined()
  expect(manager.agentStepName('workspace-a', 'tab-closed', 'e1')).toBeUndefined()

  // Every capture replaces them, since it takes the earlier captures' refs off the page.
  show([['e9', 'Pay now']])
  await manager.snapshotDetails('tab-1', 30_000, '#checkout')
  expect([manager.agentStepName('workspace-a', 'tab-1', 'e1'), manager.agentStepName('workspace-a', 'tab-1', 'e9')]).toEqual([undefined, 'Pay now'])

  // A route change within the page keeps them, as it keeps the refs; another document forgets them.
  checkout.navigationGeneration = 2
  expect(manager.agentStepName('workspace-a', 'tab-1', 'e9')).toBe('Pay now')
  checkout.navigationGeneration = 3
  checkout.walletNavigationGeneration = 3
  expect(manager.agentStepName('workspace-a', 'tab-1', 'e9')).toBeUndefined()
  show([['e9', 'Continue']])
  await manager.snapshotDetails('tab-1', 30_000, '#next')
  expect(manager.agentStepName('workspace-a', 'tab-1', 'e9')).toBe('Continue')
})
