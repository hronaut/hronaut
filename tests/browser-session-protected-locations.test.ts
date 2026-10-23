import type { MessageBoxOptions, Session } from 'electron'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { translate } from '../src/shared/i18n.js'

vi.mock('electron', () => ({ app: { getPath: () => '' }, session: { fromPartition: vi.fn() } }))

const { createBrowserSession } = await import('../src/main/browser-session.js')

// A website's file or folder picker never returned when the person picked a location Chromium protects, such as their
// Documents folder itself or Hronaut's own profile: Electron asks the session what to do and waits, and Hronaut never
// answered, so the website waited forever.

type ProtectedAction = 'allow' | 'deny' | 'tryAgain'
type ProtectedListener = (event: unknown, details: Record<string, unknown>, callback: (action: ProtectedAction) => void) => void
type Frame = { frameTreeNodeId: number, processId: number, routingId: number, url: string, origin: string, detached: boolean }

const WORKSPACE = '01912345-6789-7abc-8def-0123456789ab'

/** A page showing the editor, with a frame of the same website inside it. */
function createPage() {
  const mainFrame: Frame & { framesInSubtree: Frame[] } = {
    frameTreeNodeId: 1, processId: 1, routingId: 1, url: 'https://editor.example/', origin: 'https://editor.example', detached: false,
    framesInSubtree: []
  }
  const childFrame: Frame = {
    frameTreeNodeId: 2, processId: 1, routingId: 2, url: 'https://editor.example/panel', origin: 'https://editor.example', detached: false
  }
  mainFrame.framesInSubtree = [mainFrame, childFrame]
  const page = Object.assign(new EventEmitter(), { destroyed: false, isDestroyed: () => page.destroyed, mainFrame, childFrame })
  return page
}

/**
 * One session's protected-location listener, answering each prompt with the next of `responses`: a button, 'reject'
 * for a prompt that fails, or nothing left for a person who waits until the prompt is closed for them.
 */
