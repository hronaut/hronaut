import type { MessageBoxOptions, Session } from 'electron'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { translate } from '../src/shared/i18n.js'

vi.mock('electron', () => ({ app: { getPath: () => '' }, session: { fromPartition: vi.fn() } }))

const { createBrowserSession } = await import('../src/main/browser-session.js')

type RequestHandler = Parameters<Session['setPermissionRequestHandler']>[0] & {}
type CheckHandler = Parameters<Session['setPermissionCheckHandler']>[0] & {}

// Electron asks the permission check, not the request's answer, whether a page may still use what the person gave it.
// The check refused the camera, the microphone and file access every time: a file the person picked or dropped could
// not be read ("NotAllowedError" from getFile()), an allowed write failed, and a page in a call it was allowed read its
// devices as "denied", with no names.

const WORKSPACE = '01912345-6789-7abc-8def-0123456789ab'
const site = { url: 'https://editor.example/notes', origin: 'https://editor.example' }
const fromSite = { requestingUrl: site.url, isMainFrame: true }

/** One workspace session's handlers, answering each prompt with the next answer in `answers`. */
function createHarness(answers: Array<'allow' | 'deny'> = []) {
  const shown: MessageBoxOptions[] = []
  const handlers = { request: undefined as RequestHandler | undefined, check: undefined as CheckHandler | undefined }
  const browserSession = createBrowserSession({
    text: (key, parameters) => translate('en-US', key, parameters),
    effectiveDownloadDirectory: () => '',
    showMessageBox: async (options) => {
      shown.push(options)
      return { response: answers.shift() === 'allow' ? 1 : 0, checkboxChecked: false }
    },
    workspaces: () => [],
    state: { persistentSession: null, sitePermissionStore: null },
    sendToShellWindows: () => undefined,
    partition: 'persist:test'
  })
  const workspaceSession = {
    setDownloadPath: () => undefined,
    setPermissionCheckHandler: (next: CheckHandler) => { handlers.check = next },
    setPermissionRequestHandler: (next: RequestHandler) => { handlers.request = next }
  } as unknown as Session
  browserSession.configureBrowserSession(workspaceSession, WORKSPACE)
  return { shown, handlers, workspaceSession, browserSession }
}

/** A page showing `document` in the given session, which can load another document or close. */
function createPage(browserSession: Session, document = site) {
  const mainFrame = { frameTreeNodeId: 1, processId: 7, routingId: 100, ...document, detached: false }
  const contents = Object.assign(new EventEmitter(), {
    destroyed: false,
    session: browserSession,
    isDestroyed: () => contents.destroyed,
    getURL: () => mainFrame.url,
    mainFrame: Object.assign(mainFrame, { framesInSubtree: [mainFrame] })
  })
  return {
    contents,
    reload(): void {
      contents.emit('did-frame-navigate', {}, mainFrame.url, 200, 'OK', true, mainFrame.processId, mainFrame.routingId)
    },
    close(): void {
      contents.destroyed = true
      contents.emit('destroyed')
    }
  }
}

function ask(handlers: { request?: RequestHandler }, page: { contents: unknown }, permission: string, details: Record<string, unknown>): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    handlers.request!(page.contents as never, permission as never, resolve, { ...fromSite, ...details } as never)
  })
}

describe('camera and microphone the person allowed', () => {
  // What Chromium checks to name a page's devices: the page, its website and one device type.
  const device = (handlers: { check?: CheckHandler }, page: { contents: unknown } | null, mediaType: string, origin = site.origin) =>
    handlers.check!((page?.contents ?? null) as never, 'media', origin, { securityOrigin: `${origin}/`, requestingUrl: site.url, isMainFrame: true, mediaType } as never)

  it('reads as allowed for the devices the person allowed, while the page keeps its document', async () => {
    const { handlers, workspaceSession } = createHarness(['allow'])
    const page = createPage(workspaceSession)
    expect(device(handlers, page, 'video')).toBe(false)
    expect(await ask(handlers, page, 'media', { mediaTypes: ['video'] })).toBe(true)
    expect(device(handlers, page, 'video')).toBe(true)
    // Only the camera was allowed, only for this website, only on this page.
    expect(device(handlers, page, 'audio')).toBe(false)
    expect(device(handlers, page, 'unknown')).toBe(false)
    expect(device(handlers, page, 'video', 'https://ads.example')).toBe(false)
    expect(device(handlers, createPage(workspaceSession), 'video')).toBe(false)
    expect(device(handlers, null, 'video')).toBe(false)
    page.reload()
    expect(device(handlers, page, 'video')).toBe(false)
  })

  it('reads as blocked again once the person denies the same device on that page, and asks for every request', async () => {
    const { handlers, workspaceSession, shown } = createHarness(['allow', 'deny'])
    const page = createPage(workspaceSession)
    expect(await ask(handlers, page, 'media', { mediaTypes: ['audio', 'video'] })).toBe(true)
    expect(device(handlers, page, 'audio')).toBe(true)
    expect(await ask(handlers, page, 'media', { mediaTypes: ['video'] })).toBe(false)
    expect(shown).toHaveLength(2)
    expect(device(handlers, page, 'video')).toBe(false)
    expect(device(handlers, page, 'audio')).toBe(true)
  })
})

