import type { IpcMainEvent } from 'electron'
import { expect, it, vi } from 'vitest'
import { registerShellIpc } from '../src/main/shell-ipc.js'

type Listener = (event: IpcMainEvent, ...args: unknown[]) => void

/** The shell IPC with a main window's shell and a detached panel window that draws the same states. */
function shellIpc(tabs: { stateDrawn: ReturnType<typeof vi.fn> } | null) {
  const listeners = new Map<string, Listener>()
  const ipcMain = { on: (channel: string, listener: Listener) => { listeners.set(channel, listener) }, handle: vi.fn() }
  const mainShell = { id: 1 }
  const panelWindow = { id: 2 }
  registerShellIpc(ipcMain as never, {
    handleBrowserIpc: vi.fn(),
    assertMainShellSender: vi.fn(),
    isMainShellSender: (event: IpcMainEvent) => event.sender === (mainShell as never),
    workspaceStartupFailure: () => undefined,
    tabs: () => tabs
  } as never)
  const drawn = (sender: object) => listeners.get('browser:state-drawn')!({ sender } as unknown as IpcMainEvent)
  return { drawnByMainShell: () => drawn(mainShell), drawnByPanelWindow: () => drawn(panelWindow) }
}

it('paces the browser state by the main window’s shell, not by a detached panel window', () => {
  const tabs = { stateDrawn: vi.fn() }
  const { drawnByMainShell, drawnByPanelWindow } = shellIpc(tabs)
  drawnByMainShell()
  expect(tabs.stateDrawn).toHaveBeenCalledOnce()
  // A panel window runs the same shell code and says so too; it neither paces the states nor fails.
  expect(() => drawnByPanelWindow()).not.toThrow()
  expect(tabs.stateDrawn).toHaveBeenCalledOnce()
})

it('ignores a drawn state while there is no tab runtime', () => {
  const { drawnByMainShell } = shellIpc(null)
  expect(() => drawnByMainShell()).not.toThrow()
})
