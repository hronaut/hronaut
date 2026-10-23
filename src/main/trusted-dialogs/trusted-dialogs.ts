import { randomUUID } from 'node:crypto'
import type { IpcMain, IpcMainEvent, MessageBoxOptions, MessageBoxReturnValue, WebContents } from 'electron'
import {
  TRUSTED_DIALOG_CHANNELS,
  type TrustedDialogRequest,
  type TrustedDialogType,
  type TrustedDialogVariant
} from '../../shared/trusted-dialogs.js'

/** A shell window a dialog can show in: the main window or the detached panel window. */
export interface TrustedDialogWindow {
  readonly webContents: WebContents
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
}

/**
 * A question for the person, shaped like Electron's `dialog.showMessageBox` options so a caller can move from one to
 * the other, plus the `variant` that lets the shell design it.
 */
export interface TrustedDialogOptions<Window extends TrustedDialogWindow = TrustedDialogWindow> {
  type?: TrustedDialogType
  title?: string
  message: string
  detail?: string
  buttons: string[]
  /** The button that takes the focus; the cancel button when omitted. */
  defaultId?: number
  /** The answer Escape, the close button, an abort and a window that goes away give; 0 when omitted. */
  cancelId?: number
  /** The button drawn as the main action; never the cancel button. */
  primaryId?: number
  /** Closes the dialog, as Electron's does, answering `cancelId`. */
  signal?: AbortSignal
  /** Only for the system dialog Hronaut falls back to; see Electron's `noLink`. */
  noLink?: boolean
  /** What is asked, for the shell to design; a plain message when omitted. */
  variant?: TrustedDialogVariant
  /** The shell window to ask in; the main window when omitted. */
  window?: Window | null
}

export interface TrustedDialogsHost<Window extends TrustedDialogWindow> {
  /** The main window while it is open; read on every request. */
  mainWindow(): Window | null
  /** Electron's `dialog.showMessageBox`, on the given window when there is one. */
  showNativeMessageBox(window: Window | null, options: MessageBoxOptions): Promise<MessageBoxReturnValue>
  /**
   * True once Hronaut is quitting. A question no shell window can show then gets its cancel answer instead of a system
   * dialog, which would pop up with no window while the app closes, and on macOS could hold up the quit.
   */
  quitting?(): boolean
}

interface PendingDialog<Window extends TrustedDialogWindow> {
  request: TrustedDialogRequest
  options: TrustedDialogOptions<Window>
  window: Window
  resolve(value: MessageBoxReturnValue): void
  /** Removes the abort listener; called once the dialog is settled or handed to the system dialog. */
  release(): void
}

/** What one shell window shows: whether its document listens, the dialog it draws and the ones waiting behind it. */
interface ShellDialogs<Window extends TrustedDialogWindow> {
  ready: boolean
  visible: PendingDialog<Window> | null
  queue: Array<PendingDialog<Window>>
}

export interface TrustedDialogs<Window extends TrustedDialogWindow = TrustedDialogWindow> {
  /**
   * Asks the person in Hronaut's own dialog on the shell window, drawn over its pages, and resolves with the chosen
   * button's index, as `dialog.showMessageBox` does. Dialogs on one window show one at a time, in the order asked.
   * When no shell window can show it, because it is closed, hidden, not loaded yet or its document is gone, the
   * question goes to the system dialog instead, so it is always answered.
   */
  show(options: TrustedDialogOptions<Window>): Promise<MessageBoxReturnValue>
  /** Admits the shell's answers; only the shell document of the window a dialog is shown in may answer it. */
  registerIpc(ipc: {
    ipcMain: Pick<IpcMain, 'on'>
    /**
     * Whether the message came from the shell document of the main or the detached panel window. Unlike the checks of
     * browser changes, it admits the shell after saved workspaces failed to start, so a dialog shown while they
     * initialized is still answered.
     */
    isTrustedShellSender(event: IpcMainEvent): boolean
  }): void
}

function validIndex(value: unknown, buttons: readonly string[]): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < buttons.length
}

