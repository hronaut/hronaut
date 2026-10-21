import type { MessageBoxOptions, Session } from 'electron'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { translate } from '../src/shared/i18n.js'

vi.mock('electron', () => ({ app: { getPath: () => '' }, session: { fromPartition: vi.fn() } }))

const { createBrowserSession } = await import('../src/main/browser-session.js')

// A website's file or folder picker never returned when the person picked a location Chromium protects, such as their
// Documents folder itself or Hronaut's own profile: Electron asks the session what to do and waits, and Hronaut never
// answered, so the website waited forever.

type ProtectedAction = 'allow' | 'deny' | 'tryAgain'
type ProtectedListener = (event: unknown, details: Record<string, unknown>, callback: (action: ProtectedAction) => void) => void

const WORKSPACE = '01912345-6789-7abc-8def-0123456789ab'

/** One session's protected-location listener, answering each prompt with the next response in `responses`. */
function createHarness(responses: number[] = [], workspaceId: string | null = WORKSPACE) {
  const shown: MessageBoxOptions[] = []
  const browserSession = createBrowserSession({
    text: (key, parameters) => translate('en-US', key, parameters),
    effectiveDownloadDirectory: () => '',
    showMessageBox: async (options) => {
      shown.push(options)
      if (responses.length === 0) {
        // Waits like a person would, until the prompt is closed for them.
        await new Promise<void>((resolve) => options.signal?.addEventListener('abort', () => resolve()))
        return { response: options.cancelId ?? 0, checkboxChecked: false }
      }
      return { response: responses.shift()!, checkboxChecked: false }
    },
    workspaces: () => [],
    state: { persistentSession: null, sitePermissionStore: null },
    sendToShellWindows: () => undefined,
    partition: 'persist:test'
  })
  const listeners = new Map<string, ProtectedListener>()
  const fakeSession = {
    setDownloadPath: () => undefined,
    setPermissionCheckHandler: () => undefined,
    setPermissionRequestHandler: () => undefined,
    on: (event: string, listener: ProtectedListener) => { listeners.set(event, listener) }
  } as unknown as Session
  browserSession.configureBrowserSession(fakeSession, workspaceId ?? undefined)
  const page = Object.assign(new EventEmitter(), { destroyed: false, isDestroyed: () => page.destroyed })
  const pick = (details: Partial<{ origin: string, isDirectory: boolean, path: string, webContents: unknown }> = {}): Promise<ProtectedAction> =>
    new Promise((resolve) => {
      listeners.get('file-system-access-restricted')!({}, {
        origin: 'https://editor.example/',
        isDirectory: true,
        path: '/home/person/Documents',
        frame: null,
        webContents: page,
        ...details
      }, resolve)
    })
  return { shown, page, pick }
}

describe('a location Chromium protects', () => {
  it('lets the person choose another folder or cancel, and never gives it to the website', async () => {
    const { shown, pick } = createHarness([1, 0])
    expect(await pick()).toBe('tryAgain')
    expect(shown[0]).toMatchObject({
      type: 'warning',
      message: "https://editor.example can't open this folder",
      detail: 'Hronaut never gives websites a system folder, its own data, private keys such as ~/.ssh, or a whole personal '
        + 'folder such as your home, Documents or Downloads folder. You can choose another folder, such as one inside Documents.',
      buttons: ['Cancel', 'Choose another folder'],
      defaultId: 0,
      cancelId: 0
    })
    // The prompt never names the path: the website chose where its picker opened.
    expect(JSON.stringify(shown[0])).not.toContain('/home/person')
    expect(await pick()).toBe('deny')
  })

  it('names a file as a file', async () => {
    const { shown, pick } = createHarness([1])
    expect(await pick({ isDirectory: false, path: '/home/person/.ssh/id_ed25519' })).toBe('tryAgain')
    expect(shown[0]).toMatchObject({
      message: "https://editor.example can't open this file",
      detail: 'Hronaut never gives websites a system file, its own data or private keys. You can choose another file.',
      buttons: ['Cancel', 'Choose another file']
    })
  })

  it('refuses without asking for Home, a page that is gone or a document that is not a website', async () => {
    const home = createHarness([1], null)
    expect(await home.pick()).toBe('deny')
    expect(home.shown).toEqual([])
    const harness = createHarness([1])
    expect(await harness.pick({ webContents: null })).toBe('deny')
    expect(await harness.pick({ origin: 'file:///' })).toBe('deny')
    harness.page.destroyed = true
    expect(await harness.pick()).toBe('deny')
    expect(harness.shown).toEqual([])
  })

  it('closes the prompt and refuses once the page closes or loads another document', async () => {
    const closed = createHarness()
    const closing = closed.pick()
    await vi.waitFor(() => expect(closed.shown).toHaveLength(1))
    closed.page.destroyed = true
    closed.page.emit('destroyed')
    expect(await closing).toBe('deny')

    const navigated = createHarness()
    const leaving = navigated.pick()
    await vi.waitFor(() => expect(navigated.shown).toHaveLength(1))
    // A frame inside the page loading another document leaves the prompt open.
    navigated.page.emit('did-frame-navigate', {}, 'https://ads.example/', 200, 'OK', false)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(navigated.shown[0]!.signal!.aborted).toBe(false)
    navigated.page.emit('did-frame-navigate', {}, 'https://editor.example/next', 200, 'OK', true)
    expect(await leaving).toBe('deny')
    expect(navigated.page.listenerCount('did-frame-navigate')).toBe(0)
    expect(navigated.page.listenerCount('destroyed')).toBe(0)
  })
})