describe('files and folders a website holds', () => {
  // What Chromium checks for a handle: no page, the website, and the file and its access.
  const file = (handlers: { check?: CheckHandler }, fileAccessType: string, filePath = '/home/person/notes.txt', origin = `${site.origin}/`) =>
    handlers.check!(null, 'fileSystem' as never, origin, { filePath, isDirectory: false, fileAccessType } as never)

  it('can be read when the person picked or dropped them, which no request asks about', () => {
    const { handlers } = createHarness()
    expect(file(handlers, 'readable')).toBe(true)
    expect(file(handlers, 'writable')).toBe(false)
  })

  it('can be written only while the page the person allowed it for keeps its document', async () => {
    const { handlers, workspaceSession, shown } = createHarness(['allow'])
    const page = createPage(workspaceSession)
    expect(await ask(handlers, page, 'fileSystem', { filePath: '/home/person/notes.txt', isDirectory: false, fileAccessType: 'writable' })).toBe(true)
    expect(shown[0]!.detail).toBe(
      'Requested write access: /home/person/notes.txt. If you choose Allow, this page can save changes there until it reloads. '
        + "Hronaut doesn't remember this choice. If you choose Deny, this page can't ask for this again until it reloads."
    )
    expect(file(handlers, 'writable')).toBe(true)
    expect(file(handlers, 'writable', '/home/person/other.txt')).toBe(false)
    expect(file(handlers, 'writable', '/home/person/notes.txt', 'https://ads.example/')).toBe(false)
    page.reload()
    expect(file(handlers, 'writable')).toBe(false)
  })

  it('stops a write Allow when its page closes', async () => {
    const { handlers, workspaceSession } = createHarness(['allow'])
    const page = createPage(workspaceSession)
    await ask(handlers, page, 'fileSystem', { filePath: '/home/person/notes.txt', fileAccessType: 'writable' })
    expect(file(handlers, 'writable')).toBe(true)
    page.close()
    expect(file(handlers, 'writable')).toBe(false)
  })

  it('cannot be read once the person denies reading them, until that page loads another document', async () => {
    const { handlers, workspaceSession } = createHarness(['deny'])
    const page = createPage(workspaceSession)
    expect(await ask(handlers, page, 'fileSystem', { filePath: '/home/person/notes.txt', fileAccessType: 'readable' })).toBe(false)
    expect(file(handlers, 'readable')).toBe(false)
    expect(file(handlers, 'readable', '/home/person/other.txt')).toBe(true)
    page.reload()
    expect(file(handlers, 'readable')).toBe(true)
  })

  it('gives another workspace’s pages and Home nothing from this workspace', async () => {
    const harness = createHarness(['allow'])
    const page = createPage(harness.workspaceSession)
    await ask(harness.handlers, page, 'fileSystem', { filePath: '/home/person/notes.txt', fileAccessType: 'writable' })
    const other = { check: undefined as CheckHandler | undefined }
    const otherSession = {
      setDownloadPath: () => undefined,
      setPermissionCheckHandler: (next: CheckHandler) => { other.check = next },
      setPermissionRequestHandler: () => undefined
    } as unknown as Session
    harness.browserSession.configureBrowserSession(otherSession, '01912345-678a-7abc-8def-0123456789ab')
    expect(file(other, 'writable')).toBe(false)
    const home = { check: undefined as CheckHandler | undefined }
    harness.browserSession.configureBrowserSession({
      setDownloadPath: () => undefined,
      setPermissionCheckHandler: (next: CheckHandler) => { home.check = next },
      setPermissionRequestHandler: () => undefined
    } as unknown as Session)
    expect(file(home, 'readable')).toBe(false)
  })
})

it('never admits a link to another app from a check, even after the person allowed one', async () => {
  const { handlers, workspaceSession } = createHarness(['allow'])
  const page = createPage(workspaceSession)
  expect(await ask(handlers, page, 'openExternal', { externalURL: 'zoommtg://zoom.us/join' })).toBe(true)
  expect(handlers.check!(page.contents as never, 'openExternal' as never, site.origin, fromSite as never)).toBe(false)
})
