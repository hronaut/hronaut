import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { BrowserDebuggerQueue } from '../src/main/browser/debugger-queue.js'
import { ReactInspectionController, boundReactInspectionResponse, type ReactInspectionTarget } from '../src/main/browser/react-inspection.js'
import { reactInspectionMenu } from '../src/main/browser/react-inspection-menu.js'
import { BROWSER_TOOL_CATALOG } from '../src/main/mcp/tool-catalog.js'
import type { ReactInspectionResult } from '../src/shared/react-inspection.js'

function harness(url = 'https://fixture.test/') {
  const emitter = Object.assign(new EventEmitter(), {
    id: 99, getURL: () => url, isDestroyed: () => false, send: vi.fn(),
    debugger: { isAttached: () => true, sendCommand: vi.fn() }
  })
  const target: ReactInspectionTarget = {
    identity: {}, page: emitter as unknown as WebContents, workspaceId: 'workspace', workspaceIdentity: {},
    permissionGeneration: 0, navigationGeneration: 0, observationGeneration: 0
  }
  const queue = new BrowserDebuggerQueue()
  const authority = { assertCurrent: vi.fn(), epoch: 'authority-1' }
  const controller = new ReactInspectionController({
    resolve: () => target, run: (id, action) => queue.run(id, action),
    requireDebuggerOwner: () => {}, requireDebuggerCleanupOwner: () => {}, mainWorldContextId: async () => 1
  })
  const hold = () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const pending = queue.run(emitter.id, () => gate)
    return { release, pending }
  }
  return { controller, target, emitter, authority, hold }
}

describe('React inspection lifecycle', () => {
  it('defaults off and reports disabled even before a tab has an initial URL', async () => {
    const h = harness('')
    expect((await h.controller.run('tab', { action: 'status' }, h.authority)).status).toBe('disabled')
    expect((await h.controller.run('tab', { action: 'enable' }, h.authority)).status).toBe('unavailable')
    expect(h.controller.bootstrap('tab')).toEqual({ enabled: false })
    h.controller.dispose()
  })
  it('enables only future authorized documents and distinguishes residue from installation', async () => {
    const h = harness()
    expect((await h.controller.run('tab', { action: 'enable' }, h.authority)).status).toBe('reload-required')
    expect(h.emitter.send).not.toHaveBeenCalled()
    const first = h.controller.bootstrap('tab')
    expect(first.enabled).toBe(true)
    h.emitter.emit('did-start-navigation', {}, 'https://fixture.test/#hash', true, true)
    expect(h.controller.status('tab').installationId).toBe(first.installationId)
    h.emitter.emit('did-start-navigation', {}, 'https://fixture.test/next', false, true)
    expect(h.controller.bootstrap('tab').installationId).not.toBe(first.installationId)
    expect(h.controller.disable('tab').status).toBe('disabled-reload-required')
    expect(h.emitter.send).toHaveBeenCalledWith('react-inspection:disable')
    expect(h.controller.bootstrap('tab')).toEqual({ enabled: false })
    h.controller.dispose()
    expect(h.emitter.listenerCount('destroyed')).toBe(0)
    expect(h.emitter.listenerCount('did-start-navigation')).toBe(0)
  })
  it.each([false, true])('retains current-document residue across repeated enable (already disabled: %s)', async alreadyDisabled => {
    const h = harness()
    await h.controller.run('tab', { action: 'enable' }, h.authority)
    const installed = h.controller.bootstrap('tab')
    if (alreadyDisabled) h.controller.disable('tab')
    const enabled = await h.controller.run('tab', { action: 'enable' }, h.authority)
    expect(enabled).toMatchObject({ status: 'reload-required', reloadRequired: true })
    expect(enabled.installationId).toBeUndefined()
    expect((await h.controller.run('tab', { action: 'tree', subtreeId: installed.installationId }, h.authority)).nodes).toEqual([])
    expect(h.controller.disable('tab')).toMatchObject({ status: 'disabled-reload-required', enabled: false, reloadRequired: true })
    expect(h.emitter.send).toHaveBeenCalledWith('react-inspection:disable')
    h.emitter.emit('did-start-navigation', {}, 'https://fixture.test/#same', true, true)
    expect(h.controller.status('tab').status).toBe('disabled-reload-required')
    h.emitter.emit('did-start-navigation', {}, 'https://fixture.test/next', false, true)
    expect(h.controller.status('tab')).toMatchObject({ status: 'disabled', reloadRequired: false })
    expect(h.controller.bootstrap('tab')).toEqual({ enabled: false })
    h.controller.dispose()
  })
  it('a later disable defeats an enable still waiting for native queue admission', async () => {
    const h = harness()
    const gate = h.hold()
    const pending = h.controller.run('tab', { action: 'enable' }, h.authority)
    h.controller.disable('tab')
    gate.release()
    await gate.pending
    expect((await pending).status).toBe('interrupted')
    expect(h.controller.bootstrap('tab')).toEqual({ enabled: false })
    h.controller.dispose()
  })
  it('permission roundtrip and authority revocation defeat queued activation', async () => {
    const h = harness()
    const gate = h.hold()
    const pending = h.controller.run('tab', { action: 'enable' }, h.authority)
    h.target.permissionGeneration += 2
    gate.release()
    expect((await pending).status).toBe('interrupted')
    expect(h.controller.bootstrap('tab')).toEqual({ enabled: false })
    const denied = h.hold()
    const activation = h.controller.run('tab', { action: 'enable' }, h.authority)
    h.authority.assertCurrent.mockImplementation(() => { throw new Error('revoked') })
    denied.release()
    await expect(activation).rejects.toThrow('revoked')
    h.controller.dispose()
  })
  it('close/rollback invalidation and a new controller never inherit enabled intent', async () => {
    const h = harness()
    await h.controller.run('tab', { action: 'enable' }, h.authority)
    h.controller.bootstrap('tab')
    h.controller.invalidateWorkspace('workspace')
    expect(h.controller.bootstrap('tab').enabled).toBe(false)
    h.emitter.emit('destroyed')
    expect(h.controller.status('tab').status).toBe('disabled')
    const restarted = harness()
    expect(restarted.controller.bootstrap('tab').enabled).toBe(false)
    h.controller.dispose(); restarted.controller.dispose()
  })
})

