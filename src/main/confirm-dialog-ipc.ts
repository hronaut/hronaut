import type { BaseWindow, IpcMain, IpcMainEvent, MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { MessageKey, MessageParameters } from '../shared/i18n.js'

/** Longer text is cut: a confirmation names what it changes, and a name never needs more. */
export const MAX_CONFIRMATION_MESSAGE_LENGTH = 1_000

interface ConfirmDialogIpcHost {
  ipcMain: Pick<IpcMain, 'on'>
  /** Throws unless the message came from the shell document of the main or the detached panel window. */
  assertTrustedShellSender(event: IpcMainEvent): void
  /** The window whose own document sent the message, which the confirmation belongs to. */
  senderWindow(event: IpcMainEvent): BaseWindow | null
  /** The main window, which Home's tab is shown in. */
  mainWindow(): BaseWindow | null
  /** Electron's `dialog.showMessageBox`, on the given window when there is one. */
  showMessageBox(window: BaseWindow | null, options: MessageBoxOptions): Promise<MessageBoxReturnValue>
  text(key: MessageKey, parameters?: MessageParameters): string
}

/**
 * Hronaut's own pages ask before a change they cannot undo, such as removing a wallet or deleting a workspace. They
 * used `window.confirm`, which in Electron shows OK as the button Enter presses, labeled in English, so a key still
 * held from the button that asked could confirm it. These synchronous channels show the same native question with
 * Cancel as the default button, labeled in the interface language, so Enter never chooses OK and Escape chooses
 * Cancel (macOS gives Cancel Escape instead of Return). The asking page waits, as it did for `window.confirm`, so
 * nothing it shows can change under the question; main keeps running meanwhile.
 */
export function registerConfirmDialogIpc(host: ConfirmDialogIpcHost): void {
  /** Home's own document, not a frame in it and not a website. */
  function isHomeDocument(event: IpcMainEvent): boolean {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false
    try {
      const url = new URL(event.senderFrame.url)
      return url.protocol === 'hronaut:' && url.hostname === 'home' && (url.pathname === '/' || url.pathname === '')
    } catch {
      return false
    }
  }

  function confirmationMessage(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null
    if (value.length <= MAX_CONFIRMATION_MESSAGE_LENGTH) return value
    const kept = value.slice(0, MAX_CONFIRMATION_MESSAGE_LENGTH - 1)
    // Never end on half of a character outside the Basic Multilingual Plane, such as an emoji in a workspace name.
    return `${/[\uD800-\uDBFF]$/.test(kept) ? kept.slice(0, -1) : kept}…`
  }

  /** Answers true only for a deliberate OK; a refused sender, a bad message or a failed dialog answer false. */
  async function answer(event: IpcMainEvent, value: unknown, owner: () => BaseWindow | null): Promise<void> {
    let confirmed = false
    // A page that goes away while it asks, such as a detached panel closed from the main window, takes the question
    // with it instead of leaving it open over nothing.
    const closed = new AbortController()
    const close = (): void => closed.abort()
    event.sender.once('destroyed', close)
    try {
      const message = confirmationMessage(value)
      if (message !== null) {
        const { response } = await host.showMessageBox(owner(), {
          type: 'question',
          title: 'Hronaut',
          message,
          buttons: [host.text('native.dialog.cancel'), host.text('native.dialog.confirmOk')],
          // Enter, or a key still held from the button that asked, keeps things as they are.
          defaultId: 0,
          cancelId: 0,
          noLink: true,
          signal: closed.signal
        })
        confirmed = response === 1 && !closed.signal.aborted
      }
    } catch {
      // A dialog that could not be shown answers as Cancel does.
    } finally {
      event.sender.removeListener('destroyed', close)
      // The page is blocked until it has an answer, so it gets one on every path.
      event.returnValue = confirmed
    }
  }

  host.ipcMain.on('shell:confirm', (event, value: unknown) => {
    try {
      host.assertTrustedShellSender(event)
    } catch {
      event.returnValue = false
      return
    }
    void answer(event, value, () => host.senderWindow(event))
  })
  host.ipcMain.on('hronaut-home:confirm', (event, value: unknown) => {
    if (!isHomeDocument(event)) {
      event.returnValue = false
      return
    }
    void answer(event, value, () => host.mainWindow())
  })
}
