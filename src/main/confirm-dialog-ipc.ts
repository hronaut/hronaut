import type { IpcMain, IpcMainInvokeEvent, MessageBoxReturnValue } from 'electron'
import type { Confirmation } from '../shared/confirmation.js'
import type { MessageKey, MessageParameters } from '../shared/i18n.js'
import type { TrustedDialogOptions, TrustedDialogWindow } from './trusted-dialogs/trusted-dialogs.js'

/** Longer text is cut: a confirmation names what it changes, and a name never needs more. */
export const MAX_CONFIRMATION_MESSAGE_LENGTH = 1_000

interface ConfirmDialogIpcHost<Window extends TrustedDialogWindow> {
  ipcMain: Pick<IpcMain, 'handle'>
  /** Throws unless the message came from the shell document of the main or the detached panel window. */
  assertTrustedShellSender(event: IpcMainInvokeEvent): void
  /** The window whose own document sent the message, which the confirmation belongs to. */
  senderWindow(event: IpcMainInvokeEvent): Window | null
  /** The main window, which Home's tab is shown in. */
  mainWindow(): Window | null
  /** Gives the keyboard back to the page that asked once its question's dialog has closed. */
  focusAskingPage(event: IpcMainInvokeEvent): void
  /** Asks in Hronaut's own dialog over the window, or in the system dialog when the window cannot show it. */
  showDialog(options: TrustedDialogOptions<Window>): Promise<MessageBoxReturnValue>
  text(key: MessageKey, parameters?: MessageParameters): string
}

/**
 * Hronaut's own pages ask before a change they cannot undo, such as removing a wallet or deleting a workspace. They
 * used `window.confirm`, which in Electron shows OK as the button Enter presses, labeled in English, so a key still
 * held from the button that asked could confirm it. These channels ask in Hronaut's own dialog over the window, in the
 * interface language, with Cancel focused, so Enter never chooses OK and Escape chooses Cancel; the dialog ignores keys
 * held from before it appeared. The page waits for the answer without blocking, so the shell can draw the dialog.
 */
export function registerConfirmDialogIpc<Window extends TrustedDialogWindow>(host: ConfirmDialogIpcHost<Window>): void {
  /** Home's own document, not a frame in it and not a website. */
  function isHomeDocument(event: IpcMainInvokeEvent): boolean {
    if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false
    try {
      const url = new URL(event.senderFrame.url)
      return url.protocol === 'hronaut:' && url.hostname === 'home' && (url.pathname === '/' || url.pathname === '')
    } catch {
      return false
    }
  }

  function bounded(value: string): string {
    if (value.length <= MAX_CONFIRMATION_MESSAGE_LENGTH) return value
    const kept = value.slice(0, MAX_CONFIRMATION_MESSAGE_LENGTH - 1)
    // Never end on half of a character outside the Basic Multilingual Plane, such as an emoji in a workspace name.
    return `${/[\uD800-\uDBFF]$/.test(kept) ? kept.slice(0, -1) : kept}…`
  }

  /** The question and what follows it, as the page split them; null unless the question is text with something in it. */
  function confirmation(value: unknown): Confirmation | null {
    if (!value || typeof value !== 'object') return null
    const { message, detail } = value as Record<string, unknown>
    if (typeof message !== 'string' || !message.trim()) return null
    if (detail !== undefined && typeof detail !== 'string') return null
    return { message: bounded(message), ...(detail?.trim() ? { detail: bounded(detail) } : {}) }
  }

  /** True only for a deliberate OK; a bad message or a failed dialog answer false. */
  async function answer(event: IpcMainInvokeEvent, value: unknown, owner: () => Window | null): Promise<boolean> {
    const question = confirmation(value)
    if (!question) return false
    // A page that goes away while it asks, such as a detached panel closed from the main window, takes the question
    // with it instead of leaving it open over nothing.
    const closed = new AbortController()
    const close = (): void => closed.abort()
    event.sender.once('destroyed', close)
    try {
      const { response } = await host.showDialog({
        type: 'question',
        title: host.text('native.dialog.confirmTitle'),
        message: question.message,
        ...(question.detail ? { detail: question.detail } : {}),
        buttons: [host.text('native.dialog.cancel'), host.text('native.dialog.confirmOk')],
        // Enter, or a key still held from the button that asked, keeps things as they are.
        defaultId: 0,
        cancelId: 0,
        primaryId: 1,
        noLink: true,
        signal: closed.signal,
        variant: { kind: 'message' },
        window: owner()
      })
      return response === 1 && !closed.signal.aborted
    } catch {
      // A dialog that could not be shown answers as Cancel does.
      return false
    } finally {
      event.sender.removeListener('destroyed', close)
    }
  }

  host.ipcMain.handle('shell:confirm', (event, value: unknown) => {
    try {
      host.assertTrustedShellSender(event)
    } catch {
      return false
    }
    return answer(event, value, () => host.senderWindow(event))
  })
  host.ipcMain.handle('hronaut-home:confirm', async (event, value: unknown) => {
    if (!isHomeDocument(event) || !confirmation(value)) return false
    try {
      return await answer(event, value, () => host.mainWindow())
    } finally {
      // The dialog is drawn by the shell, which took the keyboard from Home; Home's own focus goes back with it.
      host.focusAskingPage(event)
    }
  })
}
