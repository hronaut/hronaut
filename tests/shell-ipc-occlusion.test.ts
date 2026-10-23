import type { IpcMainEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerShellIpc } from '../src/main/shell-ipc.js'

type Listener = (event: IpcMainEvent, ...args: unknown[]) => void

function shellIpc(tabs: { setBrowserContentOccluded: ReturnType<typeof vi.fn> } | null) {
  const listeners = new Map<string, Listener>()
  const ipcMain = { on: (channel: string, listener: Listener) => { listeners.set(channel, listener) }, handle: vi.fn() }
  const host = {
    handleBrowserIpc: vi.fn(),
    assertMainShellSender: vi.fn(),
    workspaceStartupFailure: () => undefined,
    tabs: () => tabs,
    sidebarOverlay: () => ({ occlusionChanged: vi.fn() })
  }
  registerShellIpc(ipcMain as never, host as never)
  let destroyed = false
  const sender = { isDestroyed: () => destroyed, send: vi.fn() }
  return {
    sender,
    destroySender: () => { destroyed = true },
    occlude: (occluded: boolean, request: unknown) => listeners.get('browser:content-occluded')!({ sender } as unknown as IpcMainEvent, occluded, request)
  }
}

describe('covering the pages with trusted chrome', () => {
  it('reports at once, for the same request, that no page is on screen while there is no tab runtime', () => {
    // The shell's question over the pages, such as a permission dialog, takes answers only after this report.
    const { sender, occlude } = shellIpc(null)
    occlude(true, 4)
    expect(sender.send).toHaveBeenCalledExactlyOnceWith('browser:occlusion-pages-hidden', 4)
    occlude(false, 4)
    expect(sender.send).toHaveBeenCalledOnce()
  })

  it('sends no report to a shell that has closed', () => {
    const { sender, destroySender, occlude } = shellIpc(null)
    destroySender()
    occlude(true, 1)
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('leaves the report to the tab runtime when there is one, with the request it answers', () => {
    const tabs = { setBrowserContentOccluded: vi.fn() }
    const { sender, occlude } = shellIpc(tabs)
    occlude(true, 2)
    expect(tabs.setBrowserContentOccluded).toHaveBeenCalledExactlyOnceWith(true, 2)
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('refuses a request that is not a whole number it can echo', () => {
    const tabs = { setBrowserContentOccluded: vi.fn() }
    const { occlude } = shellIpc(tabs)
    for (const request of [undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '2']) {
      expect(() => occlude(true, request)).toThrow('Invalid browser content occlusion request')
    }
    expect(tabs.setBrowserContentOccluded).not.toHaveBeenCalled()
  })
})
