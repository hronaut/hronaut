import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { RendererExitedError } from '../src/main/browser/renderer-exit-guard.js'
import { ensureDialogMonitoring } from '../src/main/browser/website-dialogs/website-dialogs.js'

function fixture() {
  const state = { crashed: true, attached: false }
  const commands: string[] = []
  const webContents = Object.assign(new EventEmitter(), {
    id: 7,
    isDestroyed: () => false,
    isDevToolsOpened: () => false,
    debugger: {
      isAttached: () => state.attached,
      attach: () => { state.attached = true },
      sendCommand: vi.fn(async (method: string) => {
        if (state.crashed && method !== 'Input.setIgnoreInputEvents') throw new RendererExitedError(false)
        commands.push(method)
        return method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'top' } } } : {}
      })
    }
  })
  const tab = { id: 'tab-1', webContents, networkDebuggerEnabled: false } as never as { webContents: typeof webContents; networkDebuggerEnabled: boolean; mainFrameId?: string }
  const attachments = new Map<number, Promise<void>>()
  const access = {
    isDestroyed: () => false,
    isDevToolsOpening: () => false,
    dialogMonitorAttachPromises: () => attachments,
    isHumanInteractionLocked: () => false,
    isAgentInput: () => false
  } as never
  return { state, commands, webContents, tab, access, attachments }
}

describe('dialog monitoring on a page whose renderer exited', () => {
  it('starts again on the next load without logging a failure', async () => {
    const f = fixture()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await ensureDialogMonitoring(f.access, f.tab as never)
      await ensureDialogMonitoring(f.access, f.tab as never)
      expect(f.tab.networkDebuggerEnabled).toBe(false)
      expect(f.webContents.listenerCount('dom-ready')).toBe(1)
      expect(error).not.toHaveBeenCalled()

      f.state.crashed = false
      f.webContents.emit('dom-ready')
      await f.attachments.get(7)
      expect(f.commands).toEqual(['Page.enable', 'Page.getFrameTree', 'Runtime.enable', 'Runtime.setAsyncCallStackDepth', 'Log.enable', 'Audits.enable', 'Network.enable', 'Input.setIgnoreInputEvents'])
      expect(f.tab).toMatchObject({ networkDebuggerEnabled: true, mainFrameId: 'top' })
      expect(f.webContents.listenerCount('dom-ready')).toBe(0)
    } finally {
      error.mockRestore()
    }
  })

  it('still reports other failures and does not wait for a load', async () => {
    const f = fixture()
    f.webContents.debugger.sendCommand.mockRejectedValueOnce(new Error('Protocol error'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await ensureDialogMonitoring(f.access, f.tab as never)
      expect(error).toHaveBeenCalledOnce()
      expect(f.webContents.listenerCount('dom-ready')).toBe(0)
    } finally {
      error.mockRestore()
    }
  })
})
