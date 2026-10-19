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
const { registerPermissionsIpc } = await import('../src/main/permissions-ipc.js')
const { registerBrowsingDataIpc } = await import('../src/main/browsing-data-ipc.js')

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
  const sent: unknown[][] = []
  const harness = {
    store,
    shown,
    sent,
    decide: (_options: MessageBoxOptions): Answer | Promise<Answer> => 'deny',
    request: undefined as RequestHandler | undefined,
    check: undefined as CheckHandler | undefined,
    publishSitePermissions: (): void => undefined
  }
  const browserSession = createBrowserSession({
    text: (key, parameters) => translate(locale, key, parameters),
    effectiveDownloadDirectory: () => '',
    showMessageBox: async (options) => {
      shown.push(options)
      return { response: await harness.decide(options) === 'allow' ? 1 : 0, checkboxChecked: false }
    },
    state: { persistentSession: null, sitePermissionStore: store },
    sendToShellWindows: (...args) => { sent.push(args) },
    partition: 'persist:test'
  })
  browserSession.configureBrowserSession({
    setDownloadPath: () => undefined,
    setPermissionCheckHandler: (next: CheckHandler) => { harness.check = next },
    setPermissionRequestHandler: (next: RequestHandler) => { harness.request = next }
  } as unknown as Session)
  harness.publishSitePermissions = browserSession.publishSitePermissions
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
    },
    /** Adds a child frame that already shows a document. */
    addFrame(document: { url: string, origin: string }): FakeFrame {
      const added = frame(frames.length + 10, document)
      frames.push(added)
      return added
    },
    /** Closes the page, as Electron does when its tab closes. */
    destroy(): void {
      contents.destroyed = true
      contents.emit('destroyed')
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

/** Answers each prompt only when the test says so, in the order the prompts showed. */
function answerLater(harness: { decide: (options: MessageBoxOptions) => Answer | Promise<Answer> }): Array<(answer: Answer) => void> {
  const answers: Array<(answer: Answer) => void> = []
  harness.decide = () => new Promise<Answer>((resolve) => { answers.push(resolve) })
  return answers
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
      detail: 'Allow opens this zoommtg: link outside Hronaut, in the app your system uses for it. '
        + "Hronaut doesn't remember this choice. If you choose Deny, this page can't ask for this again until it reloads."
    })
    expect(`${harness.shown[0]!.message} ${harness.shown[0]!.detail}`).not.toMatch(/zoom\.us|confno|secret/)

    expect(await ask(harness, page, 'openExternal', { ...fromMeet, externalURL: 'ms-msdt:/id PCWDiagnostic /skip force' })).toBe(true)
    expect(harness.shown).toHaveLength(2)
    expect(harness.shown[1]!.detail).toContain('ms-msdt:')
    expect(harness.store.list()).toEqual([])
  })

  it('asks for each different link on its own, and a Deny refuses that scheme’s waiting links without asking', async () => {
    // Different links with one scheme that arrived while a prompt waited or showed shared it, and one Allow opened
    // every one of them, because Electron opens the link each answer belongs to.
    const harness = await createHarness()
    const answers = answerLater(harness)
    const page = createPage(meet)
    const open = (url: string): Promise<boolean> => ask(harness, page, 'openExternal', { ...fromMeet, externalURL: url })
    const clone = open('vscode://vscode.git/clone?url=https://good.example/repo')
    await vi.waitFor(() => expect(harness.shown).toHaveLength(1))
    const sameClone = open('vscode://vscode.git/clone?url=https://good.example/repo')
    const otherClone = open('vscode://vscode.git/clone?url=https://evil.example/repo')
    const file = open('vscode://file/etc/passwd')
    answers[0]!('allow')
    expect(await clone).toBe(true)
    expect(await sameClone).toBe(true)

    await vi.waitFor(() => expect(harness.shown).toHaveLength(2))
    answers[1]!('deny')
    expect(await otherClone).toBe(false)
    expect(await file).toBe(false)
    expect(await open('vscode://file/home')).toBe(false)
    expect(harness.shown).toHaveLength(2)

    // Another app's links still ask.
    const zoom = open('zoommtg://zoom.us/join')
    await vi.waitFor(() => expect(harness.shown).toHaveLength(3))
    answers[2]!('allow')
    expect(await zoom).toBe(true)
  })

  it('cuts a very long scheme short in the prompt', async () => {
    const harness = await createHarness()
    await ask(harness, createPage(meet), 'openExternal', { ...fromMeet, externalURL: `${'x'.repeat(300)}:payload` })
    const detail = String(harness.shown[0]!.detail)
    expect(detail).toContain(`this ${'x'.repeat(63)}… link`)
    expect(detail).not.toContain('x'.repeat(64))
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

describe('saved decisions Hronaut never uses', () => {
  it('keeps them out of Settings, Site controls and the browsing data counts', async () => {
    // A camera, file or external app decision an earlier version saved stays in the file but has no effect, while
    // Settings → Site permissions listed it as "External apps · Allow".
    const harness = await createHarness()
    await harness.store.set(meet.origin, 'fileSystem', 'allow')
    await harness.store.set(meet.origin, 'geolocation', 'allow')
    await harness.store.set(meet.origin, 'media', 'deny')
    await harness.store.set(meet.origin, 'openExternal', 'allow')
    const shownDecisions = [{ origin: meet.origin, permission: 'geolocation', decision: 'allow' }]

    harness.publishSitePermissions()
    expect(harness.sent).toEqual([['permissions:changed', shownDecisions]])

    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const handle = (channel: string, listener: (...args: unknown[]) => unknown): void => { handlers.set(channel, listener) }
    registerPermissionsIpc({ handle } as never, {
      assertTrustedSender: () => undefined,
      sitePermissionStore: () => harness.store,
      publishSitePermissions: harness.publishSitePermissions
    })
    expect(await handlers.get('permissions:list')!({})).toEqual(shownDecisions)

    registerBrowsingDataIpc({
      assertTrustedSender: () => undefined,
      handleBrowserIpc: handle as never,
      tabs: () => null,
      historyStore: () => null,
      bookmarkStore: () => null,
      credentialStore: () => null,
      sitePermissionStore: () => harness.store,
      mcpServer: () => null,
      publishVisitHistory: () => undefined,
      currentBrowsingDataSiteSummary: async () => { throw new Error('Not used') }
    })
    expect(await handlers.get('browsing-data:summary')!({})).toMatchObject({ permissionDecisionCount: 1 })
    expect(await handlers.get('browsing-data:websites')!({})).toEqual([
      expect.objectContaining({ origin: meet.origin, permissionDecisionCount: 1 })
    ])
    // The file keeps them, so resetting the section still clears them.
    expect(harness.store.list()).toHaveLength(4)
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

  it('refuses the site’s frames that ask at once after one Deny without asking each', async () => {
    // Every frame's document was its own question, so 25 same-origin frames asking at once showed 25 prompts.
    const harness = await createHarness()
    const frames = Array.from({ length: 25 }, (_, index) => ({ url: `about:blank#${index}`, origin: site.origin }))
    const page = createPage(site, frames)
    const fromFrame = (url: string) => ({ requestingUrl: url, isMainFrame: false, mediaTypes: ['video'] })
    const answers = await Promise.all(frames.map((frame) => ask(harness, page, 'media', fromFrame(frame.url))))
    expect(answers.every((allowed) => !allowed)).toBe(true)
    expect(harness.shown).toHaveLength(1)
    expect(await Promise.all(frames.map((frame) => ask(harness, page, 'media', fromFrame(frame.url))))).not.toContain(true)
    expect(harness.shown).toHaveLength(1)
  })

  it('asks again after Allow, and holds a Deny for the page’s frames of that site until the main frame loads again', async () => {
    // The Deny held only for one frame's document, so a frame that loaded again, or a new frame, asked after every
    // refusal.
    const harness = await createHarness()
    const widget = { url: 'https://call.example/widget', origin: site.origin }
    const ads = { url: 'https://ads.example/slot', origin: 'https://ads.example' }
    const page = createPage(site, [widget, ads])
    const fromWidget = { requestingUrl: widget.url, isMainFrame: false, mediaTypes: ['video'] }
    harness.decide = () => 'allow'
    expect(await Promise.all([ask(harness, page, 'media', camera), ask(harness, page, 'media', camera)])).toEqual([true, true])
    expect(harness.shown).toHaveLength(1)
    expect(await ask(harness, page, 'media', camera)).toBe(true)
    expect(harness.shown).toHaveLength(2)

    harness.decide = () => 'deny'
    // Another website's Deny is not this site's.
    expect(await ask(harness, page, 'media', { ...fromWidget, requestingUrl: ads.url })).toBe(false)
    expect(harness.shown).toHaveLength(3)
    expect(await ask(harness, page, 'media', fromWidget)).toBe(false)
    expect(harness.shown).toHaveLength(4)
    page.navigate(page.frames[1]!, 'https://call.example/widget?retry')
    expect(await ask(harness, page, 'media', { ...fromWidget, requestingUrl: 'https://call.example/widget?retry' })).toBe(false)
    const fresh = page.addFrame({ url: 'https://call.example/fresh', origin: site.origin })
    expect(await ask(harness, page, 'media', { ...fromWidget, requestingUrl: fresh.url })).toBe(false)
    expect(await ask(harness, page, 'media', camera)).toBe(false)
    expect(harness.shown).toHaveLength(4)

    // Electron also reports the main frame of a page that is not the one shown; it does not lift the Deny.
    page.contents.emit('did-frame-navigate', {}, 'https://call.example/next', 200, 'OK', true, 99, 999)
    expect(await ask(harness, page, 'media', camera)).toBe(false)
    expect(harness.shown).toHaveLength(4)

    page.navigate(page.frames[0]!, site.url)
    harness.decide = () => 'allow'
    expect(await ask(harness, page, 'media', camera)).toBe(true)
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

  it('refuses a request whose page closed while its prompt showed', async () => {
    const harness = await createHarness()
    const answers = answerLater(harness)
    const page = createPage(site)
    const pending = ask(harness, page, 'media', camera)
    await vi.waitFor(() => expect(harness.shown).toHaveLength(1))
    page.destroy()
    answers[0]!('allow')
    expect(await pending).toBe(false)
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

  it('refuses a request that names no requesting address instead of asking as the main frame', async () => {
    // Electron gives an empty address for a requester that runs as an opaque origin, such as a sandboxed frame that
    // opens a link in another app. Hronaut used the main frame's address instead and asked as https://app.example.
    const harness = await createHarness()
    harness.decide = () => 'allow'
    await harness.store.set(inbox.origin, 'notifications', 'allow')
    const page = createPage(inbox, [{ url: 'https://app.example/sandboxed', origin: 'null' }])
    for (const isMainFrame of [true, false]) {
      expect(await ask(harness, page, 'openExternal', { requestingUrl: '', isMainFrame, externalURL: 'zoommtg://zoom.us/join' })).toBe(false)
      expect(await ask(harness, page, 'notifications', { requestingUrl: '', isMainFrame })).toBe(false)
      expect(await ask(harness, page, 'media', { isMainFrame, mediaTypes: ['video'] })).toBe(false)
    }
    expect(harness.shown).toEqual([])
  })

  it('refuses a blob: document made by another origin than the one its frame runs as', async () => {
    const harness = await createHarness()
    harness.decide = () => 'allow'
    await harness.store.set(inbox.origin, 'notifications', 'allow')
    const url = 'blob:https://evil.example/6a1f'
    const page = createPage(inbox, [{ url, origin: inbox.origin }])
    const details = { requestingUrl: url, isMainFrame: false }
    expect(harness.check!(page.contents as never, 'notifications', 'https://app.example/', details as never)).toBe(false)
    expect(await ask(harness, page, 'notifications', details)).toBe(false)
    expect(harness.shown).toEqual([])
  })

  it('refuses an about:blank frame inside Home', async () => {
    const harness = await createHarness()
    harness.decide = () => 'allow'
    const page = createPage({ url: 'hronaut://home/', origin: 'hronaut://home' }, [{ url: 'about:blank', origin: 'hronaut://home' }])
    const details = { requestingUrl: 'about:blank', isMainFrame: false }
    expect(harness.check!(page.contents as never, 'notifications', 'hronaut://home', details as never)).toBe(false)
    expect(await ask(harness, page, 'geolocation', details)).toBe(false)
    expect(await ask(harness, page, 'media', { ...details, mediaTypes: ['video'] })).toBe(false)
    expect(harness.shown).toEqual([])
  })

  it('admits a check from a cross-origin frame or a worker for what its own origin was allowed', async () => {
    const harness = await createHarness()
    await harness.store.set('https://maps.example', 'geolocation', 'allow')
    const page = createPage(inbox, [{ url: 'https://maps.example/embed', origin: 'https://maps.example' }])
    const check = (origin: string, details: Record<string, unknown>): boolean => (
      harness.check!(page.contents as never, 'geolocation', origin, details as never)
    )
    expect(check('https://maps.example/', { requestingUrl: 'https://maps.example/embed', isMainFrame: false })).toBe(true)
    expect(check('https://app.example/', { requestingUrl: inbox.url, isMainFrame: true })).toBe(false)
    // A worker has no frame, so Electron gives only its origin.
    expect(check('https://maps.example/', { isMainFrame: false })).toBe(true)
    expect(check('https://app.example/', { isMainFrame: false })).toBe(false)
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
