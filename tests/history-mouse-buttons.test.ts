import { describe, expect, it, vi } from 'vitest'
import { attachHistoryMouseButtons } from '../src/main/windows/history-mouse-buttons.js'

// The buttons call the history gesture with the browser; it runs on the fake browser's stub.
vi.mock('../src/main/browser/history-gesture/history-gesture.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/history-gesture/history-gesture.js')>(),
  historyGesture: (browser: { historyGesture: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.historyGesture(...args)
}))

// Hronaut had no way back or forward from the mouse: its side buttons did nothing.

function attached() {
  let listener: ((event: unknown, command: string) => void) | undefined
  const window = { on: vi.fn((name: string, callback: typeof listener) => { if (name === 'app-command') listener = callback }) }
  const page = { isDestroyed: () => false, isLoading: vi.fn(() => true), getURL: () => 'https://example.test/', stop: vi.fn() }
  const tabs = { historyGesture: vi.fn(), activeTabId: 'tab-1', tabs: new Map([['tab-1', { webContents: page }]]) }
  const actions: string[] = []
  const shortcuts: string[] = []
  attachHistoryMouseButtons(window as never, {
    runNativeBrowserAction: (action, callback) => { actions.push(action); callback() },
    runShortcut: (action) => { shortcuts.push(action) },
    tabs: () => tabs as never
  })
  return { tabs, page, actions, shortcuts, button: (command: string) => listener!({}, command) }
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
    const { tabs, page, actions, shortcuts, button } = attached()
    button('media-play-pause')
    button('browser-favorites')
    await turn()
    expect(tabs.historyGesture).not.toHaveBeenCalled()
    expect(page.stop).not.toHaveBeenCalled()
    expect(actions).toEqual([])
    expect(shortcuts).toEqual([])
  })
})

// A Windows keyboard's Refresh, Stop, Home and Search keys did nothing: Windows reports them as app commands, which only
// the side buttons' were handled.
describe('the keyboard\'s browser keys', () => {
  it('reload, open Home and go to the address bar, as Chrome\'s keys do', async () => {
    const { tabs, actions, shortcuts, button } = attached()
    button('browser-refresh')
    button('browser-home')
    button('browser-search')
    await turn()
    expect(shortcuts).toEqual(['reload', 'open-home', 'focus-address'])
    expect(tabs.historyGesture).not.toHaveBeenCalled()
    expect(actions).toEqual([])
  })

  it('stop the shown tab while it loads, and leave a loaded page alone', () => {
    const { page, actions, button } = attached()
    button('browser-stop')
    expect(page.stop).toHaveBeenCalledOnce()
    expect(actions).toEqual(['stop loading the page'])
    page.isLoading.mockReturnValue(false)
    button('browser-stop')
    expect(page.stop).toHaveBeenCalledOnce()
  })
})
