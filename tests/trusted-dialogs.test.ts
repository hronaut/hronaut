import { EventEmitter } from 'node:events'
import type { IpcMainEvent, MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { createTrustedDialogs, type TrustedDialogWindow } from '../src/main/trusted-dialogs/trusted-dialogs.js'
import { TRUSTED_DIALOG_CHANNELS, type TrustedDialogRequest } from '../src/shared/trusted-dialogs.js'

type Listener = (event: IpcMainEvent, ...args: unknown[]) => void

function fakeWindow() {
  const sent: Array<TrustedDialogRequest | null> = []
  const contents = Object.assign(new EventEmitter(), {
    destroyed: false,
    crashed: false,
    isDestroyed() { return this.destroyed },
    isCrashed() { return this.crashed },
    send: (_channel: string, request: TrustedDialogRequest | null) => { sent.push(request) }
  })
  const window = {
    webContents: contents,
    visible: true,
    minimized: false,
    focused: true,
    destroyed: false,
    isDestroyed() { return this.destroyed },
    isVisible() { return this.visible },
    isMinimized() { return this.minimized },
    isFocused() { return this.focused }
  }
  return { window: window as typeof window & TrustedDialogWindow, contents, sent, shown: () => sent.at(-1) ?? null }
}

function harness() {
  const quit = { quitting: false }
  const listeners = new Map<string, Listener>()
  const main = fakeWindow()
  const panel = fakeWindow()
  const untrusted = fakeWindow()
  const native: Array<{ window: unknown, options: MessageBoxOptions, answer: (response: number) => void }> = []
  const showNativeMessageBox = vi.fn((window: unknown, options: MessageBoxOptions) => new Promise<MessageBoxReturnValue>((resolve) => {
    native.push({ window, options, answer: (response) => resolve({ response, checkboxChecked: false }) })
  }))
  // The page that has the keyboard, as the tabs report it; null while the person is in the shell or away.
  const keyboard: { page: { isDestroyed(): boolean } | null } = { page: null }
  const returnKeyboard = vi.fn()
  const dialogs = createTrustedDialogs<typeof main.window>({
    mainWindow: () => main.window,
    showNativeMessageBox,
    quitting: () => quit.quitting,
    keyboardPage: () => keyboard.page as never,
    returnKeyboard
  })
  dialogs.registerIpc({
    ipcMain: { on: (channel: string, listener: Listener) => { listeners.set(channel, listener) } } as never,
    isTrustedShellSender: (event) => {
      const sender = event.sender as unknown
      return sender === main.contents || sender === panel.contents
    }
  })
  const send = (from: { contents: unknown }, channel: string, ...args: unknown[]): void => {
    listeners.get(channel)!({ sender: from.contents } as unknown as IpcMainEvent, ...args)
  }
  return {
    dialogs,
    main,
    panel,
    untrusted,
    native,
    showNativeMessageBox,
    quit,
    keyboard,
    returnKeyboard,
    ready: (window: { contents: unknown } = main) => send(window, TRUSTED_DIALOG_CHANNELS.ready),
    respond: (window: { contents: unknown }, id: unknown, response: unknown) => send(window, TRUSTED_DIALOG_CHANNELS.respond, id, response)
  }
}

const permission = {
  type: 'question' as const,
  title: 'Site permission',
  message: 'https://example.com requests “Location” permission.',
  detail: 'Hronaut remembers this choice.',
  buttons: ['Deny', 'Allow'],
  defaultId: 0,
  cancelId: 0,
  primaryId: 1,
  variant: { kind: 'site-permission' as const, origin: 'https://example.com', permission: 'geolocation', freshConsent: false }
}

describe('Hronaut’s own dialogs', () => {
  it('shows a request on the main window’s shell and resolves with the button the person chose', async () => {
    const { dialogs, main, ready, respond, showNativeMessageBox } = harness()
    ready()
    const answer = dialogs.show(permission)
    const shown = main.shown()!
    expect(shown).toMatchObject({
      type: 'question', title: 'Site permission', message: permission.message, detail: permission.detail,
      buttons: ['Deny', 'Allow'], defaultId: 0, cancelId: 0, primaryId: 1, variant: permission.variant
    })
    respond(main, shown.id, 1)
    await expect(answer).resolves.toEqual({ response: 1, checkboxChecked: false })
    expect(main.shown()).toBeNull()
    expect(showNativeMessageBox).not.toHaveBeenCalled()
  })

  it('shows one dialog at a time, in the order asked, and ignores an answer that arrives late', async () => {
    const { dialogs, main, ready, respond } = harness()
    ready()
    const first = dialogs.show({ ...permission, message: 'first' })
    const second = dialogs.show({ ...permission, message: 'second' })
    const firstRequest = main.shown()!
    expect(firstRequest.message).toBe('first')
    respond(main, firstRequest.id, 0)
    await expect(first).resolves.toMatchObject({ response: 0 })
    const secondRequest = main.shown()!
    expect(secondRequest.message).toBe('second')
    // A second click on the first dialog, sent before the shell drew the next one, must not answer it.
    respond(main, firstRequest.id, 1)
    expect(main.shown()).toBe(secondRequest)
    respond(main, secondRequest.id, 1)
    await expect(second).resolves.toMatchObject({ response: 1 })
  })

  it('closes a dialog whose signal aborts, shown or waiting, answering its cancel button', async () => {
    const { dialogs, main, ready, respond } = harness()
    ready()
    const shownClosing = new AbortController()
    const waitingClosing = new AbortController()
    const shown = dialogs.show({ ...permission, message: 'shown', signal: shownClosing.signal })
    const waiting = dialogs.show({ ...permission, message: 'waiting', signal: waitingClosing.signal })
    const last = dialogs.show({ ...permission, message: 'last' })
    waitingClosing.abort()
    await expect(waiting).resolves.toMatchObject({ response: 0 })
    expect(main.shown()!.message).toBe('shown')
    shownClosing.abort()
    await expect(shown).resolves.toMatchObject({ response: 0 })
    // The aborted one waiting behind it never shows.
    expect(main.shown()!.message).toBe('last')
    expect(main.sent.some((request) => request?.message === 'waiting')).toBe(false)
    respond(main, main.shown()!.id, 1)
    await expect(last).resolves.toMatchObject({ response: 1 })
    const aborted = new AbortController()
    aborted.abort()
    await expect(dialogs.show({ ...permission, cancelId: 1, signal: aborted.signal })).resolves.toMatchObject({ response: 1 })
  })

  it('takes answers only from the shell document that shows the dialog, and only valid buttons', async () => {
    const { dialogs, main, panel, untrusted, ready, respond } = harness()
    ready()
    ready(panel)
    let settled = false
    const answer = dialogs.show(permission).then((value) => { settled = true; return value })
    const { id } = main.shown()!
    // A website's page, the other shell window, and nonsense answers change nothing.
    respond(untrusted, id, 1)
    respond(panel, id, 1)
    respond(main, id, 2)
    respond(main, id, -1)
    respond(main, id, 0.5)
    respond(main, id, '1')
    respond(main, 'another-id', 1)
    await Promise.resolve()
    expect(settled).toBe(false)
    // An untrusted page cannot make a window ready either.
    ready(untrusted)
    expect(untrusted.sent).toEqual([])
    respond(main, id, 0)
    await expect(answer).resolves.toMatchObject({ response: 0 })
  })

  it('asks in the panel window when given it', async () => {
    const { dialogs, main, panel, ready, respond } = harness()
    ready()
    ready(panel)
    const answer = dialogs.show({ ...permission, window: panel.window })
    expect(main.shown()).toBeNull()
    respond(panel, panel.shown()!.id, 1)
    await expect(answer).resolves.toMatchObject({ response: 1 })
  })

  it('falls back to the system dialog when no shell window can show it, so the question is still answered', async () => {
    const { dialogs, main, native, ready } = harness()
    main.window.visible = false
    // A hidden window, as before Hronaut's window first shows.
    const hidden = dialogs.show(permission)
    await vi.waitFor(() => expect(native).toHaveLength(1))
    expect(native[0]!.window).toBe(main.window)
    expect(native[0]!.options).not.toHaveProperty('variant')
    expect(native[0]!.options).not.toHaveProperty('primaryId')
    expect(native[0]!.options).toMatchObject({ message: permission.message, buttons: ['Deny', 'Allow'], defaultId: 0, cancelId: 0 })
    native[0]!.answer(1)
    await expect(hidden).resolves.toMatchObject({ response: 1 })

    main.window.visible = true
    ready()
    main.window.minimized = true
    const minimized = dialogs.show(permission)
    await vi.waitFor(() => expect(native).toHaveLength(2))
    native[1]!.answer(0)
    await expect(minimized).resolves.toMatchObject({ response: 0 })
    expect(main.sent).toEqual([null])
  })

  it('shows a question asked while the shell document starts once it listens, instead of in the system dialog', async () => {
    // Asked just as Hronaut's window showed, such as Another app is using port 47812 at startup, the question came up in
    // the system dialog, as the shell had not loaded its settings yet.
    const { dialogs, main, native, ready, respond } = harness()
    const asked = dialogs.show(permission)
    expect(main.sent).toEqual([])
    ready()
    expect(main.shown()).toMatchObject({ message: permission.message, variant: permission.variant })
    respond(main, main.shown()!.id, 1)
    await expect(asked).resolves.toMatchObject({ response: 1 })
    expect(native).toEqual([])
  })

  it('asks in the system dialog when the shell document does not start within 10 seconds, or crashed', async () => {
    vi.useFakeTimers()
    try {
      const { dialogs, main, native, ready } = harness()
      const asked = dialogs.show(permission)
      await vi.advanceTimersByTimeAsync(9_999)
      expect(native).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      expect(native).toHaveLength(1)
      native[0]!.answer(1)
      await expect(asked).resolves.toMatchObject({ response: 1 })
      // A document that listens late shows only what is asked from then on.
      ready()
      expect(main.sent).toEqual([null])

      main.contents.crashed = true
      const afterCrash = dialogs.show(permission)
      await vi.advanceTimersByTimeAsync(0)
      expect(native).toHaveLength(2)
      native[1]!.answer(0)
      await expect(afterCrash).resolves.toMatchObject({ response: 0 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('moves a question waiting for the shell document to start to the system dialog when the document goes away', async () => {
    const { dialogs, main, native } = harness()
    const asked = dialogs.show(permission)
    main.contents.emit('render-process-gone')
    await vi.waitFor(() => expect(native).toHaveLength(1))
    native[0]!.answer(0)
    await expect(asked).resolves.toMatchObject({ response: 0 })
  })

  it('moves a shown and a waiting dialog to the system dialog when the shell document goes away', async () => {
    const { dialogs, main, native, ready, respond } = harness()
    ready()
    const shown = dialogs.show({ ...permission, message: 'shown' })
    const waiting = dialogs.show({ ...permission, message: 'waiting' })
    main.contents.emit('render-process-gone')
    // The system dialogs show one at a time too.
    await vi.waitFor(() => expect(native).toHaveLength(1))
    expect(native[0]!.options.message).toBe('shown')
    native[0]!.answer(1)
    await expect(shown).resolves.toMatchObject({ response: 1 })
    await vi.waitFor(() => expect(native).toHaveLength(2))
    native[1]!.answer(0)
    await expect(waiting).resolves.toMatchObject({ response: 0 })

    // A reloading shell document is not ready until it says so again, and shows what was asked meanwhile then.
    ready()
    const beforeReload = dialogs.show(permission)
    main.contents.emit('did-navigate', {}, 'http://127.0.0.1:5173/', 200, 'OK')
    await vi.waitFor(() => expect(native).toHaveLength(3))
    native[2]!.answer(0)
    await expect(beforeReload).resolves.toMatchObject({ response: 0 })
    const duringReload = dialogs.show({ ...permission, message: 'during reload' })
    const sentBeforeReady = main.sent.length
    ready()
    expect(main.sent.length).toBe(sentBeforeReady + 1)
    expect(main.shown()).toMatchObject({ message: 'during reload' })
    respond(main, main.shown()!.id, 1)
    await expect(duringReload).resolves.toMatchObject({ response: 1 })
    expect(native).toHaveLength(3)

    // An error page that replaces the shell document takes its dialog away too.
    const beforeError = dialogs.show(permission)
    main.contents.emit('did-fail-provisional-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://127.0.0.1:5173/', true)
    await vi.waitFor(() => expect(native).toHaveLength(4))
    native[3]!.answer(1)
    await expect(beforeError).resolves.toMatchObject({ response: 1 })
  })

  it('answers with the cancel button instead of a system dialog once Hronaut is quitting', async () => {
    // A question in a closing window came back as a system dialog with no window, and on macOS could hold up the quit.
    const { dialogs, main, native, quit, ready } = harness()
    ready()
    const shown = dialogs.show({ ...permission, message: 'shown' })
    const waiting = dialogs.show({ ...permission, cancelId: 1, message: 'waiting' })
    quit.quitting = true
    main.contents.destroyed = true
    main.contents.emit('destroyed')
    await expect(shown).resolves.toMatchObject({ response: 0 })
    await expect(waiting).resolves.toMatchObject({ response: 1 })
    main.window.destroyed = true
    await expect(dialogs.show(permission)).resolves.toMatchObject({ response: 0 })
    expect(native).toHaveLength(0)
  })

  it('keeps the dialog in the shell until another document replaces it, so the shell can still answer it', async () => {
    // The shell document stays when a navigation it starts is refused or cancelled, and when only a frame fails to
    // load. Moving its dialog to the system dialog then left the shell drawing a dialog whose answers counted nowhere.
    const { dialogs, main, native, ready, respond } = harness()
    ready()
    const asked = dialogs.show(permission)
    main.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    main.contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    main.contents.emit('did-fail-provisional-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'https://frame.example/', false)
    main.contents.emit('did-navigate-in-page', {}, 'http://127.0.0.1:5173/#settings', true)
    expect(native).toHaveLength(0)
    const shown = main.shown()!
    respond(main, shown.id, 1)
    await expect(asked).resolves.toMatchObject({ response: 1 })
  })

  it('gives the keyboard back to the page that had it before the first dialog opened, once the last one is answered', async () => {
    const { dialogs, main, ready, respond, keyboard, returnKeyboard } = harness()
    ready()
    const page = { isDestroyed: () => false }
    keyboard.page = page
    const first = dialogs.show({ ...permission, message: 'first' })
    // The shell took the keyboard for the first dialog when the second was asked.
    keyboard.page = null
    const second = dialogs.show({ ...permission, message: 'second' })
    respond(main, main.shown()!.id, 0)
    await first
    expect(returnKeyboard).not.toHaveBeenCalled()
    respond(main, main.shown()!.id, 0)
    await second
    // The person kept the page the dialog asked about; the keyboard used to stay on a control in the shell.
    expect(returnKeyboard).toHaveBeenCalledExactlyOnceWith(page)

    // The next dialog, asked while the person is in the shell, leaves the keyboard there.
    const third = dialogs.show(permission)
    respond(main, main.shown()!.id, 1)
    await third
    expect(returnKeyboard).toHaveBeenCalledOnce()
  })

  it('gives the keyboard back to a page that took it under the dialogs when they opened while the person was away', async () => {
    const { dialogs, main, ready, respond, returnKeyboard } = harness()
    ready()
    const page = { isDestroyed: () => false } as never
    // Noted while no dialog shows, it is not kept for the next one.
    dialogs.noteKeyboardPage(main.window, page)
    // Asked while the person was in another app, so nothing in Hronaut had the keyboard.
    main.window.focused = false
    const answer = dialogs.show(permission)
    // The person comes back to the window they left with the keyboard in the page.
    main.window.focused = true
    dialogs.noteKeyboardPage(main.window, page)
    dialogs.noteKeyboardPage(main.window, { isDestroyed: () => false } as never)
    respond(main, main.shown()!.id, 0)
    await answer
    expect(returnKeyboard).toHaveBeenCalledExactlyOnceWith(page)

    // Asked while the person was in Hronaut's own controls: a page focused under it is not theirs.
    const next = dialogs.show(permission)
    dialogs.noteKeyboardPage(main.window, page)
    respond(main, main.shown()!.id, 0)
    await next
    expect(returnKeyboard).toHaveBeenCalledOnce()
  })

  it('answers the dialog when giving the keyboard back fails', async () => {
    const { dialogs, main, ready, respond, keyboard, returnKeyboard } = harness()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      ready()
      keyboard.page = { isDestroyed: () => false }
      returnKeyboard.mockImplementation(() => { throw new Error('gone') })
      const answer = dialogs.show(permission)
      respond(main, main.shown()!.id, 1)
      await expect(answer).resolves.toMatchObject({ response: 1 })
      expect(logged).toHaveBeenCalledOnce()
    } finally {
      logged.mockRestore()
    }
  })

  it('gives the keyboard back when the last dialog closes because its signal aborted', async () => {
    const { dialogs, ready, keyboard, returnKeyboard } = harness()
    ready()
    const page = { isDestroyed: () => false }
    keyboard.page = page
    const controller = new AbortController()
    const answer = dialogs.show({ ...permission, signal: controller.signal })
    controller.abort()
    await answer
    expect(returnKeyboard).toHaveBeenCalledExactlyOnceWith(page)
  })

  it('gives nothing back to a page closed meanwhile, or when system dialogs ask instead', async () => {
    const { dialogs, main, native, ready, respond, keyboard, returnKeyboard } = harness()
    ready()
    const closed = { destroyed: false, isDestroyed() { return this.destroyed } }
    keyboard.page = closed
    const answer = dialogs.show(permission)
    closed.destroyed = true
    respond(main, main.shown()!.id, 1)
    await answer
    expect(returnKeyboard).not.toHaveBeenCalled()

    // The shell document goes away, and the system dialog that asks instead leaves the keyboard with the window.
    keyboard.page = { isDestroyed: () => false }
    const handedOff = dialogs.show(permission)
    main.contents.emit('destroyed')
    await vi.waitFor(() => expect(native).toHaveLength(1))
    native[0]!.answer(0)
    await handedOff
    expect(returnKeyboard).not.toHaveBeenCalled()
  })

  it('defaults to the cancel button for focus and a plain message design', () => {
    const { dialogs, main, ready } = harness()
    ready()
    void dialogs.show({ message: 'Hello', buttons: ['Cancel', 'OK'], cancelId: 0, defaultId: 7, primaryId: 0 })
    expect(main.shown()).toMatchObject({ type: 'none', defaultId: 0, cancelId: 0, variant: { kind: 'message' } })
    // The cancel button is never drawn as the main action.
    expect(main.shown()).not.toHaveProperty('primaryId')
  })
})
