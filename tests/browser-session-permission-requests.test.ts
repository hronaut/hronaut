import type { MessageBoxOptions, Session } from 'electron'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { translate } from '../src/shared/i18n.js'
import { SUPPORTED_LOCALES, type SupportedLocale } from '../src/shared/locale.js'

vi.mock('electron', () => ({ app: { getPath: () => '' }, session: { fromPartition: vi.fn() } }))

const { createBrowserSession } = await import('../src/main/browser-session.js')
const { SitePermissionStore } = await import('../src/main/site-permission-store.js')

type RequestHandler = Parameters<Session['setPermissionRequestHandler']>[0] & {}
type CheckHandler = Parameters<Session['setPermissionCheckHandler']>[0] & {}
type Answer = 'allow' | 'deny'

interface FakeFrame {
  frameTreeNodeId: number
  processId: number
  routingId: number
  url: string
  origin: string
  detached: boolean
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

/** One profile's permission handlers with a real site permission store, answering each prompt with `decide`. */
async function createHarness(locale: SupportedLocale = 'en-US') {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-permission-requests-test-'))
  temporaryDirectories.push(directory)
  const store = new SitePermissionStore(join(directory, 'site-permissions.json'))
  await store.load()
  const shown: MessageBoxOptions[] = []
  const harness = {
    store,
    shown,
    decide: (_options: MessageBoxOptions): Answer | Promise<Answer> => 'deny',
    request: undefined as RequestHandler | undefined,
    check: undefined as CheckHandler | undefined
  }
  const browserSession = createBrowserSession({
    text: (key, parameters) => translate(locale, key, parameters),
    effectiveDownloadDirectory: () => '',
    showMessageBox: async (options) => {
      shown.push(options)
      return { response: await harness.decide(options) === 'allow' ? 1 : 0, checkboxChecked: false }
    },
    state: { persistentSession: null, sitePermissionStore: store },
    sendToShellWindows: () => undefined,
    partition: 'persist:test'
  })
  browserSession.configureBrowserSession({
    setDownloadPath: () => undefined,
    setPermissionCheckHandler: (next: CheckHandler) => { harness.check = next },
    setPermissionRequestHandler: (next: RequestHandler) => { harness.request = next }
  } as unknown as Session)
  return harness
}

/** A page whose main frame and child frames show the given addresses, each running as the given origin. */
function createPage(main: { url: string, origin: string }, children: Array<{ url: string, origin: string }> = []) {
  const frame = (index: number, document: { url: string, origin: string }): FakeFrame => ({
    frameTreeNodeId: index + 1, processId: 7, routingId: index + 100, ...document, detached: false
  })
  const mainFrame = frame(0, main)
  const frames = [mainFrame, ...children.map((child, index) => frame(index + 1, child))]
  const contents = Object.assign(new EventEmitter(), {
    destroyed: false,
    isDestroyed: () => contents.destroyed,
    getURL: () => mainFrame.url,
    mainFrame: Object.assign(mainFrame, { framesInSubtree: frames })
  })
  return {
    contents,
    frames,
    /** Loads another document into a frame, as Electron reports it once the navigation commits. */
    navigate(target: FakeFrame, url: string, origin = target.origin): void {
      target.url = url
      target.origin = origin
      contents.emit('did-frame-navigate', {}, url, 200, 'OK', target === mainFrame, target.processId, target.routingId)
    }
  }
}

function ask(
  harness: { request?: RequestHandler },
  page: { contents: unknown },
  permission: string,
  details: Record<string, unknown>
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    harness.request!(page.contents as never, permission as never, resolve, details as never)
  })
}

const meet = { url: 'https://meet.example/join', origin: 'https://meet.example' }
const fromMeet = { requestingUrl: meet.url, isMainFrame: true }