function createHarness(responses: Array<number | 'reject'> = [], workspaceId: string | null = WORKSPACE) {
  const shown: MessageBoxOptions[] = []
  const browserSession = createBrowserSession({
    text: (key, parameters) => translate('en-US', key, parameters),
    effectiveDownloadDirectory: () => '',
    showDialog: async (options) => {
      shown.push(options)
      const response = responses.shift()
      if (response === 'reject') throw new Error('The prompt failed')
      if (response === undefined) {
        await new Promise<void>((resolve) => options.signal?.addEventListener('abort', () => resolve()))
        return { response: options.cancelId ?? 0, checkboxChecked: false }
      }
      return { response, checkboxChecked: false }
    },
    workspaces: () => [],
    websitesMaySaveFiles: () => false,
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
  const page = createPage()
  const callbacks: Array<ReturnType<typeof vi.fn>> = []
  /** Gives the website a protected location and resolves with Hronaut's first answer. */
  const pick = (details: Record<string, unknown> = {}): Promise<ProtectedAction> => new Promise((resolve) => {
    const callback = vi.fn((action: ProtectedAction) => resolve(action))
    callbacks.push(callback)
    const webContents = 'webContents' in details ? details.webContents as ReturnType<typeof createPage> | null : page
    listeners.get('file-system-access-restricted')!({}, {
      origin: 'https://editor.example',
      isDirectory: true,
      path: '/home/person/Documents',
      frame: webContents?.mainFrame ?? null,
      webContents,
      ...details
    }, callback)
  })
  /** Electron answers each request once: a second answer would be lost, and a missing one leaves the website waiting. */
  const expectEachAnsweredOnce = (): void => {
    for (const callback of callbacks) expect(callback).toHaveBeenCalledTimes(1)
  }
  return { shown, page, pick, expectEachAnsweredOnce }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('a location Chromium protects', () => {
  it('lets the person choose another folder or cancel, and never gives it to the website', async () => {
    const { shown, pick, expectEachAnsweredOnce } = createHarness([1, 0])
    expect(await pick()).toBe('tryAgain')
    expect(shown[0]).toMatchObject({
      type: 'warning',
      message: "https://editor.example can't use this folder",
      detail: "A website's picker or a dropped folder can't give it a system folder, Hronaut's own data, private keys such as "
        + '~/.ssh, or a whole personal folder such as your home, Documents or Downloads folder. You can choose another folder, '
        + 'such as one inside Documents. If you dropped this one, drop another folder instead.',
      buttons: ['Cancel', 'Choose another folder'],
      defaultId: 0,
      cancelId: 0
    })
    // The prompt never names the path: the website chose where its picker opened.
    expect(JSON.stringify(shown[0])).not.toContain('/home/person')
    expect(await pick()).toBe('deny')
    expectEachAnsweredOnce()
  })

  it('names a file as a file, for a website that opens or saves it', async () => {
    const { shown, pick } = createHarness([1])
    expect(await pick({ isDirectory: false, path: '/home/person/.ssh/id_ed25519' })).toBe('tryAgain')
    expect(shown[0]).toMatchObject({
      message: "https://editor.example can't use this file",
      detail: "A website's file picker can't give it a system file, Hronaut's own data or private keys. You can choose another file.",
      buttons: ['Cancel', 'Choose another file']
    })
  })

  it('asks for a frame inside the page, as the website that frame runs', async () => {
    const { shown, page, pick } = createHarness([1])
    expect(await pick({ frame: page.childFrame })).toBe('tryAgain')
    expect(shown).toHaveLength(1)
  })

  it('refuses without asking for Home, a page or frame that is gone, or a document that is not a website', async () => {
    const home = createHarness([1], null)
    expect(await home.pick()).toBe('deny')
    expect(home.shown).toEqual([])
    const harness = createHarness([1])
    expect(await harness.pick({ webContents: null })).toBe('deny')
    expect(await harness.pick({ frame: null })).toBe('deny')
    expect(await harness.pick({ frame: { ...harness.page.childFrame, detached: true } })).toBe('deny')
    expect(await harness.pick({ origin: 'file:///' })).toBe('deny')
    // The frame that asked runs as another website than the one Electron names.
    expect(await harness.pick({ origin: 'https://other.example' })).toBe('deny')
    harness.page.destroyed = true
    expect(await harness.pick()).toBe('deny')
    expect(harness.shown).toEqual([])
    harness.expectEachAnsweredOnce()
  })

  it('refuses once when the prompt fails', async () => {
    const { pick, page, expectEachAnsweredOnce } = createHarness(['reject'])
    expect(await pick()).toBe('deny')
    expectEachAnsweredOnce()
    expect(page.listenerCount('did-fail-load')).toBe(0)
  })

  it('closes the prompt and refuses once the page closes or loads another document', async () => {
    const closed = createHarness()
    const closing = closed.pick()
    await vi.waitFor(() => expect(closed.shown).toHaveLength(1))
    closed.page.destroyed = true
    closed.page.emit('destroyed')
    expect(await closing).toBe('deny')
    closed.expectEachAnsweredOnce()

    const navigated = createHarness()
    const leaving = navigated.pick()
    await vi.waitFor(() => expect(navigated.shown).toHaveLength(1))
    // The frame inside the page loading another document leaves the main frame's prompt open.
    navigated.page.emit('did-frame-navigate', {}, 'https://ads.example/', 200, 'OK', false, 1, 2)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(navigated.shown[0]!.signal!.aborted).toBe(false)
    navigated.page.emit('did-frame-navigate', {}, 'https://editor.example/next', 200, 'OK', true, 1, 1)
    expect(await leaving).toBe('deny')
    navigated.expectEachAnsweredOnce()
    expect(navigated.page.listenerCount('did-fail-load')).toBe(0)

    // A page that fails to load another document shows an error page, which runs as no website.
    const failed = createHarness()
    const failing = failed.pick()
    await vi.waitFor(() => expect(failed.shown).toHaveLength(1))
    failed.page.mainFrame.url = 'chrome-error://chromewebdata/'
    failed.page.mainFrame.origin = 'null'
    failed.page.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://gone.example/', true, 1, 1)
    expect(await failing).toBe('deny')
  })

  it('closes the prompt of a frame the page removes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { shown, page, pick } = createHarness([])
    const removing = pick({ frame: page.childFrame })
    await vi.waitFor(() => expect(shown).toHaveLength(1))
    page.childFrame.detached = true
    page.mainFrame.framesInSubtree = [page.mainFrame]
    vi.advanceTimersByTime(500)
    expect(await removing).toBe('deny')
  })

  it('refuses without asking when the page loaded another document while the request waited for another prompt', async () => {
    const harness = createHarness()
    const otherPage = createPage()
    const first = harness.pick({ webContents: otherPage })
    await vi.waitFor(() => expect(harness.shown).toHaveLength(1))
    const waiting = harness.pick()
    harness.page.emit('did-frame-navigate', {}, 'https://editor.example/next', 200, 'OK', true, 1, 1)
    otherPage.destroyed = true
    otherPage.emit('destroyed')
    expect(await first).toBe('deny')
    expect(await waiting).toBe('deny')
    expect(harness.shown).toHaveLength(1)
    harness.expectEachAnsweredOnce()
  })
})
