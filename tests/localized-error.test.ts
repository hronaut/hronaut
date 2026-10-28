import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'

vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: { showMessageBox: vi.fn() },
  clipboard: {},
  ClipboardItem: class {},
  nativeImage: {}
}))

const { LocalizedError, personErrorMessage, withTranslatedIpcErrors } = await import('../src/main/localized-error.js')
const { createIpcGuards } = await import('../src/main/ipc-guards.js')
const { createShellWindows } = await import('../src/main/windows/shell-windows.js')
const { createClipboardOperations } = await import('../src/main/clipboard-operations.js')
const { translate } = await import('../src/shared/i18n.js')

const SHELL_URL = 'http://127.0.0.1:5173/'
const ukrainian = (key: Parameters<typeof translate>[1], parameters?: Parameters<typeof translate>[2]) => translate('uk-UA', key, parameters)

type Listener = Parameters<IpcMain['handle']>[1]

function fakeIpcMain() {
  const handlers = new Map<string, Listener>()
  const listeners = new Map<string, unknown>()
  const ipcMain = {
    handle: vi.fn((channel: string, listener: Listener) => { handlers.set(channel, listener) }),
    on: vi.fn((channel: string, listener: unknown) => { listeners.set(channel, listener); return ipcMain })
  }
  return { ipcMain: ipcMain as unknown as Pick<IpcMain, 'handle' | 'on'>, handlers, listeners }
}

function invokeEvent(url: string, sender: object = {}): IpcMainInvokeEvent {
  return { sender, senderFrame: { url } } as unknown as IpcMainInvokeEvent
}

describe('LocalizedError', () => {
  it('keeps the English text as its message, for MCP results, logs and code that compares messages', () => {
    const error = new LocalizedError('appErrors.sleep.pinned')
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('Pinned tabs stay active.')
    expect(error.key).toBe('appErrors.sleep.pinned')
    expect(String(error)).toBe('Error: Pinned tabs stay active.')
  })

  it('can keep a message for agents that differs from what a person reads', () => {
    const cause = new Error('raw')
    const error = new LocalizedError('native.errors.tabUnavailable', undefined, { message: 'Tab not found: 3f1c', cause })
    expect(error.message).toBe('Tab not found: 3f1c')
    expect(error.cause).toBe(cause)
    expect(personErrorMessage(error, (key, parameters) => translate('en-US', key, parameters))).toBe('The tab is no longer available.')
    expect(personErrorMessage(error, ukrainian)).toBe('Вкладка більше недоступна.')
    expect('cause' in new LocalizedError('appErrors.sleep.pinned')).toBe(false)
  })

  it('gives a person the interface language and leaves other errors as they are', () => {
    expect(personErrorMessage(new LocalizedError('appErrors.splitView.notOpen'), ukrainian)).toBe('Розділений перегляд не відкрито.')
    expect(personErrorMessage(new Error('ERR_NAME_NOT_RESOLVED'), ukrainian)).toBe('ERR_NAME_NOT_RESOLVED')
  })
})

describe('withTranslatedIpcErrors', () => {
  it('turns a LocalizedError into the interface language for Hronaut pages only', async () => {
    const { ipcMain, handlers } = fakeIpcMain()
    const translated = withTranslatedIpcErrors(ipcMain, {
      isHronautPage: (event) => event.senderFrame?.url === SHELL_URL,
      text: ukrainian
    })
    translated.handle('browser:split', () => { throw new LocalizedError('appErrors.splitView.sameTab') })
    const listener = handlers.get('browser:split')!

    await expect(listener(invokeEvent(SHELL_URL))).rejects.toThrow('Виберіть іншу вкладку для розділеного перегляду.')
    // A website never learns the interface language from an error.
    const forWebsite = await Promise.resolve(listener(invokeEvent('https://site.example/'))).catch((error: unknown) => error)
    expect(forWebsite).toBeInstanceOf(LocalizedError)
    expect((forWebsite as Error).message).toBe('Choose a different tab for split view.')
  })

  it('passes results, other errors and event listeners through unchanged', async () => {
    const { ipcMain, handlers, listeners } = fakeIpcMain()
    const translated = withTranslatedIpcErrors(ipcMain, { isHronautPage: () => true, text: ukrainian })
    const raw = new Error('ERR_CONNECTION_REFUSED (-102)')
    translated.handle('value', async (_event, value: unknown) => ({ value }))
    translated.handle('raw', () => { throw raw })
    const onListener = vi.fn()
    expect(translated.on('ping', onListener)).toBe(ipcMain)

    await expect(handlers.get('value')!(invokeEvent(SHELL_URL), 7)).resolves.toEqual({ value: 7 })
    await expect(Promise.resolve(handlers.get('raw')!(invokeEvent(SHELL_URL))).catch((error: unknown) => error)).resolves.toBe(raw)
    expect(listeners.get('ping')).toBe(onListener)
  })
})

