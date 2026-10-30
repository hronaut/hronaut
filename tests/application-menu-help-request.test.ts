import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ Menu: { buildFromTemplate: (template: unknown) => template, setApplicationMenu: () => undefined } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// Spell check's Language settings open Settings as the menu's Settings item does, through the menu's help request.

function menuWith(webContentsDestroyed: boolean) {
  const send = vi.fn()
  const showWindow = vi.fn()
  const menu = createApplicationMenu({
    text: (key) => key, showWindow, mainWindow: () => ({ id: 1, webContents: { send, isDestroyed: () => webContentsDestroyed } }) as never,
    checkForUpdates: vi.fn(), requestQuit: vi.fn(), runNativeBrowserAction: vi.fn(), runShortcut: vi.fn(), runPageNextPane: vi.fn(),
    tabs: () => null
  })
  return { menu, send, showWindow }
}

describe('the application menu\'s help request', () => {
  it('shows the window and asks its shell to open the action', () => {
    const { menu, send, showWindow } = menuWith(false)
    menu.requestHelp('settings')
    expect(showWindow).toHaveBeenCalledOnce()
    expect(send.mock.calls).toEqual([['help:open', 'settings']])
  })

  it('sends nothing to a shell whose page is gone', () => {
    const { menu, send, showWindow } = menuWith(true)
    menu.requestHelp('settings')
    expect(showWindow).toHaveBeenCalledOnce()
    expect(send).not.toHaveBeenCalled()
  })
})
