import type { MessageBoxOptions, Session } from 'electron'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, truncate, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
function createHarness(answers: Array<'allow' | 'deny'> = [], saveFiles: () => boolean = () => false) {
  const shown: MessageBoxOptions[] = []
  const handlers = { request: undefined as RequestHandler | undefined, check: undefined as CheckHandler | undefined }
  const browserSession = createBrowserSession({
    text: (key, parameters) => translate('en-US', key, parameters),
    effectiveDownloadDirectory: () => '',
    showDialog: async (options) => {
      shown.push(options)
      return { response: answers.shift() === 'allow' ? 1 : 0, checkboxChecked: false }
    },
    workspaces: () => [],
    state: { persistentSession: null, sitePermissionStore: null },
    sendToShellWindows: () => undefined,
    partition: 'persist:test',
    websitesMaySaveFiles: saveFiles,
    trackSpellCheck: () => undefined
  })
  const workspaceSession = {
    setDownloadPath: () => undefined,
    setPermissionCheckHandler: (next: CheckHandler) => { handlers.check = next },
    setPermissionRequestHandler: (next: RequestHandler) => { handlers.request = next },
    on: () => undefined
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

  it('reads as allowed for a website embedded in the page, and not for the page around it', async () => {
    const { handlers, workspaceSession } = createHarness(['allow'])
    const page = createPage(workspaceSession)
    const ads = { frameTreeNodeId: 2, processId: 8, routingId: 200, url: 'https://ads.example/call', origin: 'https://ads.example', detached: false }
    page.contents.mainFrame.framesInSubtree.push(ads)
    expect(await ask(handlers, page, 'media', { requestingUrl: ads.url, isMainFrame: false, mediaTypes: ['video'] })).toBe(true)
    const embedded = (mediaType: string) => handlers.check!(page.contents as never, 'media', ads.origin, {
      securityOrigin: `${ads.origin}/`, requestingUrl: ads.url, isMainFrame: false, mediaType
    } as never)
    expect(embedded('video')).toBe(true)
    expect(embedded('audio')).toBe(false)
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
      'Requested write access: /home/person/notes.txt. If you choose Allow, this website can save changes there until this page reloads. '
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
    const { handlers, workspaceSession, shown } = createHarness(['deny'])
    const page = createPage(workspaceSession)
    expect(await ask(handlers, page, 'fileSystem', { filePath: '/home/person/notes.txt', fileAccessType: 'readable' })).toBe(false)
    // A website keeps reading what it holds, even a handle it restores after a restart, so the prompt says so.
    expect(shown[0]!.detail).toBe(
      'Requested read access: /home/person/notes.txt. If you choose Allow, this website can keep reading it, even after Hronaut restarts. '
        + "Hronaut doesn't remember this choice. If you choose Deny, this page can't ask for this again until it reloads."
    )
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
      setPermissionRequestHandler: () => undefined,
      on: () => undefined
    } as unknown as Session
    harness.browserSession.configureBrowserSession(otherSession, '01912345-678a-7abc-8def-0123456789ab')
    expect(file(other, 'writable')).toBe(false)
    const home = { check: undefined as CheckHandler | undefined }
    harness.browserSession.configureBrowserSession({
      setDownloadPath: () => undefined,
      setPermissionCheckHandler: (next: CheckHandler) => { home.check = next },
      setPermissionRequestHandler: () => undefined,
      on: () => undefined
    } as unknown as Session)
    expect(file(home, 'readable')).toBe(false)
  })
})

