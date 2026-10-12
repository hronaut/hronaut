import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'
import type { StorageInspectionHooks } from '../src/main/browser/storage-inspection-operation.js'

for (const stage of ['queue', 'monitor', 'attach', 'Page.enable', 'Runtime.enable', 'Runtime.setAsyncCallStackDepth', 'Log.enable', 'primary', 'fallback', 'unchanged'] as const) it(`checks quota authority at ${stage} without fallback after a one-shot veto`, async () => {
  let veto = false
  const context = { tabId: 'tab', workspaceId: 'workspace', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0, snapshotFormatVersion: 1 }
  const contents = {
    id: 1, isDestroyed: () => false, isDevToolsOpened: () => false,
    debugger: {
      isAttached: () => false,
      attach: vi.fn(() => { if (stage === 'attach') veto = true }),
      sendCommand: vi.fn(async (method: string) => {
        if (stage === method || (stage === 'primary' && method === 'Storage.getUsageAndQuota')) veto = true
        if (method === 'Storage.getUsageAndQuota' && stage === 'fallback') throw new Error('unsupported command')
        return { usage: 1, quota: 100 }
      })
    },
    executeJavaScriptInIsolatedWorld: vi.fn(async () => { if (stage === 'fallback') veto = true; return { usage: 1, quota: 100 } })
  }
  const tab = { id: 'tab', url: 'https://example.test/', mcpGroupId: 'workspace', webContents: contents }
  const workspace = {}
  const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
    getTab: () => tab, snapshotDeltaContext: () => context,
    tabs: new Map([['tab', tab]]), mcpTabGroups: new Map([['workspace', workspace]]), inspectionPermissions: new WeakMap(),
    devToolsOpening: new Set(), destroyed: false,
    debuggerQueue: { run: async (_id: number, operation: () => Promise<unknown>) => { if (stage === 'queue') veto = true; return operation() } },
    dialogMonitorAttachPromises: new Map([[1, { then: (resolve: () => void) => { if (stage === 'monitor') veto = true; resolve() } }]])
  }) as BrowserTabsManager
  let publication: (() => void) | undefined
  const started = vi.fn()
  const hooks: StorageInspectionHooks = { validate: () => { if (veto) { veto = false; throw new Error('private one-shot authority veto') } }, readStarted: started, retainPublication: guard => { publication = guard } }
  if (stage === 'unchanged') {
    await expect(manager.inspectStorageUsage('tab', hooks)).resolves.toMatchObject({ source: 'chromium-quota', usage: 1 })
    expect(publication).not.toThrow()
  } else {
    await expect(manager.inspectStorageUsage('tab', hooks)).rejects.toThrow('Storage observation was withheld')
    expect(publication).toThrow('Storage observation was withheld')
  }
  const methods = contents.debugger.sendCommand.mock.calls.map(([method]) => method)
  const preparation = ['Page.enable', 'Runtime.enable', 'Runtime.setAsyncCallStackDepth', 'Log.enable']
  const index = preparation.indexOf(stage)
  expect(methods).toEqual(['queue', 'monitor', 'attach'].includes(stage) ? [] : index >= 0 ? preparation.slice(0, index + 1) : [...preparation, 'Storage.getUsageAndQuota'])
  expect(contents.debugger.attach).toHaveBeenCalledTimes(['queue', 'monitor'].includes(stage) ? 0 : 1)
  expect(contents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(stage === 'fallback' ? 1 : 0)
  expect(started).toHaveBeenCalledTimes(stage === 'fallback' ? 2 : ['primary', 'unchanged'].includes(stage) ? 1 : 0)
})
