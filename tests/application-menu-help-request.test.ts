import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ Menu: { buildFromTemplate: (template: unknown) => template, setApplicationMenu: () => undefined } }))
import { createApplicationMenu } from '../src/main/windows/application-menu.js'

// Spell check's Language settings open Settings as the menu's Settings item does, through the menu's help request.

function menuWith(window: 'open' | 'page gone' | 'none') {
  const send = vi.fn()
  const showWindow = vi.fn()
  const menu = createApplicationMenu({
    text: (key) => key, showWindow,
    mainWindow: () => window === 'none' ? null : ({ id: 1, webContents: { send, isDestroyed: () => window === 'page gone' } }) as never,
    checkForUpdates: vi.fn(), requestQuit: vi.fn(), runNativeBrowserAction: vi.fn(), runShortcut: vi.fn(), runPageNextPane: vi.fn(),
    tabs: () => null
  })
  return { menu, send, showWindow }
}

describe('the application menu\'s help request', () => {
  it('shows the window and asks its shell to open the action', () => {
    const { menu, send, showWindow } = menuWith('open')
    menu.requestHelp('settings')
    expect(showWindow).toHaveBeenCalledOnce()
    expect(send.mock.calls).toEqual([['help:open', 'settings']])
  })

  it.each(['page gone', 'none'] as const)('sends nothing when the window\'s page is gone or there is no window (%s)', (window) => {
    const { menu, send, showWindow } = menuWith(window)
    menu.requestHelp('settings')
    expect(showWindow).toHaveBeenCalledOnce()
    expect(send).not.toHaveBeenCalled()
  })
})
