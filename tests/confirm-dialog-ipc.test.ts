import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { MAX_CONFIRMATION_MESSAGE_LENGTH, registerConfirmDialogIpc } from '../src/main/confirm-dialog-ipc.js'
import type { TrustedDialogOptions, TrustedDialogWindow } from '../src/main/trusted-dialogs/trusted-dialogs.js'

type Handler = (event: IpcMainInvokeEvent, value: unknown) => boolean | Promise<boolean>

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

function harness(options: { trustedShell?: boolean } = {}) {
  const handlers = new Map<string, Handler>()
  const shellWindow = { id: 'shell' } as unknown as TrustedDialogWindow
  const mainWindow = { id: 'main' } as unknown as TrustedDialogWindow
  let answer = deferred<{ response: number; checkboxChecked: boolean }>()
  const showDialog = vi.fn((_options: TrustedDialogOptions) => answer.promise)
  registerConfirmDialogIpc({
    ipcMain: { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) } } as never,
    assertTrustedShellSender: () => { if (options.trustedShell === false) throw new Error('Rejected IPC from an untrusted renderer') },
    senderWindow: () => shellWindow,
    mainWindow: () => mainWindow,
    showDialog,
    text: (key) => ({ 'native.dialog.cancel': 'Abbrechen', 'native.dialog.confirmOk': 'OK', 'native.dialog.confirmTitle': 'Bitte bestätigen' } as Record<string, string>)[key] ?? key
  })
  let sender = new EventEmitter()
  function ask(channel: string, value: unknown, url = 'hronaut://home/', subframe = false): Promise<boolean> {
    const mainFrame = { url }
    sender = Object.assign(new EventEmitter(), { mainFrame })
    const event = { sender, senderFrame: subframe ? { url } : mainFrame } as unknown as IpcMainInvokeEvent
    return Promise.resolve(handlers.get(channel)!(event, value))
  }
  return {
    ask,
    showDialog,
    shellWindow,
    mainWindow,
    answer: (response: number) => answer.resolve({ response, checkboxChecked: false }),
    fail: () => answer.reject(new Error('dialog failed')),
    /** The asking page goes away, as Electron reports with the sender's `destroyed`. */
    destroySender: () => sender.emit('destroyed'),
    senderListeners: () => sender.listenerCount('destroyed'),
    reset: () => { answer = deferred() }
  }
}

describe('Hronaut\'s own confirmations', () => {
  it('ask in Hronaut\'s dialog on the shell\'s own window with Cancel focused, in the interface language', async () => {
    const confirmations = harness()
    const asked = confirmations.ask('shell:confirm', { message: 'Remove wallet "Main"?', detail: 'Its keys leave this computer.' })

    expect(confirmations.showDialog).toHaveBeenCalledExactlyOnceWith({
      type: 'question',
      title: 'Bitte bestätigen',
      message: 'Remove wallet "Main"?',
      detail: 'Its keys leave this computer.',
      buttons: ['Abbrechen', 'OK'],
      defaultId: 0,
      cancelId: 0,
      primaryId: 1,
      noLink: true,
      signal: expect.any(AbortSignal),
      variant: { kind: 'message' },
      window: confirmations.shellWindow
    })
    confirmations.answer(1)
    await expect(asked).resolves.toBe(true)
  })

  it('answer false for Cancel, Escape or a dialog that fails', async () => {
    const confirmations = harness()
    const cancelled = confirmations.ask('shell:confirm', { message: 'Clear history?' })
    confirmations.answer(0)
    await expect(cancelled).resolves.toBe(false)

    confirmations.reset()
    const failed = confirmations.ask('shell:confirm', { message: 'Clear history?' })
    confirmations.fail()
    await expect(failed).resolves.toBe(false)
  })

  it('answer false without asking for an untrusted sender or a question that is not text', async () => {
    const untrusted = harness({ trustedShell: false })
    await expect(untrusted.ask('shell:confirm', { message: 'Remove wallet?' })).resolves.toBe(false)
    expect(untrusted.showDialog).not.toHaveBeenCalled()

    const confirmations = harness()
    for (const value of [undefined, 1, 'Remove?', { message: '' }, { message: '   ' }, { message: 1 }, { message: 'Remove?', detail: 1 }]) {
      await expect(confirmations.ask('shell:confirm', value)).resolves.toBe(false)
    }
    expect(confirmations.showDialog).not.toHaveBeenCalled()
  })

  it('leave out an empty detail', () => {
    const confirmations = harness()
    void confirmations.ask('shell:confirm', { message: 'Clear history?', detail: '  ' })
    expect(confirmations.showDialog.mock.calls[0]![0]).not.toHaveProperty('detail')
  })

  it('cut an overlong question or detail instead of refusing it, never through the middle of a character', () => {
    const confirmations = harness()
    void confirmations.ask('shell:confirm', { message: 'x'.repeat(MAX_CONFIRMATION_MESSAGE_LENGTH + 50), detail: 'y'.repeat(MAX_CONFIRMATION_MESSAGE_LENGTH + 1) })
    const { message, detail } = confirmations.showDialog.mock.calls[0]![0]
    expect(message).toHaveLength(MAX_CONFIRMATION_MESSAGE_LENGTH)
    expect(message.endsWith('…')).toBe(true)
    expect(detail).toHaveLength(MAX_CONFIRMATION_MESSAGE_LENGTH)

    // The emoji's two halves straddle the cut, so it goes whole.
    void confirmations.ask('shell:confirm', { message: `${'x'.repeat(MAX_CONFIRMATION_MESSAGE_LENGTH - 2)}🙂 and more` })
    expect(confirmations.showDialog.mock.calls[1]![0].message).toBe(`${'x'.repeat(MAX_CONFIRMATION_MESSAGE_LENGTH - 2)}…`)
  })

  it('close the question and answer false when the asking page goes away, even if OK arrives after', async () => {
    const confirmations = harness()
    const asked = confirmations.ask('shell:confirm', { message: 'Clear history?' })
    const signal = confirmations.showDialog.mock.calls[0]![0].signal!
    expect(signal.aborted).toBe(false)

    confirmations.destroySender()
    expect(signal.aborted).toBe(true)
    confirmations.answer(1)
    await expect(asked).resolves.toBe(false)
    expect(confirmations.senderListeners()).toBe(0)
  })

  it('ask for Home on the main window and refuse any other page or a frame inside Home', async () => {
    const confirmations = harness()
    const home = confirmations.ask('hronaut-home:confirm', { message: 'Delete workspace "Client"?' })
    expect(confirmations.showDialog).toHaveBeenCalledWith(expect.objectContaining({ window: confirmations.mainWindow, defaultId: 0, cancelId: 0 }))
    confirmations.answer(1)
    await expect(home).resolves.toBe(true)

    confirmations.showDialog.mockClear()
    for (const url of ['https://example.com/', 'hronaut://home/settings', 'hronaut://other/', 'not a url']) {
      await expect(confirmations.ask('hronaut-home:confirm', { message: 'Delete?' }, url)).resolves.toBe(false)
    }
    await expect(confirmations.ask('hronaut-home:confirm', { message: 'Delete?' }, 'hronaut://home/', true)).resolves.toBe(false)
    expect(confirmations.showDialog).not.toHaveBeenCalled()
  })
})