describe('a single file a website holds', () => {
  const folders: string[] = []
  afterEach(async () => {
    await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
  })
  async function folder(): Promise<string> {
    const created = await mkdtemp(join(tmpdir(), 'hronaut-save-dialog-'))
    folders.push(created)
    return created
  }
  const file = (handlers: { check?: CheckHandler }, filePath: string, origin = `${site.origin}/`, isDirectory = false) =>
    handlers.check!(null, 'fileSystem' as never, origin, { filePath, isDirectory, fileAccessType: 'writable' } as never)

  // A website's Save dialog emptied the file the person picked, as Chromium does before it asks anything, and the
  // check then refused every write, so saving over a file left it empty.
  it('can be saved to once its Save dialog has just emptied it, and again after it has something in it', async () => {
    const { handlers } = createHarness()
    const picked = join(await folder(), 'drawing.svg')
    await writeFile(picked, '')
    expect(file(handlers, picked)).toBe(true)
    await writeFile(picked, '<svg/>')
    expect(file(handlers, picked)).toBe(true)
    // Only that website, in that workspace, picked it.
    expect(file(handlers, picked, 'https://ads.example/')).toBe(false)
    expect(file(createHarness().handlers, picked)).toBe(false)
  })

  it('cannot be saved to while it holds anything, was emptied long ago, or is not a file', async () => {
    const { handlers } = createHarness()
    const files = await folder()
    const notes = join(files, 'notes.txt')
    await writeFile(notes, 'First draft')
    expect(file(handlers, notes)).toBe(false)
    const old = join(files, '.hushlogin')
    await writeFile(old, '')
    const lastYear = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    await utimes(old, lastYear, lastYear)
    expect(file(handlers, old)).toBe(false)
    const inner = join(files, 'inner')
    await mkdir(inner)
    expect(file(handlers, inner)).toBe(false)
    expect(file(handlers, join(files, 'missing.txt'))).toBe(false)
    expect(file(handlers, 'drawing.svg')).toBe(false)
    // A folder the website holds is never written without the person's Allow.
    expect(file(handlers, inner, `${site.origin}/`, true)).toBe(false)
  })

  // A file the website held was taken for one its Save dialog gave it once it was empty for a moment, such as while
  // another program saved it in place, and the website could then keep writing over what the person wrote there.
  // So a file the website read, which you then pick in its Save dialog, is saved to once, and you pick it again or turn
  // on the switch for the next save.
  it('the website read or asked to write before it was emptied can be saved to only while it is empty', async () => {
    const { handlers } = createHarness()
    const files = await folder()
    const opened = join(files, 'notes.txt')
    await writeFile(opened, 'First draft')
    expect(file(handlers, opened)).toBe(false)
    const read = join(files, 'todo.txt')
    await writeFile(read, 'Buy milk')
    expect(handlers.check!(null, 'fileSystem' as never, `${site.origin}/`, { filePath: read, isDirectory: false, fileAccessType: 'readable' } as never)).toBe(true)

    for (const held of [opened, read]) {
      await truncate(held, 0)
      // Replacing an empty file loses nothing.
      expect(file(handlers, held)).toBe(true)
      await writeFile(held, 'Second draft, saved in another app')
      expect(file(handlers, held)).toBe(false)
    }
  })

  it('its Save dialog emptied but the website did not save to is not taken for that file once it changed', async () => {
    const { handlers } = createHarness()
    const picked = join(await folder(), 'report.txt')
    await writeFile(picked, '')
    const halfAMinuteAgo = new Date(Date.now() - 30_000)
    await utimes(picked, halfAMinuteAgo, halfAMinuteAgo)
    // The website reads the file its Save dialog emptied and saves nothing; you write there in another app.
    expect(handlers.check!(null, 'fileSystem' as never, `${site.origin}/`, { filePath: picked, isDirectory: false, fileAccessType: 'readable' } as never)).toBe(true)
    await writeFile(picked, 'Figures')
    expect(file(handlers, picked)).toBe(false)

    await truncate(picked, 0)
    expect(file(handlers, picked)).toBe(true)
    await writeFile(picked, 'Figures, saved in another app')
    expect(file(handlers, picked)).toBe(false)
  })

  it('beyond the files Hronaut remembers a website using is never taken for one its Save dialog gave it', async () => {
    const { handlers } = createHarness()
    const files = await folder()
    for (let index = 0; index < 10_000; index += 1) file(handlers, join(files, `missing-${index}.txt`))
    const picked = join(files, 'drawing.svg')
    await writeFile(picked, '')
    expect(file(handlers, picked)).toBe(true)
    await writeFile(picked, '<svg/>')
    expect(file(handlers, picked)).toBe(false)
  })

  it('can be saved to with the person\'s switch on, whatever it holds, but a folder still needs an Allow', async () => {
    let switchOn = true
    const { handlers } = createHarness([], () => switchOn)
    const files = await folder()
    const notes = join(files, 'notes.txt')
    await writeFile(notes, 'First draft')
    expect(file(handlers, notes)).toBe(true)
    expect(file(handlers, files, `${site.origin}/`, true)).toBe(false)
    switchOn = false
    expect(file(handlers, notes)).toBe(false)
  })
})

it('never admits a link to another app from a check, even after the person allowed one', async () => {
  const { handlers, workspaceSession } = createHarness(['allow'])
  const page = createPage(workspaceSession)
  expect(await ask(handlers, page, 'openExternal', { externalURL: 'zoommtg://zoom.us/join' })).toBe(true)
  expect(handlers.check!(page.contents as never, 'openExternal' as never, site.origin, fromSite as never)).toBe(false)
})