describe('isHronautPageSender', () => {
  beforeEach(() => { vi.stubEnv('ELECTRON_RENDERER_URL', SHELL_URL) })
  afterEach(() => { vi.unstubAllEnvs() })

  it('admits the shell of either window and Home, never a website', () => {
    const mainContents = {}
    const panelContents = {}
    const { isHronautPageSender } = createIpcGuards({
      ipcMain: fakeIpcMain().ipcMain,
      workspaceStartupFailure: () => undefined,
      tabsInitializationPromise: () => null,
      tabs: () => null,
      initializedTabs: () => null,
      mainWindowRefs: { window: { webContents: mainContents } as never },
      panelWindowRefs: { window: { webContents: panelContents } as never, url: 'http://127.0.0.1:5173/#panel' },
      workspaceStartupReads: { run: vi.fn() as never }
    })

    expect(isHronautPageSender(invokeEvent(SHELL_URL, mainContents))).toBe(true)
    expect(isHronautPageSender(invokeEvent('http://127.0.0.1:5173/#panel', panelContents))).toBe(true)
    expect(isHronautPageSender(invokeEvent('hronaut://home/', {}))).toBe(true)
    expect(isHronautPageSender(invokeEvent('https://site.example/', mainContents))).toBe(false)
    expect(isHronautPageSender(invokeEvent(SHELL_URL, {}))).toBe(false)
  })

  it('still admits the shell, and only the shell, for answers after saved workspaces failed to start', () => {
    const mainContents = {}
    const panelContents = {}
    const failure = new LocalizedError('appErrors.startup.unavailable')
    const { assertTrustedShellSender, isShellWindowSender, assertMainShellSender, isMainShellSender } = createIpcGuards({
      ipcMain: fakeIpcMain().ipcMain,
      workspaceStartupFailure: () => failure,
      tabsInitializationPromise: () => null,
      tabs: () => null,
      initializedTabs: () => null,
      mainWindowRefs: { window: { webContents: mainContents } as never },
      panelWindowRefs: { window: { webContents: panelContents } as never, url: 'http://127.0.0.1:5173/#panel' },
      workspaceStartupReads: { run: vi.fn() as never }
    })

    // Browser changes stay refused, but a dialog the shell shows, such as about that failure, can still be answered.
    expect(() => assertTrustedShellSender(invokeEvent(SHELL_URL, mainContents))).toThrow(failure)
    expect(isShellWindowSender(invokeEvent(SHELL_URL, mainContents))).toBe(true)
    expect(isShellWindowSender(invokeEvent('https://site.example/', mainContents))).toBe(false)
    expect(isShellWindowSender(invokeEvent(SHELL_URL, {}))).toBe(false)
    // The main window's shell alone, which a request it numbers is refused back to rather than thrown at.
    expect(() => assertMainShellSender(invokeEvent(SHELL_URL, mainContents))).toThrow(failure)
    expect(isMainShellSender(invokeEvent(SHELL_URL, mainContents))).toBe(true)
    expect(isMainShellSender(invokeEvent('http://127.0.0.1:5173/#panel', panelContents))).toBe(false)
    expect(isMainShellSender(invokeEvent('https://site.example/', mainContents))).toBe(false)
  })
})

describe('failures the main process sends to the shell', () => {
  it('reports a failed browser action in the interface language', () => {
    const send = vi.fn()
    const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } }
    const { reportBrowserActionFailure } = createShellWindows({
      mainWindowRefs: { window: window as never },
      panelWindowRefs: { window: null },
      workspaceStartupFailure: () => undefined,
      text: ukrainian
    })

    reportBrowserActionFailure('sleep-tab', new LocalizedError('appErrors.sleep.pinned'))
    reportBrowserActionFailure('reload', new Error('Tab not found: 3f1c'))

    expect(send).toHaveBeenNthCalledWith(1, 'browser:action-failed', { action: 'sleep-tab', message: 'Закріплені вкладки залишаються активними.' })
    expect(send).toHaveBeenNthCalledWith(2, 'browser:action-failed', { action: 'reload', message: 'Вкладка більше недоступна.' })
  })

  it('reports a failed copy in the interface language', () => {
    const send = vi.fn()
    const { reportClipboardFailure } = createClipboardOperations({
      text: ukrainian,
      mainWindow: () => ({ isDestroyed: () => false, webContents: { isDestroyed: () => false, send } }) as never
    })

    reportClipboardFailure(new LocalizedError('appErrors.clipboard.textRejected'))

    expect(send).toHaveBeenCalledWith('clipboard:failed', 'Текст підготовлено, але системний буфер обміну його не прийняв.')
  })
})
