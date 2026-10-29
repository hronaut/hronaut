import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
import { Browser } from '../src/main/browser/browser.js'
import { ImageInspectionSlots } from '../src/main/browser/image-state.js'

it.each(['validator', 'listener'])('releases sizing ownership after %s failure following acquisition', async stage => {
  const contents = Object.assign(new EventEmitter(), { isDestroyed: () => false, executeJavaScriptInIsolatedWorld: vi.fn(async () => true) })
  const context = { tabId: 'tab', workspaceId: 'workspace', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0, snapshotFormatVersion: 1 }
  const tab = { id: 'tab', url: 'https://example.test/', mcpGroupId: 'workspace', webContents: contents, pageLifecycleState: 'active' }
  const slots = new ImageInspectionSlots()
  const manager = Object.assign(Object.create(Browser.prototype), {
    snapshotDeltaContext: () => context,
    tabs: new Map([['tab', tab]]), mcpTabGroups: new Map([['workspace', {}]]), inspectionPermissions: new WeakMap(),
    sizingInspectionSlots: slots, destroyed: false
  }) as Browser
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

it('runs the parent flex context on the guarded sizing path, and only for one unique selector', async () => {
  const scripts: string[] = []
  const raw = { selector: '#target', tag: 'div', sizingInputs: { 'flex-grow': 1 }, flexContainer: { status: 'unavailable', reason: 'not-flex-container' } }
  const contents = Object.assign(new EventEmitter(), {
    id: 7, isDestroyed: () => false, isDevToolsOpened: () => false,
    executeJavaScriptInIsolatedWorld: vi.fn(async (_world: number, sources: Array<{ code: string }>) => { scripts.push(sources[0]!.code); return scripts.length === 1 ? raw : true })
  })
  const context = { tabId: 'tab', workspaceId: 'workspace', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0, snapshotFormatVersion: 1 }
  const tab = { id: 'tab', url: 'https://example.test/', title: 'Example', mcpGroupId: 'workspace', webContents: contents, pageLifecycleState: 'active' }
  const manager = Object.assign(Object.create(Browser.prototype), {
    snapshotDeltaContext: () => context,
    tabs: new Map([['tab', tab]]), mcpTabGroups: new Map([['workspace', {}]]), inspectionPermissions: new WeakMap(),
    sizingInspectionSlots: new ImageInspectionSlots(), destroyed: false
  }) as Browser
  const report = await manager.elementInspection({ tabId: 'tab', selector: '#target', includeFlexContainer: true })
  expect(report).toMatchObject({ sizingInputs: { 'flex-grow': 1 }, flexContainer: { status: 'unavailable', reason: 'not-flex-container' } })
  // The capture reads the parent and checks it again when it settles.
  expect(scripts[0]).toContain('element.parentElement===parent')
  expect(scripts[0]).toContain('__hronautSizingInputs')
  expect(scripts[1]).toContain('__hronautSizingInputs')
  for (const [options, message] of [
    [{ selector: '#target', includeFlexContainer: true, ref: 'e1' }, /unique selector/],
    [{ selector: '#target', includeFlexContainer: true, includeSizingInputs: false }, /omit includeSizingInputs or set it to true/],
    [{ selector: '#target', includeFlexContainer: 'true' as unknown as boolean }, /includeFlexContainer must be a boolean/],
    [{ selector: '#target', includeFlexContainer: true, includeValidity: true }, /cannot combine|cannot be combined/]
  ] as const) await expect(manager.elementInspection({ tabId: 'tab', ...options }), JSON.stringify(options)).rejects.toThrow(message)
})
