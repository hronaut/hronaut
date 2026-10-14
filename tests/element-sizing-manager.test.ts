import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
import { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'
import { ImageInspectionSlots } from '../src/main/browser/image-state.js'

it.each(['validator', 'listener'])('releases sizing ownership after %s failure following acquisition', async stage => {
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, executeJavaScriptInIsolatedWorld: vi.fn(async () => true) })
  const context = { tabId: 'tab', workspaceId: 'workspace', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0, snapshotFormatVersion: 1 }
  const tab = { id: 'tab', url: 'https://example.test/', mcpGroupId: 'workspace', webContents: contents, pageLifecycleState: 'active' }
  const slots = new ImageInspectionSlots()
  const manager = Object.assign(Object.create(BrowserTabsManager.prototype), {
    getTab: () => tab, snapshotDeltaContext: () => context,
    tabs: new Map([['tab', tab]]), mcpTabGroups: new Map([['workspace', {}]]), inspectionPermissions: new WeakMap(),
    sizingInspectionSlots: slots, destroyed: false
  }) as BrowserTabsManager
  const on = contents.on
  if (stage === 'listener') contents.on = function (...args) { on.apply(this, args); throw Error('listener failure') }
  let checks = 0
  await expect(manager.elementInspection({ tabId: 'tab', selector: '#target', includeSizingInputs: true }, () => {
    if (stage === 'validator' && ++checks === 2) throw Error('validator failure')
  })).rejects.toThrow(`${stage} failure`)
  contents.on = on
  await new Promise(resolve => setImmediate(resolve))
  expect(contents.listenerCount('did-navigate')).toBe(0)
  const capacity = Array.from({ length: 8 }, () => slots.acquire(contents))
  expect(() => slots.acquire(contents)).toThrow('busy')
  capacity.forEach(slot => slot.close())
})
