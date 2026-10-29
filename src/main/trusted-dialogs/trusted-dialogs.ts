import { randomUUID } from 'node:crypto'
import type { IpcMain, IpcMainEvent, MessageBoxOptions, MessageBoxReturnValue, WebContents } from 'electron'
import {
  MAX_CREDENTIAL_LENGTH,
  TRUSTED_DIALOG_CHANNELS,
  type TrustedDialogCredentials,
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
  isFocused(): boolean
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

/**
 * The person's answer, as `dialog.showMessageBox` gives it, with what they typed when they signed in to a website's
 * sign-in dialog.
 */
export interface TrustedDialogAnswer extends MessageBoxReturnValue {
  credentials?: TrustedDialogCredentials
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
  /**
   * The page that has the keyboard when a dialog opens over the window's pages, or takes it once Hronaut's chrome over
   * them closes; null while the person is elsewhere, such as in the shell.
   */
  keyboardPage?(): WebContents | null
  /** Gives the keyboard back to that page once the last of the dialogs over the pages is answered. */
  returnKeyboard?(page: WebContents): void
}

interface PendingDialog<Window extends TrustedDialogWindow> {
  request: TrustedDialogRequest
  options: TrustedDialogOptions<Window>
  window: Window
  resolve(value: TrustedDialogAnswer): void
  /** Removes the abort listener; called once the dialog is settled or handed to the system dialog. */
  release(): void
}

/**
 * What one shell window shows: whether its document listens, the dialog it draws, the ones waiting behind it, the page
 * that had the keyboard before the first of them opened and whether the person was in another app then.
 */
interface ShellDialogs<Window extends TrustedDialogWindow> {
  ready: boolean
  /** Ends the wait for a starting shell document to listen, after which its dialogs go to the system dialog. */
  startTimer?: ReturnType<typeof setTimeout>
  visible: PendingDialog<Window> | null
  queue: Array<PendingDialog<Window>>
  keyboardPage: WebContents | null
  awayWhenOpened: boolean
}

export interface TrustedDialogs<Window extends TrustedDialogWindow = TrustedDialogWindow> {
  /**
   * Asks the person in Hronaut's own dialog on the shell window, drawn over its pages, and resolves with the chosen
   * button's index, as `dialog.showMessageBox` does. Dialogs on one window show one at a time, in the order asked.
   * As a system dialog does, the last one answered gives the keyboard back to the page that had it before the first
   * opened, such as the page whose navigation it asks about. A window in view whose shell document is still starting,
   * as while Hronaut starts, shows it once the document listens. When no shell window can show it, because it is
   * closed or hidden, its document is gone, or it did not start within a few seconds, the question goes to the system
   * dialog instead, so it is always answered; a website's sign-in, which no system dialog can take, is cancelled then.
   */
  show(options: TrustedDialogOptions<Window>): Promise<TrustedDialogAnswer>
  /**
   * Notes the page that takes the keyboard under the dialogs shown over it when they opened while the person was in
   * another app, as when the person comes back to the window they left with the keyboard in that page; the last one
   * answered gives it back.
   */
  noteKeyboardPage(window: Window, page: WebContents): void
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

/** How long a question waits for a starting shell document to listen before the system dialog asks it instead. */
const SHELL_START_WAIT_MS = 10_000

function validIndex(value: unknown, buttons: readonly string[]): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < buttons.length
}

/** A username and a password, each text no longer than a sign-in answer carries, or undefined for anything else. */
function validCredentials(value: unknown): TrustedDialogCredentials | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { username, password } = value as Record<string, unknown>
  if (typeof username !== 'string' || typeof password !== 'string') return undefined
  if (username.length > MAX_CREDENTIAL_LENGTH || password.length > MAX_CREDENTIAL_LENGTH) return undefined
  return { username, password }
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
      shell = { ready: false, visible: null, queue: [], keyboardPage: null, awayWhenOpened: false }
      shells.set(contents, shell)
    }
    return shell
  }

  /**
   * Whether the window can show the question: one in view, whose shell document listens or is still starting, as just
   * after Hronaut's window shows while the document loads its settings. A hidden or minimized window would keep the
   * question out of sight; the system dialog asks as it did before.
   */
  function canDraw(window: Window | null): window is Window {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed() || window.webContents.isCrashed()) return false
    return window.isVisible() && !window.isMinimized()
  }

  /** Waits a few seconds for a starting shell document to listen; if it does not, the system dialog asks instead. */
  function waitForStart(contents: WebContents): void {
    const shell = shellOf(contents)
    if (shell.ready || shell.startTimer) return
    // A document that crashes or goes away meanwhile hands its questions to the system dialog at once.
    watch(contents)
    shell.startTimer = setTimeout(() => {
      shell.startTimer = undefined
      if (!shell.ready) handOff(contents)
    }, SHELL_START_WAIT_MS)
  }

  function stopWaitingForStart(shell: ShellDialogs<Window>): void {
    if (shell.startTimer) clearTimeout(shell.startTimer)
    shell.startTimer = undefined
  }

  function cancelResponse(options: Options): number {
    return validIndex(options.cancelId, options.buttons) ? options.cancelId : 0
  }

  function nativeOptions(options: Options): MessageBoxOptions {
    const { variant: _variant, window: _window, primaryId: _primaryId, ...native } = options
    return native
  }

  function askNatively(options: Options, window: Window | null): Promise<TrustedDialogAnswer> {
    // No system dialog takes a username and password, so a sign-in no shell window can show is cancelled, as Escape
    // would; the website shows the page it sends without them.
    if (options.variant?.kind === 'http-auth') return Promise.resolve({ response: cancelResponse(options), checkboxChecked: false })
    const asked = nativeChain.then(async () => {
      if (options.signal?.aborted || host.quitting?.()) return { response: cancelResponse(options), checkboxChecked: false }
      const parent = window && !window.isDestroyed() ? window : null
      return host.showNativeMessageBox(parent, nativeOptions(options))
    })
    nativeChain = asked.catch(() => undefined)
    return asked
  }

  function publish(contents: WebContents): void {
    if (contents.isDestroyed() || !shells.get(contents)?.ready) return
    contents.send(TRUSTED_DIALOG_CHANNELS.changed, shells.get(contents)?.visible?.request ?? null)
  }

  function showNext(contents: WebContents): void {
    const shell = shellOf(contents)
    if (!shell.visible) shell.visible = shell.queue.shift() ?? null
    publish(contents)
  }

  function settle(pending: Pending, response: number, credentials?: TrustedDialogCredentials, closedUnanswered = false): void {
    const contents = pending.window.webContents
    const shell = shells.get(contents)
    pending.release()
    if (shell?.visible === pending) {
      shell.visible = null
      showNext(contents)
    } else if (shell) {
      shell.queue = shell.queue.filter((candidate) => candidate !== pending)
    }
    // A sign-in that closes while the person types in it, as when the page that asked loads another, keeps the keyboard
    // from the page: the rest of what they type, the password's end and Enter included, would go to it.
    const keyboardPage = shell && !shell.visible && !(closedUnanswered && pending.request.variant.kind === 'http-auth')
      ? shell.keyboardPage
      : null
    if (shell && !shell.visible) {
      shell.keyboardPage = null
      shell.awayWhenOpened = false
    }
    pending.resolve({ response, checkboxChecked: false, ...(credentials ? { credentials } : {}) })
    // The shell keeps the focus a dialog over the pages took, on the control it held before, while the page the
    // person was in waits for the keyboard: typing went nowhere, and Delete closed the tab whose control it was. The
    // caller goes on after this, so where it puts the keyboard itself wins.
    if (keyboardPage && !keyboardPage.isDestroyed()) returnKeyboard(keyboardPage)
  }

  function returnKeyboard(page: WebContents): void {
    try {
      host.returnKeyboard?.(page)
    } catch (error) {
      console.error('[trusted-dialogs] Could not give the keyboard back to the page:', error)
    }
  }

  function noteKeyboardPage(window: Window, page: WebContents): void {
    const shell = shells.get(window.webContents)
    if (shell && (shell.visible || shell.queue.length > 0) && shell.awayWhenOpened && !shell.keyboardPage) shell.keyboardPage = page
  }

  /** The shell document is gone or reloading: every dialog it showed or held goes to the system dialog instead. */
  function handOff(contents: WebContents): void {
    const shell = shells.get(contents)
    if (!shell) return
    shell.ready = false
    stopWaitingForStart(shell)
    const pending = [...(shell.visible ? [shell.visible] : []), ...shell.queue]
    shell.visible = null
    shell.queue = []
    // The system dialogs that ask instead leave the keyboard with the window they close over.
    shell.keyboardPage = null
    shell.awayWhenOpened = false
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

  function show(options: Options): Promise<TrustedDialogAnswer> {
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
      const onAbort = (): void => settle(pending, cancelId, undefined, true)
      const pending: Pending = {
        request,
        options,
        window,
        resolve,
        release: () => options.signal?.removeEventListener('abort', onAbort)
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })
      const shell = shellOf(window.webContents)
      if (!shell.visible && shell.queue.length === 0) {
        shell.keyboardPage = host.keyboardPage?.() ?? null
        shell.awayWhenOpened = !window.isFocused()
      }
      shell.queue.push(pending)
      showNext(window.webContents)
      waitForStart(window.webContents)
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
      const shell = shellOf(event.sender)
      shell.ready = true
      stopWaitingForStart(shell)
      showNext(event.sender)
    })

    ipc.ipcMain.on(TRUSTED_DIALOG_CHANNELS.respond, (event, id: unknown, response: unknown, credentials: unknown) => {
      if (!trusted(event)) return
      // Only the window that shows the dialog answers it, and only the dialog it shows now: an answer that arrives
      // after the dialog closed, or that names one still waiting, changes nothing.
      const visible = shells.get(event.sender)?.visible
      if (!visible || visible.window.webContents !== event.sender || visible.request.id !== id) return
      if (!validIndex(response, visible.request.buttons)) return
      // Only the answer that signs in to a website's sign-in dialog carries what the person typed, and it counts only
      // with it, as Cancel otherwise, since the shell takes no other answer once it sent one; every other answer leaves
      // anything sent with it behind.
      if (visible.request.variant.kind === 'http-auth' && response === visible.request.primaryId) {
        const typed = validCredentials(credentials)
        settle(visible, typed ? response : visible.request.cancelId, typed)
        return
      }
      settle(visible, response)
    })
  }

  return { show, noteKeyboardPage, registerIpc }
}
