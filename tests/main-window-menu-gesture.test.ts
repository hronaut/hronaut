import { afterEach, describe, expect, it, vi } from 'vitest'

const popup = vi.fn()

vi.mock('electron', () => ({
  BrowserWindow: class {},
  Menu: { getApplicationMenu: () => ({ popup }) },
  nativeTheme: {},
  screen: {}
}))

const { createMainWindow } = await import('../src/main/windows/main-window.js')

type InputListener = (event: { preventDefault(): void }, input: { type: string; key: string; code?: string }) => void

/** A main window under an overlaid title bar whose shell answers whether a text field has the keyboard. */
function windowWithGesture(platform: NodeJS.Platform, typing: boolean | Error, focused = true) {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
  const listeners: InputListener[] = []
  const executeJavaScript = vi.fn(() => typing instanceof Error ? Promise.reject(typing) : Promise.resolve(typing))
  const window = {
    on: () => undefined,
    isDestroyed: () => false,
    isFocused: () => focused,
    webContents: {
      on: (name: string, listener: InputListener) => { if (name === 'before-input-event') listeners.push(listener) },
      executeJavaScript
    }
  }
  createMainWindow({
    refs: { window: window as never, chromeMode: 'overlay', controlsScrim: null, material: null, stateStore: null, lastState: null, showRequested: false },
    settings: () => ({ theme: 'dark', tabPosition: 'top', interfaceScale: 1, useSystemTitleBar: false }),
    resolvedTheme: () => 'dark',
    themeBackground: {} as never,
    acknowledgeUserAttention: () => undefined,
    quitting: () => false
  }).attachMenuBarGesture()
  const send = (type: string, key: string, code?: string): void => {
    for (const listener of listeners) listener({ preventDefault: () => undefined }, { type, key, ...(code ? { code } : {}) })
  }
  const pressAltAlone = async (): Promise<void> => {
    send('keyDown', 'Alt', 'AltLeft')
    send('keyUp', 'Alt', 'AltLeft')
    await vi.waitFor(() => expect(platform === 'linux' ? executeJavaScript.mock.calls.length : 1).toBe(1))
    // The answer's continuation runs after the shell's promise settles.
    await new Promise((resolve) => setTimeout(resolve))
  }
  return { pressAltAlone, executeJavaScript }
}

describe('the application menu under an overlaid title bar', () => {
  afterEach(() => {
    popup.mockClear()
    vi.restoreAllMocks()
  })

  it('pops up for Alt alone on Linux while no text field has the keyboard', async () => {
    await windowWithGesture('linux', false).pressAltAlone()
    expect(popup).toHaveBeenCalledOnce()
  })

  it('stays closed on Linux while the person types in a shell text field, where Alt+Shift can arrive as Alt alone', async () => {
    await windowWithGesture('linux', true).pressAltAlone()
    expect(popup).not.toHaveBeenCalled()
  })

  it('stays closed on Linux once the window lost focus while the shell was asked', async () => {
    await windowWithGesture('linux', false, false).pressAltAlone()
    expect(popup).not.toHaveBeenCalled()
  })

  it('pops up on Linux when the shell cannot answer', async () => {
    await windowWithGesture('linux', new Error('The shell is reloading')).pressAltAlone()
    expect(popup).toHaveBeenCalledOnce()
  })

  it('pops up on Windows without asking the shell', async () => {
    const { pressAltAlone, executeJavaScript } = windowWithGesture('win32', true)
    await pressAltAlone()
    expect(popup).toHaveBeenCalledOnce()
    expect(executeJavaScript).not.toHaveBeenCalled()
  })
})