describe('links that open another app', () => {
  it('names the link scheme, never the whole link, and asks again for every link', async () => {
    // The prompt used to read "https://meet.example requests “openExternal” permission." without naming the app, and
    // one Allow was saved for the site, so every later scheme, such as ms-msdt:, opened with no prompt.
    const harness = await createHarness()
    harness.decide = () => 'allow'
    const page = createPage(meet)
    expect(await ask(harness, page, 'openExternal', { ...fromMeet, externalURL: 'zoommtg://zoom.us/join?confno=1&pwd=secret' })).toBe(true)
    expect(harness.shown[0]).toMatchObject({
      message: 'https://meet.example requests “External apps” permission.',
      detail: 'Allow opens this zoommtg: link outside Hronaut, in the app your system uses for it. Hronaut will ask again next time.'
    })
    expect(`${harness.shown[0]!.message} ${harness.shown[0]!.detail}`).not.toMatch(/zoom\.us|confno|secret/)

    expect(await ask(harness, page, 'openExternal', { ...fromMeet, externalURL: 'ms-msdt:/id PCWDiagnostic /skip force' })).toBe(true)
    expect(harness.shown).toHaveLength(2)
    expect(harness.shown[1]!.detail).toContain('ms-msdt:')
    expect(harness.store.list()).toEqual([])
  })

  it('does not use an external app decision an earlier version saved for the site', async () => {
    const harness = await createHarness()
    await harness.store.set(meet.origin, 'openExternal', 'allow')
    expect(await ask(harness, createPage(meet), 'openExternal', { ...fromMeet, externalURL: 'vscode://file/home' })).toBe(false)
    expect(harness.shown).toHaveLength(1)
    expect(harness.check!(createPage(meet).contents as never, 'openExternal' as never, meet.origin, fromMeet as never)).toBe(false)
  })

  it('refuses without asking when the link is missing or cannot be read', async () => {
    const harness = await createHarness()
    harness.decide = () => 'allow'
    const page = createPage(meet)
    expect(await ask(harness, page, 'openExternal', fromMeet)).toBe(false)
    expect(await ask(harness, page, 'openExternal', { ...fromMeet, externalURL: '' })).toBe(false)
    expect(await ask(harness, page, 'openExternal', { ...fromMeet, externalURL: 'not a link' })).toBe(false)
    expect(harness.shown).toEqual([])
  })

  it('names the permission and the scheme in every interface language', async () => {
    for (const locale of SUPPORTED_LOCALES) {
      const harness = await createHarness(locale)
      await ask(harness, createPage(meet), 'openExternal', { ...fromMeet, externalURL: 'zoommtg://zoom.us/join' })
      const [prompt] = harness.shown
      expect(prompt!.message, locale).toContain(translate(locale, 'runtime.permissions.externalApps'))
      expect(prompt!.message, locale).not.toContain('openExternal')
      expect(prompt!.detail, locale).toContain('zoommtg:')
    }
  })
})

describe('camera and microphone prompts', () => {
  const site = { url: 'https://call.example/room', origin: 'https://call.example' }
  const camera = { requestingUrl: site.url, isMainFrame: true, mediaTypes: ['video'] }

  it('shows one prompt for identical requests and refuses repeats after Deny until the page loads again', async () => {
    // A page that called getUserMedia 25 times at once got 25 window-modal prompts in a row, and one that asked again
    // after each refusal got a new prompt every time.
    const harness = await createHarness()
    const page = createPage(site)
    const answers = await Promise.all(Array.from({ length: 25 }, () => ask(harness, page, 'media', camera)))
    expect(answers.every((allowed) => !allowed)).toBe(true)
    expect(harness.shown).toHaveLength(1)

    expect(await ask(harness, page, 'media', camera)).toBe(false)
    expect(harness.shown).toHaveLength(1)
    // A request for other devices is a different question.
    await ask(harness, page, 'media', { ...camera, mediaTypes: ['audio'] })
    expect(harness.shown).toHaveLength(2)

    page.navigate(page.frames[0]!, site.url)
    harness.decide = () => 'allow'
    expect(await ask(harness, page, 'media', camera)).toBe(true)
    expect(harness.shown).toHaveLength(3)
    expect([page.contents.listenerCount('did-frame-navigate'), page.contents.listenerCount('destroyed')]).toEqual([1, 1])
  })

  it('asks again after Allow and keeps a frame’s Deny to that frame’s document', async () => {
    const harness = await createHarness()
    const widget = { url: 'https://call.example/widget', origin: 'https://call.example' }
    const page = createPage(site, [widget])
    const fromWidget = { requestingUrl: widget.url, isMainFrame: false, mediaTypes: ['video'] }
    harness.decide = () => 'allow'
    expect(await Promise.all([ask(harness, page, 'media', camera), ask(harness, page, 'media', camera)])).toEqual([true, true])
    expect(harness.shown).toHaveLength(1)
    expect(await ask(harness, page, 'media', camera)).toBe(true)
    expect(harness.shown).toHaveLength(2)

    harness.decide = () => 'deny'
    expect(await ask(harness, page, 'media', fromWidget)).toBe(false)
    expect(await ask(harness, page, 'media', fromWidget)).toBe(false)
    expect(harness.shown).toHaveLength(3)
    // The main frame's own request is not the frame's.
    await ask(harness, page, 'media', camera)
    expect(harness.shown).toHaveLength(4)
    expect(await ask(harness, page, 'media', camera)).toBe(false)
    expect(harness.shown).toHaveLength(4)

    page.navigate(page.frames[1]!, 'https://call.example/widget?retry')
    await ask(harness, page, 'media', { ...fromWidget, requestingUrl: 'https://call.example/widget?retry' })
    expect(harness.shown).toHaveLength(5)
    expect(await ask(harness, page, 'media', camera)).toBe(false)
    expect(harness.shown).toHaveLength(5)
  })

  it('does not share a prompt with the next document its frame loads', async () => {
    const harness = await createHarness()
    const page = createPage(site)
    let answerFirst: (answer: Answer) => void = () => undefined
    harness.decide = () => new Promise<Answer>((resolve) => { answerFirst = resolve })
    const first = ask(harness, page, 'media', camera)
    await vi.waitFor(() => expect(harness.shown).toHaveLength(1))

    page.navigate(page.frames[0]!, site.url)
    const second = ask(harness, page, 'media', camera)
    answerFirst('deny')
    expect(await first).toBe(false)
    await vi.waitFor(() => expect(harness.shown).toHaveLength(2))
    answerFirst('allow')
    expect(await second).toBe(true)
  })
})