/** The single place Hronaut asks the person a question from the main process; see `TrustedDialogs`. */
export function createTrustedDialogs<Window extends TrustedDialogWindow>(host: TrustedDialogsHost<Window>): TrustedDialogs<Window> {
  type Options = TrustedDialogOptions<Window>
  type Pending = PendingDialog<Window>
  const shells = new WeakMap<WebContents, ShellDialogs<Window>>()
  const watched = new WeakSet<WebContents>()
  /** System dialogs show one at a time too, as Hronaut's do. */
  let nativeChain: Promise<unknown> = Promise.resolve()

  function shellOf(contents: WebContents): ShellDialogs<Window> {
    let shell = shells.get(contents)
    if (!shell) {
      shell = { ready: false, visible: null, queue: [] }
      shells.set(contents, shell)
    }
    return shell
  }

  function canDraw(window: Window | null): window is Window {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return false
    // A hidden or minimized window would keep the question out of sight; the system dialog asks as it did before.
    return window.isVisible() && !window.isMinimized() && Boolean(shells.get(window.webContents)?.ready)
  }

  function cancelResponse(options: Options): number {
    return validIndex(options.cancelId, options.buttons) ? options.cancelId : 0
  }

  function nativeOptions(options: Options): MessageBoxOptions {
    const { variant: _variant, window: _window, primaryId: _primaryId, ...native } = options
    return native
  }

  function askNatively(options: Options, window: Window | null): Promise<MessageBoxReturnValue> {
    const asked = nativeChain.then(async () => {
      if (options.signal?.aborted || host.quitting?.()) return { response: cancelResponse(options), checkboxChecked: false }
      const parent = window && !window.isDestroyed() ? window : null
      return host.showNativeMessageBox(parent, nativeOptions(options))
    })
    nativeChain = asked.catch(() => undefined)
    return asked
  }

  function publish(contents: WebContents): void {
    if (contents.isDestroyed()) return
    contents.send(TRUSTED_DIALOG_CHANNELS.changed, shells.get(contents)?.visible?.request ?? null)
  }

  function showNext(contents: WebContents): void {
    const shell = shellOf(contents)
    if (!shell.visible) shell.visible = shell.queue.shift() ?? null
    publish(contents)
  }

  function settle(pending: Pending, response: number): void {
    const contents = pending.window.webContents
    const shell = shells.get(contents)
    pending.release()
    if (shell?.visible === pending) {
      shell.visible = null
      showNext(contents)
    } else if (shell) {
      shell.queue = shell.queue.filter((candidate) => candidate !== pending)
    }
    pending.resolve({ response, checkboxChecked: false })
  }

  /** The shell document is gone or reloading: every dialog it showed or held goes to the system dialog instead. */
  function handOff(contents: WebContents): void {
    const shell = shells.get(contents)
    if (!shell) return
    shell.ready = false
    const pending = [...(shell.visible ? [shell.visible] : []), ...shell.queue]
    shell.visible = null
    shell.queue = []
    for (const dialog of pending) {
      dialog.release()
      void askNatively(dialog.options, dialog.window).then(dialog.resolve, () => dialog.resolve({
        response: cancelResponse(dialog.options),
        checkboxChecked: false
      }))
    }
  }

  function watch(contents: WebContents): void {
    if (watched.has(contents)) return
    watched.add(contents)
    contents.on('destroyed', () => handOff(contents))
    contents.on('render-process-gone', () => handOff(contents))
    // A navigation that starts can still be refused or cancelled, leaving the document that shows the dialog; only one
    // that replaces it, with another document or an error page, takes the dialog away.
    contents.on('did-navigate', () => handOff(contents))
    contents.on('did-fail-provisional-load', (_event: unknown, _code: number, _description: string, _url: string, isMainFrame: boolean) => {
      if (isMainFrame) handOff(contents)
    })
  }

  function show(options: Options): Promise<MessageBoxReturnValue> {
    const cancelId = cancelResponse(options)
    if (options.signal?.aborted) return Promise.resolve({ response: cancelId, checkboxChecked: false })
    const window = options.window === undefined ? host.mainWindow() : options.window
    if (!canDraw(window)) return askNatively(options, window)
    const defaultId = validIndex(options.defaultId, options.buttons) ? options.defaultId : cancelId
    const primaryId = validIndex(options.primaryId, options.buttons) && options.primaryId !== cancelId ? options.primaryId : undefined
    const request: TrustedDialogRequest = {
      id: randomUUID(),
      type: options.type ?? 'none',
      ...(options.title ? { title: options.title } : {}),
      message: options.message,
      ...(options.detail ? { detail: options.detail } : {}),
      buttons: [...options.buttons],
      defaultId,
      cancelId,
      ...(primaryId === undefined ? {} : { primaryId }),
      variant: options.variant ?? { kind: 'message' }
    }
    return new Promise((resolve) => {
      const onAbort = (): void => settle(pending, cancelId)
      const pending: Pending = {
        request,
        options,
        window,
        resolve,
        release: () => options.signal?.removeEventListener('abort', onAbort)
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })
      shellOf(window.webContents).queue.push(pending)
      showNext(window.webContents)
    })
  }

  function registerIpc(ipc: Parameters<TrustedDialogs<Window>['registerIpc']>[0]): void {
    function trusted(event: IpcMainEvent): boolean {
      try {
        return ipc.isTrustedShellSender(event)
      } catch {
        return false
      }
    }

    ipc.ipcMain.on(TRUSTED_DIALOG_CHANNELS.ready, (event) => {
      if (!trusted(event)) return
      watch(event.sender)
      shellOf(event.sender).ready = true
      showNext(event.sender)
    })

    ipc.ipcMain.on(TRUSTED_DIALOG_CHANNELS.respond, (event, id: unknown, response: unknown) => {
      if (!trusted(event)) return
      // Only the window that shows the dialog answers it, and only the dialog it shows now: an answer that arrives
      // after the dialog closed, or that names one still waiting, changes nothing.
      const visible = shells.get(event.sender)?.visible
      if (!visible || visible.window.webContents !== event.sender || visible.request.id !== id) return
      if (!validIndex(response, visible.request.buttons)) return
      settle(visible, response)
    })
  }

  return { show, registerIpc }
}
