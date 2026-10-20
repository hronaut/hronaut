import { describe, expect, it, vi } from 'vitest'
import type { BaseWindow, IpcMainEvent, MessageBoxOptions } from 'electron'
import { MAX_CONFIRMATION_MESSAGE_LENGTH, registerConfirmDialogIpc } from '../src/main/confirm-dialog-ipc.js'

type Listener = (event: IpcMainEvent, value: unknown) => void

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

function harness(options: { trustedShell?: boolean } = {}) {
  const listeners = new Map<string, Listener>()
  const shellWindow = { id: 'shell' } as unknown as BaseWindow
  const mainWindow = { id: 'main' } as unknown as BaseWindow
  let answer = deferred<{ response: number; checkboxChecked: boolean }>()
  const showMessageBox = vi.fn((_window: BaseWindow | null, _options: MessageBoxOptions) => answer.promise)
  registerConfirmDialogIpc({
    ipcMain: { on: (channel: string, listener: Listener) => { listeners.set(channel, listener) } } as never,
    assertTrustedShellSender: () => { if (options.trustedShell === false) throw new Error('Rejected IPC from an untrusted renderer') },
    senderWindow: () => shellWindow,
    mainWindow: () => mainWindow,
    appName: () => 'Hronaut',
    showMessageBox,
    text: (key) => ({ 'native.dialog.cancel': 'Abbrechen', 'native.dialog.confirmOk': 'OK' } as Record<string, string>)[key] ?? key
  })
  function send(channel: string, value: unknown, url = 'hronaut://home/', subframe = false): IpcMainEvent & { returnValue?: unknown } {
    const mainFrame = { url }
    const event = { sender: { mainFrame }, senderFrame: subframe ? { url } : mainFrame } as unknown as IpcMainEvent
    listeners.get(channel)!(event, value)
    return event
  }
  return {
    send,
    showMessageBox,
    shellWindow,
    mainWindow,
    answer: (response: number) => answer.resolve({ response, checkboxChecked: false }),
    fail: () => answer.reject(new Error('dialog failed')),
    reset: () => { answer = deferred() }
  }
}

describe('native confirmations', () => {
  it('asks on the shell\'s own window with Cancel as the button Enter and Escape press, in the interface language', async () => {
    const confirmations = harness()
    const event = confirmations.send('shell:confirm', 'Remove wallet “Main”?')

    expect(confirmations.showMessageBox).toHaveBeenCalledExactlyOnceWith(confirmations.shellWindow, {
      type: 'question',
      title: 'Hronaut',
      message: 'Remove wallet “Main”?',
      buttons: ['Abbrechen', 'OK'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    expect(event.returnValue).toBeUndefined()
    confirmations.answer(1)
    await vi.waitFor(() => expect(event.returnValue).toBe(true))
  })

  it('answers false for Cancel, Escape or a dialog that fails', async () => {
    const confirmations = harness()
    const cancelled = confirmations.send('shell:confirm', 'Clear history?')
    confirmations.answer(0)
    await vi.waitFor(() => expect(cancelled.returnValue).toBe(false))

    confirmations.reset()
    const failed = confirmations.send('shell:confirm', 'Clear history?')
    confirmations.fail()
    await vi.waitFor(() => expect(failed.returnValue).toBe(false))
  })

  it('answers false without asking for an untrusted sender or a message that is not text', () => {
    const untrusted = harness({ trustedShell: false })
    expect(untrusted.send('shell:confirm', 'Remove wallet?').returnValue).toBe(false)
    expect(untrusted.showMessageBox).not.toHaveBeenCalled()

    const confirmations = harness()
    for (const value of [undefined, 1, '', '   ', { message: 'Remove?' }]) {
      expect(confirmations.send('shell:confirm', value).returnValue).toBe(false)
    }
    expect(confirmations.showMessageBox).not.toHaveBeenCalled()
  })

  it('cuts an overlong message instead of refusing it', () => {
    const confirmations = harness()
    confirmations.send('shell:confirm', 'x'.repeat(MAX_CONFIRMATION_MESSAGE_LENGTH + 50))
    const message = confirmations.showMessageBox.mock.calls[0]![1].message
    expect(message).toHaveLength(MAX_CONFIRMATION_MESSAGE_LENGTH)
    expect(message.endsWith('…')).toBe(true)
  })

  it('asks for Home on the main window and refuses any other page or a frame inside Home', async () => {
    const confirmations = harness()
    const home = confirmations.send('hronaut-home:confirm', 'Delete workspace “Client”?')
    expect(confirmations.showMessageBox).toHaveBeenCalledWith(confirmations.mainWindow, expect.objectContaining({ defaultId: 0, cancelId: 0 }))
    confirmations.answer(1)
    await vi.waitFor(() => expect(home.returnValue).toBe(true))

    confirmations.showMessageBox.mockClear()
    for (const url of ['https://example.com/', 'hronaut://home/settings', 'hronaut://other/', 'not a url']) {
      expect(confirmations.send('hronaut-home:confirm', 'Delete?', url).returnValue).toBe(false)
    }
    expect(confirmations.send('hronaut-home:confirm', 'Delete?', 'hronaut://home/', true).returnValue).toBe(false)
    expect(confirmations.showMessageBox).not.toHaveBeenCalled()
  })
})