describe('frames that run as their page’s origin', () => {
  const inbox = { url: 'https://app.example/inbox', origin: 'https://app.example' }

  it('gives about:blank, about:srcdoc and blob: documents the decision their site has', async () => {
    // The check said "granted" for these documents, which run as https://app.example, while their request was
    // refused without a prompt because their address is not an HTTP or HTTPS one.
    const harness = await createHarness()
    harness.decide = () => 'allow'
    await harness.store.set(inbox.origin, 'notifications', 'allow')
    for (const url of ['about:blank', 'about:srcdoc', 'blob:https://app.example/6a1f']) {
      const page = createPage(inbox, [{ url, origin: inbox.origin }])
      const details = { requestingUrl: url, isMainFrame: false }
      expect(harness.check!(page.contents as never, 'notifications', 'https://app.example/', details as never), url).toBe(true)
      expect(await ask(harness, page, 'notifications', details), url).toBe(true)
    }
    expect(harness.shown).toEqual([])

    const page = createPage(inbox, [{ url: 'about:srcdoc', origin: inbox.origin }])
    expect(await ask(harness, page, 'geolocation', { requestingUrl: 'about:srcdoc', isMainFrame: false })).toBe(true)
    expect(harness.shown[0]!.message).toBe('https://app.example requests “Location” permission.')
    expect(harness.store.list()).toContainEqual({ origin: inbox.origin, permission: 'geolocation', decision: 'allow' })
  })

  it('uses a remembered decision when several frames show the same address as one origin', async () => {
    const harness = await createHarness()
    await harness.store.set(inbox.origin, 'notifications', 'allow')
    const page = createPage(inbox, [{ url: 'about:blank', origin: inbox.origin }, { url: 'about:blank', origin: inbox.origin }])
    expect(await ask(harness, page, 'notifications', { requestingUrl: 'about:blank', isMainFrame: false })).toBe(true)
    const mixed = createPage(inbox, [{ url: 'about:blank', origin: inbox.origin }, { url: 'about:blank', origin: 'https://ads.example' }])
    expect(await ask(harness, mixed, 'notifications', { requestingUrl: 'about:blank', isMainFrame: false })).toBe(false)
  })

  it('never grants a sandboxed document that runs as the opaque origin', async () => {
    const harness = await createHarness()
    harness.decide = () => 'allow'
    await harness.store.set(inbox.origin, 'notifications', 'allow')
    for (const url of ['about:srcdoc', 'https://app.example/sandboxed', 'blob:null/6a1f']) {
      const page = createPage(inbox, [{ url, origin: 'null' }])
      const details = { requestingUrl: url, isMainFrame: false }
      expect(harness.check!(page.contents as never, 'notifications', '', details as never), url).toBe(false)
      expect(await ask(harness, page, 'notifications', details), url).toBe(false)
    }
    expect(harness.shown).toEqual([])
  })

  it('does not keep an Allow after the frame went to about:blank, which still runs as its origin', async () => {
    const harness = await createHarness()
    const child = { url: 'https://app.example/child', origin: inbox.origin }
    const page = createPage(inbox, [child])
    let answer: (value: Answer) => void = () => undefined
    harness.decide = () => new Promise<Answer>((resolve) => { answer = resolve })
    const pending = ask(harness, page, 'geolocation', { requestingUrl: child.url, isMainFrame: false })
    await vi.waitFor(() => expect(harness.shown).toHaveLength(1))
    page.navigate(page.frames[1]!, 'about:blank')
    answer('allow')
    expect(await pending).toBe(false)
    expect(harness.store.list()).toEqual([])
  })
})
