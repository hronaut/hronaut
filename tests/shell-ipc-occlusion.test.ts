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
  const sender = { isDestroyed: () => false, send: vi.fn() }
  return { sender, occlude: (occluded: boolean) => listeners.get('browser:content-occluded')!({ sender } as unknown as IpcMainEvent, occluded) }
}

describe('covering the pages with trusted chrome', () => {
  it('reports at once that no page is on screen while there is no tab runtime', () => {
    // The shell's question over the pages, such as a permission dialog, takes answers only after this report.
    const { sender, occlude } = shellIpc(null)
    occlude(true)
    expect(sender.send).toHaveBeenCalledExactlyOnceWith('browser:occlusion-pages-hidden')
    occlude(false)
    expect(sender.send).toHaveBeenCalledOnce()
  })

  it('leaves the report to the tab runtime when there is one', () => {
    const tabs = { setBrowserContentOccluded: vi.fn() }
    const { sender, occlude } = shellIpc(tabs)
    occlude(true)
    expect(tabs.setBrowserContentOccluded).toHaveBeenCalledExactlyOnceWith(true)
    expect(sender.send).not.toHaveBeenCalled()
  })
})
