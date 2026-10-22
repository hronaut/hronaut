import { describe, expect, it, vi } from 'vitest'
import { attachHistoryMouseButtons } from '../src/main/windows/history-mouse-buttons.js'

// Hronaut had no way back or forward from the mouse: its side buttons did nothing.

function attached() {
  let listener: ((event: unknown, command: string) => void) | undefined
  const window = { on: vi.fn((name: string, callback: typeof listener) => { if (name === 'app-command') listener = callback }) }
  const tabs = { historyGesture: vi.fn() }
  const actions: string[] = []
  attachHistoryMouseButtons(window as never, {
    runNativeBrowserAction: (action, callback) => { actions.push(action); callback() },
    tabs: () => tabs as never
  })
  return { tabs, actions, button: (command: string) => listener!({}, command) }
}

const turn = () => new Promise(resolve => setImmediate(resolve))

describe('the mouse\'s side buttons', () => {
  it('go back and forward in the shown tab once the press is through, as in Chrome', async () => {
    const { tabs, actions, button } = attached()
    button('browser-backward')
    // On Linux the press has yet to reach the page, which in split view makes the pane under the pointer the shown tab.
    expect(tabs.historyGesture).not.toHaveBeenCalled()
    await turn()
    expect(tabs.historyGesture).toHaveBeenLastCalledWith('back')
    button('browser-forward')
    await turn()
    expect(tabs.historyGesture).toHaveBeenLastCalledWith('forward')
    expect(actions).toEqual(['go back', 'go forward'])
  })

  it('leave other app commands alone', async () => {
    const { tabs, actions, button } = attached()
    button('browser-refresh')
    button('media-play-pause')
    await turn()
    expect(tabs.historyGesture).not.toHaveBeenCalled()
    expect(actions).toEqual([])
  })
})
