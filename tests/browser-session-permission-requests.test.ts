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

/** The workspace the harness's pages belong to, and another one with its own browser session. */
const WORK = '01912345-6789-7abc-8def-0123456789ab'
const CLIENT = '01912345-678a-7abc-8def-0123456789ab'

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

/**
 * One profile's permission handlers with a real site permission store, answering each prompt with `decide`. Its pages
 * run in the session of the workspace WORK; `workspaceSession` gives another workspace's session, or one no workspace
 * claimed, such as Home's.
 */
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
    publishSitePermissions: (): void => undefined,
    workspaces: [] as Array<{ id: string, name: string }>
  }
  const browserSession = createBrowserSession({
    text: (key, parameters) => translate(locale, key, parameters),
    effectiveDownloadDirectory: () => '',
    showMessageBox: async (options) => {
      shown.push(options)
      // Electron closes the box as if it were cancelled once its signal aborts.
      const closed = new Promise<Answer>((resolve) => { options.signal?.addEventListener('abort', () => resolve('deny')) })
      return { response: await Promise.race([harness.decide(options), closed]) === 'allow' ? 1 : 0, checkboxChecked: false }
    },
    workspaces: () => harness.workspaces,
    state: { persistentSession: null, sitePermissionStore: store },
    sendToShellWindows: (...args) => { sent.push(args) },
    partition: 'persist:test'
  })
  const workspaceSession = (workspaceId?: string) => {
    const handlers = { request: undefined as RequestHandler | undefined, check: undefined as CheckHandler | undefined }
    const fakeSession = {
      setDownloadPath: () => undefined,
      setPermissionCheckHandler: (next: CheckHandler) => { handlers.check = next },
      setPermissionRequestHandler: (next: RequestHandler) => { handlers.request = next }
    } as unknown as Session
    browserSession.configureBrowserSession(fakeSession, workspaceId)
    return Object.assign(handlers, { session: fakeSession })
  }
  const work = workspaceSession(WORK)
  harness.request = work.request
  harness.check = work.check
  harness.publishSitePermissions = browserSession.publishSitePermissions
  return Object.assign(harness, {
    workspaceSession,
    configureBrowserSession: browserSession.configureBrowserSession,
    forgetWorkspaceSitePermissions: browserSession.forgetWorkspaceSitePermissions,
    forgetRemovedWorkspacesSitePermissions: browserSession.forgetRemovedWorkspacesSitePermissions
  })
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
    /** Shows an error page in a frame, which Electron reports only as a failed load, with an opaque origin. */
    failLoad(target: FakeFrame): void {
      target.origin = 'null'
      contents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', target.url, target === mainFrame, target.processId, target.routingId)
    },
    /** Removes a child frame from the page, which Electron does not report. */
    removeFrame(target: FakeFrame): void {
      target.detached = true
      frames.splice(frames.indexOf(target), 1)
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

  it('closes a prompt once its frame loads another document, so the prompts after it show', async () => {
    // The prompt stayed open after the page that asked had moved on, and every prompt after it, from any tab and from
    // the same page asking again, waited for someone to answer a question whose answer no longer counted.
    const harness = await createHarness()
    const answers = answerLater(harness)
    const page = createPage(site)
    const other = createPage(meet)
    const stale = ask(harness, page, 'media', camera)
    await vi.waitFor(() => expect(harness.shown).toHaveLength(1))
    const fromOtherTab = ask(harness, other, 'geolocation', fromMeet)

    page.navigate(page.frames[0]!, 'https://call.example/lobby')
    expect(await stale).toBe(false)
    expect(harness.shown[0]!.signal?.aborted).toBe(true)
    await vi.waitFor(() => expect(harness.shown).toHaveLength(2))
    expect(harness.shown[1]!.message).toContain(meet.origin)
    expect(harness.shown[1]!.signal?.aborted).toBe(false)
    expect(harness.store.list()).toEqual([])
    expect([page.contents.listenerCount('did-frame-navigate'), page.contents.listenerCount('destroyed')]).toEqual([1, 1])

    // The closed prompt was no Deny: the page's next document is asked, once the other tab's prompt is answered.
    answers[1]!('deny')
    expect(await fromOtherTab).toBe(false)
    harness.decide = () => 'allow'
    expect(await ask(harness, page, 'media', { ...camera, requestingUrl: 'https://call.example/lobby' })).toBe(true)
    expect(harness.shown).toHaveLength(3)
  })

  it('closes a prompt once its tab closes, so the prompts after it show', async () => {
    const harness = await createHarness()
    const answers = answerLater(harness)
    const page = createPage(site)
    const other = createPage(meet)
    const closed = ask(harness, page, 'media', camera)
    await vi.waitFor(() => expect(harness.shown).toHaveLength(1))
    const fromOtherTab = ask(harness, other, 'geolocation', fromMeet)

    page.destroy()
    expect(await closed).toBe(false)
    expect(harness.shown[0]!.signal?.aborted).toBe(true)
    await vi.waitFor(() => expect(harness.shown).toHaveLength(2))
    answers[1]!('allow')
    expect(await fromOtherTab).toBe(true)
    expect(harness.store.list()).toEqual([
      expect.objectContaining({ origin: meet.origin, permission: 'geolocation', decision: 'allow' })
    ])
  })

  it('closes a prompt once its page shows an error page, or the frame that asked is removed', async () => {
    // Electron reports an error page only as a failed load and a removed frame not at all, so a reload that failed or a
    // widget the page took away left its prompt open in front of every other prompt.
    const harness = await createHarness()
    answerLater(harness)
    const page = createPage(site)
    const reloaded = ask(harness, page, 'media', camera)
    await vi.waitFor(() => expect(harness.shown).toHaveLength(1))
    page.failLoad(page.frames[0]!)
    expect(await reloaded).toBe(false)
    expect(harness.shown[0]!.signal?.aborted).toBe(true)

    const widget = { url: 'https://widget.example/call', origin: 'https://widget.example' }
    const host = createPage(meet, [widget])
    const removed = ask(harness, host, 'media', { requestingUrl: widget.url, isMainFrame: false, mediaTypes: ['video'] })
    await vi.waitFor(() => expect(harness.shown).toHaveLength(2))
    host.removeFrame(host.frames[1]!)
    expect(await removed).toBe(false)
    expect(harness.shown[1]!.signal?.aborted).toBe(true)
    expect(harness.store.list()).toEqual([])
    expect([host.contents.listenerCount('did-frame-navigate'), host.contents.listenerCount('did-fail-load')]).toEqual([1, 0])
  })

  it('holds no Deny for a prompt that closed, and refuses the identical requests that waited for it', async () => {
    // Only a person's Deny holds for the page; a prompt that closed because its frame moved on answered nothing.
    const harness = await createHarness()
    answerLater(harness)
    const widget = { url: 'https://widget.example/call', origin: 'https://widget.example' }
    const page = createPage(meet, [widget])
    const fromWidget = { requestingUrl: widget.url, isMainFrame: false, mediaTypes: ['video'] }
    const [first, second] = [ask(harness, page, 'media', fromWidget), ask(harness, page, 'media', fromWidget)]
    await vi.waitFor(() => expect(harness.shown).toHaveLength(1))
    page.navigate(page.frames[1]!, widget.url)
    expect(await Promise.all([first, second])).toEqual([false, false])
    harness.decide = () => 'allow'
    expect(await ask(harness, page, 'media', fromWidget)).toBe(true)
    expect(harness.shown).toHaveLength(2)
  })

  it('keeps a prompt open while another frame of its page loads another document', async () => {
    const harness = await createHarness()
    const answers = answerLater(harness)
    const page = createPage(site, [{ url: 'https://ads.example/slot', origin: 'https://ads.example' }])
    const pending = ask(harness, page, 'media', camera)
    await vi.waitFor(() => expect(harness.shown).toHaveLength(1))

    page.navigate(page.frames[1]!, 'https://ads.example/next')
    expect(harness.shown[0]!.signal?.aborted).toBe(false)
    answers[0]!('allow')
    expect(await pending).toBe(true)
    expect([page.contents.listenerCount('did-frame-navigate'), page.contents.listenerCount('destroyed')]).toEqual([1, 1])
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
    expect(harness.store.list()).toContainEqual({ origin: inbox.origin, permission: 'geolocation', decision: 'allow', workspaceId: WORK })
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

describe('decisions that belong to a workspace and a page', () => {
  const widget = { url: 'https://widget.example/call', origin: 'https://widget.example' }
  const firstSite = { url: 'https://first.example/room', origin: 'https://first.example' }
  const secondSite = { url: 'https://second.example/room', origin: 'https://second.example' }
  const fromWidget = { requestingUrl: widget.url, isMainFrame: false }
  const check = (handler: CheckHandler | undefined, page: { contents: unknown } | null, details: Record<string, unknown>) => (
    handler!(page ? page.contents as never : null, 'geolocation', `${widget.origin}/`, details as never)
  )

  it('names the workspace and the page a website embedded in it asks in', async () => {
    const harness = await createHarness()
    harness.workspaces = [{ id: WORK, name: 'Client A' }, { id: CLIENT, name: 'Personal' }]
    expect(await ask(harness, createPage(firstSite, [widget]), 'geolocation', fromWidget)).toBe(false)
    expect(harness.shown[0]).toMatchObject({
      message: 'https://widget.example on https://first.example requests “Location” permission.',
      detail: 'Hronaut remembers this choice for this website on https://first.example in the “Client A” workspace. '
        + 'You can change it later in Settings → Site permissions.'
    })
  })

  it('asks again for a website embedded in another page, and keeps each page’s decision', async () => {
    // An Allow given to a video-call widget on one page was saved for the widget alone, so every other page that
    // embedded it got the camera or location without asking.
    const harness = await createHarness()
    harness.decide = () => 'allow'
    const onFirst = createPage(firstSite, [widget])
    expect(await ask(harness, onFirst, 'geolocation', fromWidget)).toBe(true)
    expect(harness.shown[0]).toMatchObject({
      message: 'https://widget.example on https://first.example requests “Location” permission.',
      detail: 'Hronaut remembers this choice for this website on https://first.example in this workspace. '
        + 'You can change it later in Settings → Site permissions.'
    })
    expect(harness.store.list()).toEqual([
      { origin: widget.origin, permission: 'geolocation', decision: 'allow', workspaceId: WORK, embeddedIn: firstSite.origin }
    ])

    harness.decide = () => 'deny'
    const onSecond = createPage(secondSite, [widget])
    expect(await ask(harness, onSecond, 'geolocation', fromWidget)).toBe(false)
    expect(harness.shown).toHaveLength(2)
    expect(harness.shown[1]!.message).toBe('https://widget.example on https://second.example requests “Location” permission.')

    // Each page keeps its own answer, for requests and for checks.
    expect(await ask(harness, createPage(firstSite, [widget]), 'geolocation', fromWidget)).toBe(true)
    expect(await ask(harness, createPage(secondSite, [widget]), 'geolocation', fromWidget)).toBe(false)
    expect(harness.shown).toHaveLength(2)
    expect(check(harness.check, onFirst, fromWidget)).toBe(true)
    expect(check(harness.check, onSecond, fromWidget)).toBe(false)

    // Neither is the widget's own decision, on its own page or for its service worker.
    const own = createPage(widget)
    expect(check(harness.check, own, { requestingUrl: widget.url, isMainFrame: true })).toBe(false)
    expect(check(harness.check, null, { isMainFrame: false })).toBe(false)
    expect(await ask(harness, own, 'geolocation', { requestingUrl: widget.url, isMainFrame: true })).toBe(false)
    expect(harness.shown).toHaveLength(3)
    expect(harness.shown[2]!.message).toBe('https://widget.example requests “Location” permission.')
  })

  it('does not use a website’s own decision for it embedded in a page, and a same-site frame uses the page’s', async () => {
    const harness = await createHarness()
    await harness.store.set(widget.origin, 'geolocation', 'allow', { workspaceId: WORK })
    expect(check(harness.check, createPage(widget), { requestingUrl: widget.url, isMainFrame: true })).toBe(true)
    expect(check(harness.check, null, { isMainFrame: false })).toBe(true)
    expect(check(harness.check, createPage(widget, [{ url: 'https://widget.example/frame', origin: widget.origin }]),
      { requestingUrl: 'https://widget.example/frame', isMainFrame: false })).toBe(true)
    expect(check(harness.check, createPage(firstSite, [widget]), fromWidget)).toBe(false)
    expect(await ask(harness, createPage(firstSite, [widget]), 'geolocation', fromWidget)).toBe(false)
    expect(harness.shown).toHaveLength(1)
  })

  it('does not use a decision made in another workspace', async () => {
    // A decision made in one workspace applied in every workspace, though each keeps its own sign-ins and data.
    const harness = await createHarness()
    const client = harness.workspaceSession(CLIENT)
    harness.decide = () => 'allow'
    const site = { url: firstSite.url, isMainFrame: true }
    expect(await ask(harness, createPage(firstSite), 'geolocation', { requestingUrl: site.url, isMainFrame: true })).toBe(true)

    harness.decide = () => 'deny'
    expect(await ask(client, createPage(firstSite), 'geolocation', { requestingUrl: site.url, isMainFrame: true })).toBe(false)
    expect(harness.shown).toHaveLength(2)
    const checkIn = (handler: CheckHandler | undefined) => handler!(
      createPage(firstSite).contents as never, 'geolocation', `${firstSite.origin}/`, { requestingUrl: site.url, isMainFrame: true } as never
    )
    expect([checkIn(harness.check), checkIn(client.check)]).toEqual([true, false])
    expect(harness.store.list()).toEqual([
      { origin: firstSite.origin, permission: 'geolocation', decision: 'allow', workspaceId: WORK },
      { origin: firstSite.origin, permission: 'geolocation', decision: 'deny', workspaceId: CLIENT }
    ].sort((left, right) => left.workspaceId.localeCompare(right.workspaceId)))
  })

  it('still uses a decision saved before decisions belonged to a workspace, unless the workspace has its own', async () => {
    const harness = await createHarness()
    const client = harness.workspaceSession(CLIENT)
    await harness.store.set(widget.origin, 'geolocation', 'allow')
    const own = { requestingUrl: widget.url, isMainFrame: true }
    for (const handlers of [harness, client]) {
      expect(await ask(handlers, createPage(widget), 'geolocation', own)).toBe(true)
      expect(await ask(handlers, createPage(firstSite, [widget]), 'geolocation', fromWidget)).toBe(true)
      expect(check(handlers.check, createPage(secondSite, [widget]), fromWidget)).toBe(true)
      expect(check(handlers.check, null, { isMainFrame: false })).toBe(true)
    }
    expect(harness.shown).toEqual([])

    await harness.store.set(widget.origin, 'geolocation', 'deny', { workspaceId: CLIENT })
    expect(await ask(client, createPage(widget), 'geolocation', own)).toBe(false)
    expect(await ask(harness, createPage(widget), 'geolocation', own)).toBe(true)
    expect(harness.shown).toEqual([])
    // The client's Deny for the widget's own page, as Site controls saves it, replaces the earlier Allow in the client.
    // The widget embedded in a page there was still allowed without asking; it asks again now.
    expect(check(client.check, createPage(secondSite, [widget]), fromWidget)).toBe(false)
    expect(await ask(client, createPage(firstSite, [widget]), 'geolocation', fromWidget)).toBe(false)
    expect(harness.shown).toHaveLength(1)
    expect(harness.shown[0]!.message).toBe('https://widget.example on https://first.example requests “Location” permission.')
    expect(await ask(harness, createPage(firstSite, [widget]), 'geolocation', fromWidget)).toBe(true)
    expect(check(harness.check, createPage(secondSite, [widget]), fromWidget)).toBe(true)
    expect(harness.shown).toHaveLength(1)
  })

  it('gives no permission in a session no single workspace claims, or in a page whose website is unknown', async () => {
    const harness = await createHarness()
    harness.decide = () => 'allow'
    await harness.store.set(firstSite.origin, 'geolocation', 'allow')
    await harness.store.set(widget.origin, 'geolocation', 'allow')
    const fromSite = { requestingUrl: firstSite.url, isMainFrame: true }
    const home = harness.workspaceSession()
    expect(await ask(home, createPage(firstSite), 'geolocation', fromSite)).toBe(false)
    expect(await ask(home, createPage(firstSite), 'media', { ...fromSite, mediaTypes: ['video'] })).toBe(false)
    expect(home.check!(createPage(firstSite).contents as never, 'geolocation', firstSite.origin, fromSite as never)).toBe(false)

    const claimedTwice = harness.workspaceSession(CLIENT)
    harness.configureBrowserSession(claimedTwice.session, WORK)
    expect(await ask(claimedTwice, createPage(firstSite), 'geolocation', fromSite)).toBe(false)
    expect(claimedTwice.check!(null, 'geolocation', firstSite.origin, { isMainFrame: false } as never)).toBe(false)

    const unknownPage = createPage({ url: 'file:///home/person/page.html', origin: 'file://' }, [widget])
    expect(await ask(harness, unknownPage, 'geolocation', fromWidget)).toBe(false)
    expect(check(harness.check, unknownPage, fromWidget)).toBe(false)
    expect(harness.shown).toEqual([])
  })

  it('does not keep an answer after the page around the frame became another website', async () => {
    const harness = await createHarness()
    const answers = answerLater(harness)
    const page = createPage(firstSite, [widget])
    const pending = ask(harness, page, 'geolocation', fromWidget)
    await vi.waitFor(() => expect(harness.shown).toHaveLength(1))
    // The main frame shows another website, which Electron has not reported yet.
    Object.assign(page.frames[0]!, { url: secondSite.url, origin: secondSite.origin })
    answers[0]!('allow')
    expect(await pending).toBe(false)
    expect(harness.store.list()).toEqual([])
  })

  it('uses the embedding site a check without a page names, and refuses one that is not a website', async () => {
    // Such a check, as Chromium makes for an embedded website's storage access, used the website's own decision.
    const harness = await createHarness()
    await harness.store.set(widget.origin, 'geolocation', 'allow', { workspaceId: WORK })
    await harness.store.set(widget.origin, 'geolocation', 'deny', { workspaceId: WORK, embeddedIn: firstSite.origin })
    await harness.store.set(widget.origin, 'geolocation', 'allow', { workspaceId: WORK, embeddedIn: secondSite.origin })
    const pageless = (embeddingOrigin?: string) => check(harness.check, null, {
      isMainFrame: false, ...(embeddingOrigin === undefined ? {} : { embeddingOrigin })
    })
    expect(pageless()).toBe(true)
    expect(pageless(`${firstSite.origin}/`)).toBe(false)
    expect(pageless(secondSite.url)).toBe(true)
    // The website itself, or the same website on another address, is its own page.
    expect(pageless(`${widget.origin}/`)).toBe(true)
    // An embedding site with no decision of its own does not fall back to the website's own decision.
    expect(pageless('https://third.example/')).toBe(false)
    for (const embeddingOrigin of ['null', '', 'file:///home/person/page.html', 'chrome-extension://abcdef/']) {
      expect(pageless(embeddingOrigin), embeddingOrigin).toBe(false)
    }
  })

  it('forgets the decisions of workspaces that are neither open nor archived, and tells the shell', async () => {
    // A workspace whose forget failed, or that went while Hronaut stopped, kept its decisions for good.
    const harness = await createHarness()
    await harness.store.set(widget.origin, 'geolocation', 'allow')
    await harness.store.set(widget.origin, 'geolocation', 'allow', { workspaceId: WORK })
    await harness.store.set(widget.origin, 'geolocation', 'deny', { workspaceId: CLIENT })
    await harness.forgetRemovedWorkspacesSitePermissions(() => null)
    expect(harness.store.list()).toHaveLength(3)
    expect(harness.sent).toEqual([])
    await harness.forgetRemovedWorkspacesSitePermissions(() => [WORK])
    const kept = [
      { origin: widget.origin, permission: 'geolocation', decision: 'allow' },
      { origin: widget.origin, permission: 'geolocation', decision: 'allow', workspaceId: WORK }
    ]
    expect(harness.store.list()).toEqual(kept)
    expect(harness.sent).toEqual([['permissions:changed', kept]])
  })

  it('forgets a removed workspace’s decisions, keeps the rest and tells the shell', async () => {
    const harness = await createHarness()
    await harness.store.set(widget.origin, 'geolocation', 'allow')
    await harness.store.set(widget.origin, 'geolocation', 'allow', { workspaceId: WORK })
    await harness.store.set(widget.origin, 'geolocation', 'deny', { workspaceId: CLIENT })
    await harness.store.set(widget.origin, 'notifications', 'allow', { workspaceId: CLIENT, embeddedIn: firstSite.origin })
    await harness.forgetWorkspaceSitePermissions(CLIENT)
    const kept = [
      { origin: widget.origin, permission: 'geolocation', decision: 'allow' },
      { origin: widget.origin, permission: 'geolocation', decision: 'allow', workspaceId: WORK }
    ]
    expect(harness.store.list()).toEqual(kept)
    expect(harness.sent).toEqual([['permissions:changed', kept]])
    // Nothing to forget tells the shell nothing.
    await harness.forgetWorkspaceSitePermissions(CLIENT)
    expect(harness.sent).toHaveLength(1)
  })
})
