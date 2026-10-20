import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { createQuitWithDownloadsConfirmation } from '../src/main/quit-with-downloads.js'
import { translate } from '../src/shared/i18n.js'
import type { BrowserDownloadState } from '../src/shared/types.js'

function download(state: BrowserDownloadState['state'], paused = false): BrowserDownloadState {
  return { id: state, url: 'https://download.example/file.iso', filename: 'file.iso', savePath: '/tmp/file.iso', state, paused, receivedBytes: 1, totalBytes: 10, startedAt: '2026-10-20T00:00:00.000Z' }
}

function confirmation(downloads: BrowserDownloadState[], answer: () => Promise<MessageBoxReturnValue>, visible = true) {
  const window = { isDestroyed: () => false, isVisible: () => visible } as unknown as BrowserWindow
  const asked: Array<{ window: BrowserWindow | undefined; options: MessageBoxOptions }> = []
  const confirm = createQuitWithDownloadsConfirmation({
    downloads: () => downloads,
    window: () => window,
    showMessageBox: vi.fn((parent: BrowserWindow | undefined, options: MessageBoxOptions) => {
      asked.push({ window: parent, options })
      return answer()
    }),
    text: (key, parameters) => translate('en-US', key, parameters)
  })
  return { confirm, asked, window }
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
    answer({ response: 1, checkboxChecked: false })
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
  })

  it('shows the question on its own while the window is hidden in the tray', async () => {
    const { confirm, asked } = confirmation([download('progressing')], async () => ({ response: 1, checkboxChecked: false }), false)
    await confirm()
    expect(asked[0]!.window).toBeUndefined()
  })

  it('quits when the question cannot be shown', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { confirm } = confirmation([download('progressing')], async () => { throw new Error('No display') })
    await expect(confirm()).resolves.toBe(true)
    vi.restoreAllMocks()
  })
})
