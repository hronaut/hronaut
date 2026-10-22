import { describe, expect, it, vi } from 'vitest'
import { attachHistoryMouseButtons } from '../src/main/windows/history-mouse-buttons.js'

// Hronaut had no way back or forward from the mouse: its side buttons did nothing.

function attached() {
  let listener: ((event: unknown, command: string) => void) | undefined
  const window = { on: vi.fn((name: string, callback: typeof listener) => { if (name === 'app-command') listener = callback }) }
  const tabs = { back: vi.fn(), forward: vi.fn() }
  const actions: string[] = []
  attachHistoryMouseButtons(window as never, {
    runNativeBrowserAction: (action, callback) => { actions.push(action); callback() },
    tabs: () => tabs as never
  })
  return { tabs, actions, button: (command: string) => listener!({}, command) }
}

describe('the mouse\'s side buttons', () => {
  it('go back and forward in the shown tab, as in Chrome', () => {
    const { tabs, actions, button } = attached()
    button('browser-backward')
    expect(tabs.back).toHaveBeenCalledWith()
    button('browser-forward')
    expect(tabs.forward).toHaveBeenCalledWith()
    expect(actions).toEqual(['go back', 'go forward'])
  })

  it('leave other app commands alone', () => {
    const { tabs, actions, button } = attached()
    button('browser-refresh')
    button('media-play-pause')
    expect(tabs.back).not.toHaveBeenCalled()
    expect(tabs.forward).not.toHaveBeenCalled()
    expect(actions).toEqual([])
  })
})