it('bounds the entire returned MCP text envelope, preserving parent links and explicit partial status', () => {
  const result: ReactInspectionResult = {
    status: 'ready', enabled: true, reloadRequired: false, navigationGeneration: 1, installationId: 'installation',
    nodes: Array.from({ length: 80 }, (_, index) => ({ id: 'id-' + index + 'x'.repeat(110), parent: index ? 'id-0' + 'x'.repeat(110) : null, name: '界'.repeat(80) })),
    partial: false, visited: 80, coverage: 'observed-topology-only'
  }
  const bounded = boundReactInspectionResponse(result)
  expect(Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(bounded, null, 2) }] }))).toBeLessThanOrEqual(16000)
  expect(bounded).toMatchObject({ partial: true, limit: 'bytes' })
  const ids = new Set(bounded.nodes.map(node => node.id))
  expect(bounded.nodes.every(node => node.parent === null || ids.has(node.parent))).toBe(true)
})

it('uses an explicit native checkbox without navigation and advertises a mixed mutating MCP tool', () => {
  const state = harness()
  const activate = vi.fn()
  const menu = reactInspectionMenu(state.controller.status('tab'), {
    title: 'React', enable: 'Enable', disabled: 'Off', reloadRequired: 'Reload required', installed: 'Installed', residue: 'Residue'
  }, activate, true)
  const children = menu.submenu as Electron.MenuItemConstructorOptions[]
  expect(children[0]).toMatchObject({ type: 'checkbox', checked: false })
  expect(children[1]).toMatchObject({ label: 'Off', enabled: false })
  ;(children[0]!.click as () => void)()
  expect(activate).toHaveBeenCalledWith(true)
  expect(BROWSER_TOOL_CATALOG.find(tool => tool.name === 'browser_react')?.annotations.readOnlyHint).toBe(false)
  state.controller.dispose()
})
