import { afterEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- vi.hoisted runs before imports.
  const { EventEmitter } = require('node:events') as typeof import('node:events')
  class Contents extends EventEmitter {
    readonly setWindowOpenHandler = vi.fn()
    readonly executeJavaScript = vi.fn(async (_code: string): Promise<unknown> => 300)
  }
  /** A BrowserWindow as the notice uses it: `close` asks first, `destroy` does not, and both end with `closed`. */
  class Window extends EventEmitter {
    static last: Window
    /** What the next window's load and its page's measurement do; each window takes and clears them. */
    static next: { load?: () => Promise<void>; measure?: () => Promise<unknown> } = {}
    readonly webContents = new Contents()
    destroyed = false
    readonly removeMenu = vi.fn()
    readonly loadFile = vi.fn(async (_file: string, _options?: unknown): Promise<void> => undefined)
    readonly loadURL = vi.fn(async (_url: string): Promise<void> => undefined)
    readonly setContentSize = vi.fn()
    readonly center = vi.fn()
    readonly show = vi.fn()
    readonly focus = vi.fn()
    constructor(readonly options: Record<string, unknown>) {
      super()
      Window.last = this
      if (Window.next.load) this.loadFile.mockImplementationOnce(Window.next.load)
      if (Window.next.measure) this.webContents.executeJavaScript.mockImplementationOnce(Window.next.measure)
      Window.next = {}
    }
    isDestroyed(): boolean { return this.destroyed }
    destroy(): void {
      if (this.destroyed) return
      this.destroyed = true
      this.emit('closed')
    }
    close(): void {
      this.emit('close')
      this.destroy()
    }
  }
  return { Window }
})
vi.mock('electron', () => ({ app: { isPackaged: true }, BrowserWindow: fake.Window }))

import { showStartupNoticeWindow } from '../src/main/windows/startup-notice-window.js'

const notice = { title: 'Saved workspaces could not be opened', message: 'Startup stopped.', detail: 'Details.', quit: 'Quit' }
const options = { theme: 'cyberpunk' as const, background: '#0b0b14', locale: 'en-US' }
const never = <T>() => new Promise<T>(() => undefined)
/** Lets the notice's awaits run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

afterEach(() => {
  vi.useRealTimers()
})

describe('startup notice window', () => {
  it('loads only the notice, without a menu, sized to it within its limits, and resolves once it closes', async () => {
    for (const [height, expected] of [[300.2, 301], [900, 560], [40, 180], ['tall', 180]] as const) {
      fake.Window.next = { measure: async () => height }
      const shown = showStartupNoticeWindow(notice, options)
      const window = fake.Window.last
      await settle()
      expect(window.options).toMatchObject({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
      expect(window.options).not.toHaveProperty('webPreferences.preload')
      expect(window.removeMenu).toHaveBeenCalledOnce()
      expect(window.webContents.setWindowOpenHandler.mock.calls[0]![0]()).toEqual({ action: 'deny' })
      const navigation = { preventDefault: vi.fn() }
      window.webContents.emit('will-navigate', navigation)
      expect(navigation.preventDefault).toHaveBeenCalledOnce()
      expect(window.loadFile.mock.calls[0]![1]).toEqual({ query: { theme: 'cyberpunk', lang: 'en-US', ...notice } })
      expect(window.setContentSize).toHaveBeenCalledExactlyOnceWith(480, expected)
      expect(window.show).toHaveBeenCalledOnce()
      let resolved = false
      void shown.then(() => { resolved = true })
      await settle()
      expect(resolved).toBe(false)
      window.close()
      await shown
    }
  })

  it('fails and closes its window when the page goes away before the window shows', async () => {
    fake.Window.next = { measure: never }
    const shown = showStartupNoticeWindow(notice, options)
    const window = fake.Window.last
    await settle()
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
    await expect(shown).rejects.toThrow('lost its page')
    expect(window.destroyed).toBe(true)
    expect(window.show).not.toHaveBeenCalled()
  })

  it('fails and closes its window when the page goes away once the window shows', async () => {
    const shown = showStartupNoticeWindow(notice, options)
    const window = fake.Window.last
    await settle()
    expect(window.show).toHaveBeenCalledOnce()
    window.webContents.emit('render-process-gone', {}, { reason: 'oom' })
    await expect(shown).rejects.toThrow('lost its page')
    expect(window.destroyed).toBe(true)
  })

  it('gives up on a page that does not load in time', async () => {
    vi.useFakeTimers()
    fake.Window.next = { load: never }
    const shown = showStartupNoticeWindow(notice, options)
    const window = fake.Window.last
    const failed = expect(shown).rejects.toThrow('did not load in time')
    await vi.advanceTimersByTimeAsync(10_000)
    await failed
    expect(window.destroyed).toBe(true)
    expect(window.show).not.toHaveBeenCalled()
  })

  it('ends quietly, without showing, when a quit closes the window while it loads', async () => {
    for (const load of ['pending', 'aborted'] as const) {
      let abort!: (error: Error) => void
      fake.Window.next = { load: () => new Promise<void>((_, reject) => { abort = reject }) }
      const shown = showStartupNoticeWindow(notice, options)
      const window = fake.Window.last
      await settle()
      window.close()
      if (load === 'aborted') abort(new Error('ERR_ABORTED (-3) loading startup-notice.html'))
      await expect(shown).resolves.toBeUndefined()
      expect(window.show).not.toHaveBeenCalled()
    }
  })

  it('fails when the window cannot load the notice, and closes the window', async () => {
    fake.Window.next = { load: async () => { throw new Error('synthetic load failure') } }
    const shown = showStartupNoticeWindow(notice, options)
    const window = fake.Window.last
    await expect(shown).rejects.toThrow('synthetic load failure')
    expect(window.destroyed).toBe(true)
  })
})
