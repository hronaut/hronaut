import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQuitRequest, createQuitWithDownloadsConfirmation } from '../src/main/quit-with-downloads.js'
import { translate } from '../src/shared/i18n.js'
import type { BrowserDownloadState, SupportedLocale } from '../src/shared/types.js'

function download(state: BrowserDownloadState['state'], paused = false): BrowserDownloadState {
  return { id: state, url: 'https://download.example/file.iso', filename: 'file.iso', savePath: '/tmp/file.iso', state, paused, receivedBytes: 1, totalBytes: 10, startedAt: '2026-10-20T00:00:00.000Z' }
}

afterEach(() => { vi.restoreAllMocks() })

function confirmation(
  downloads: BrowserDownloadState[] | (() => BrowserDownloadState[]),
  answer: () => Promise<MessageBoxReturnValue>,
  window: Partial<Record<'isDestroyed' | 'isVisible' | 'isMinimized', () => boolean>> = {},
  locale: SupportedLocale = 'en-US'
) {
  const parent = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false, ...window } as unknown as BrowserWindow
  const asked: Array<{ window: BrowserWindow | undefined; options: MessageBoxOptions }> = []
  const confirm = createQuitWithDownloadsConfirmation({
    downloads: typeof downloads === 'function' ? downloads : () => downloads,
    window: () => parent,
    showMessageBox: vi.fn((parent: BrowserWindow | undefined, options: MessageBoxOptions) => {
      asked.push({ window: parent, options })
      return answer()
    }),
    text: (key, parameters) => translate(locale, key, parameters)
  })
  return { confirm, asked, window: parent }
}

describe('quitting with downloads in progress', () => {
  it('quits without asking when no download is in progress', async () => {
    const { confirm, asked } = confirmation([download('completed'), download('cancelled'), download('interrupted')], async () => ({ response: 0, checkboxChecked: false }))
    await expect(confirm()).resolves.toBe(true)
    expect(asked).toEqual([])
  })

  it('asks first, keeps downloading by default, and quits only when the person chooses Quit', async () => {
    let response = 0
    const { confirm, asked, window } = confirmation([download('progressing'), download('progressing', true), download('completed')], async () => ({ response, checkboxChecked: false }))
    // Quitting cancelled both downloads and deleted their unfinished files without a word.
    await expect(confirm()).resolves.toBe(false)
    expect(asked[0]).toEqual({
      window,
      options: expect.objectContaining({
        message: '2 downloads are in progress.',
        detail: 'Quitting now cancels them and deletes the unfinished files.',
        buttons: ['Keep downloading', 'Quit'],
        defaultId: 0,
        cancelId: 0
      })
    })
    response = 1
    await expect(confirm()).resolves.toBe(true)
  })

  it('asks once for requests made while the question is open', async () => {
    let answer!: (value: MessageBoxReturnValue) => void
    const { confirm, asked } = confirmation([download('progressing')], () => new Promise((resolve) => { answer = resolve }))
    const first = confirm()
    const second = confirm()
    expect(asked).toHaveLength(1)
    expect(asked[0]!.options.message).toBe('A download is in progress.')
    expect(asked[0]!.options.detail).toBe('Quitting now cancels it and deletes the unfinished file.')
    answer({ response: 1, checkboxChecked: false })
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
  })

  it.each([
    ['hidden in the tray', { isVisible: () => false }],
    ['minimized', { isMinimized: () => true }],
    ['closed', { isDestroyed: () => true }]
  ] as const)('shows the question on its own while the window is %s', async (_label, window) => {
    const { confirm, asked } = confirmation([download('progressing')], async () => ({ response: 1, checkboxChecked: false }), window)
    await confirm()
    expect(asked[0]!.window).toBeUndefined()
  })

  it('says files in Russian for 21 downloads, which Russian counts like one', async () => {
    // "the download will be cancelled and its unfinished file deleted" was shown for 21, 31 or 101 downloads.
    const { confirm, asked } = confirmation(Array.from({ length: 21 }, () => download('progressing')), async () => ({ response: 0, checkboxChecked: false }), {}, 'ru-RU')
    await confirm()
    expect(asked[0]!.options.message).toBe('Идёт 21 загрузка.')
    expect(asked[0]!.options.detail).toBe('Если выйти сейчас, загрузки будут отменены, а недокачанные файлы удалены.')
  })

  it('quits when the question cannot be shown, and asks again next time', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let fail = true
    const { confirm, asked } = confirmation([download('progressing')], async () => {
      if (fail) throw new Error('No display')
      return { response: 0, checkboxChecked: false }
    })
    await expect(confirm()).resolves.toBe(true)
    fail = false
    await expect(confirm()).resolves.toBe(false)
    expect(asked).toHaveLength(2)
  })

  it('quits when the question throws as it opens', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { confirm, asked } = confirmation([download('progressing')], () => { throw new TypeError('Invalid options') })
    await expect(confirm()).resolves.toBe(true)
    expect(asked).toHaveLength(1)
  })

  it('quits when the downloads cannot be read', async () => {
    // The window's Close had already been prevented, so a throw here left Hronaut impossible to quit.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { confirm, asked } = confirmation(() => { throw new Error('Object has been destroyed') }, async () => ({ response: 0, checkboxChecked: false }))
    await expect(confirm()).resolves.toBe(true)
    expect(asked).toEqual([])
  })
})

describe('requesting a quit', () => {
  it('quits once, after the event that asked, only when the person agrees', async () => {
    vi.useFakeTimers()
    try {
      const quitState = { quitting: false }
      const quit = vi.fn()
      let agree = false
      const request = createQuitRequest(async () => agree, quitState, quit)
      request()
      await vi.runAllTimersAsync()
      expect([quitState.quitting, quit.mock.calls.length]).toEqual([false, 0])
      agree = true
      request()
      // Set before quitting closes the window again, so its Close passes instead of asking twice.
      await Promise.resolve()
      await Promise.resolve()
      expect(quitState.quitting).toBe(true)
      expect(quit).not.toHaveBeenCalled()
      await vi.runAllTimersAsync()
      expect(quit).toHaveBeenCalledOnce()
      // A later Quit still quits, as it did before the question.
      request()
      await vi.runAllTimersAsync()
      expect(quit).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
