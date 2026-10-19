import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { foreignFrame, staysInOrigin, VirtualPasskeyController, type VirtualPasskeyTab } from '../src/main/browser/virtual-passkey/virtual-passkey.js'
import { virtualPasskeyOrigin } from '../src/shared/virtual-passkey.js'
import { virtualPasskeySettlement } from '../src/main/mcp/tools/browser-virtual-passkey/virtual-passkey-settlement.js'

const ORIGIN = 'http://localhost:3000'

interface Deferred { resolve: (value: unknown) => void; reject: (error: Error) => void }

/** A page with the WebContents and debugger surface the controller uses; commands are recorded as they are sent. */
function page(options: { url?: string; frames?: Array<{ origin: string; url: string }>; loading?: boolean } = {}) {
  const contents = new EventEmitter() as EventEmitter & Record<string, unknown>
  const debuggerEvents = new EventEmitter() as EventEmitter & Record<string, unknown>
  const sent: Array<[string, Record<string, unknown> | undefined]> = []
  /** Commands whose answer the test gives itself, by method. */
  const held = new Map<string, Deferred>()
  const rejecting = new Set<string>()
  let attached = true
  let destroyed = false
  debuggerEvents.isAttached = () => attached
  debuggerEvents.sendCommand = (method: string, params?: Record<string, unknown>) => {
    sent.push([method, params])
    if (rejecting.has(method)) return Promise.reject(new Error(`${method} failed`))
    if (held.has(method)) return new Promise((resolve, reject) => { held.set(method, { resolve, reject }) })
    if (method === 'WebAuthn.addVirtualAuthenticator') return Promise.resolve({ authenticatorId: 'auth-1' })
    return Promise.resolve({})
  }
  Object.assign(contents, {
    debugger: debuggerEvents,
    isDestroyed: () => destroyed,
    isCrashed: () => false,
    isLoading: () => options.loading ?? false,
    getURL: () => options.url ?? `${ORIGIN}/sign-in`,
    mainFrame: { framesInSubtree: options.frames ?? [{ origin: ORIGIN, url: `${ORIGIN}/sign-in` }] }
  })
  const mainFrame = contents.mainFrame as { framesInSubtree: Array<{ origin: string; url: string }> }
  return {
    webContents: contents as unknown as WebContents,
    sent,
    methods: () => sent.map(([method]) => method),
    hold: (method: string) => { held.set(method, { resolve: () => undefined, reject: () => undefined }) },
    answer: (method: string, value: unknown) => { const deferred = held.get(method)!; held.delete(method); deferred.resolve(value) },
    reject: (method: string) => rejecting.add(method),
    /** Starts a navigation; by default a frame of the origin started it. */
    navigate: (url: string, isSameDocument = false, event = 'did-start-navigation', initiator: { origin: string } | null = { origin: ORIGIN }) =>
      contents.emit(event, { initiator }, url, isSameDocument, false),
    /** Commits a document whose page now has these frames, as a restore from the back-forward cache does with no frame navigation. */
    commit: (frames: Array<{ origin: string; url: string }>) => { mainFrame.framesInSubtree = frames; contents.emit('did-frame-navigate', {}, frames[0]!.url, 200, 'OK', true) },
    setFrames: (frames: Array<{ origin: string; url: string }>) => { mainFrame.framesInSubtree = frames },
    emit: (event: string) => contents.emit(event),
    detach: () => { attached = false; debuggerEvents.emit('detach') },
    destroy: () => { destroyed = true; contents.emit('destroyed') },
    debuggerMessage: (method: string, params: unknown) => debuggerEvents.emit('message', {}, method, params),
    listeners: () => contents.eventNames().reduce((total, name) => total + contents.listenerCount(name), 0)
      + debuggerEvents.eventNames().reduce((total, name) => total + debuggerEvents.listenerCount(name), 0)
  }
}

function fixture(pageOptions: Parameters<typeof page>[0] = {}) {
  const fake = page(pageOptions)
  const tab: VirtualPasskeyTab = { id: 'tab-1', webContents: fake.webContents }
  const changed = vi.fn()
  let current = true
  let devToolsOpening = false
  let afterOperation: (() => void) | undefined
  const controller = new VirtualPasskeyController<VirtualPasskeyTab>({
    isCurrent: () => current,
    isDevToolsOpening: () => devToolsOpening,
    // The real debugger queue can do work of its own after the operation, such as enabling domains it attached for.
    withDebugger: async (_tab, operation) => {
      const result = await operation()
      afterOperation?.()
      return result
    },
    changed
  })
  const authority = { assertCurrent: vi.fn() }
  const start = (extra: { userVerified?: boolean; durationMs?: number } = {}) => controller.manage(tab, 'start', { origin: ORIGIN, ...extra }, authority)
  const status = (origin = ORIGIN) => controller.manage(tab, 'status', { origin }, authority)
  return {
    ...fake, tab, controller, authority, changed, start, status,
    leave: () => { current = false },
    openDevTools: () => { devToolsOpening = true },
    onAfterOperation: (run: () => void) => { afterOperation = run }
  }
}

afterEach(() => { vi.useRealTimers() })

describe('virtual passkey origins', () => {
  it('accepts only exact localhost origins in the browser\'s own form', () => {
    for (const origin of ['http://localhost:3000', 'https://localhost', 'https://app.localhost:8443', 'http://a.b.localhost:5173']) {
      expect(virtualPasskeyOrigin(origin)).toBe(origin)
    }
    for (const origin of ['http://localhost:3000/', 'http://localhost:3000/app', 'HTTP://LOCALHOST:3000', 'http://localhost:80', 'https://example.com',
      'http://127.0.0.1:3000', 'http://localhost.example.com', 'http://localhost.:3000', 'ftp://localhost', 'http://user@localhost:3000', 'localhost:3000']) {
      expect(() => virtualPasskeyOrigin(origin), origin).toThrow('exact localhost origin')
    }
  })

  it('lets frames stay at the origin, in a blob it created, an inline document or an empty one the origin started, and nothing else', () => {
    for (const url of [`${ORIGIN}/next`, `blob:${ORIGIN}/0b5c`, 'about:blank', 'about:blank#top', 'about:srcdoc']) expect(staysInOrigin(url, ORIGIN, ORIGIN), url).toBe(true)
    for (const url of ['http://a.localhost:3000/', 'https://localhost:3000/', 'http://localhost:3001/', 'data:text/html,x', 'about:version', 'javascript:1', 'not a url']) {
      expect(staysInOrigin(url, ORIGIN, ORIGIN), url).toBe(false)
    }
    // An empty document takes the origin of whoever started it.
    expect(staysInOrigin('about:blank', ORIGIN, 'http://ads.localhost:3000')).toBe(false)
    expect(staysInOrigin('about:blank', ORIGIN, undefined)).toBe(false)
    expect(staysInOrigin('about:srcdoc', ORIGIN, undefined)).toBe(true)
  })

  it('counts every frame at another origin as foreign, except opaque ones at an empty, inline or same-origin document', () => {
    const at = (frames: Array<{ origin: string; url: string }>) => foreignFrame({ mainFrame: { framesInSubtree: frames } } as unknown as WebContents, ORIGIN)
    expect(at([{ origin: ORIGIN, url: `${ORIGIN}/` }, { origin: ORIGIN, url: 'about:blank' }, { origin: 'null', url: 'about:srcdoc' }, { origin: 'null', url: `${ORIGIN}/sandboxed` }])).toBe(false)
    expect(at([{ origin: ORIGIN, url: `${ORIGIN}/` }, { origin: 'http://ads.localhost:3000', url: 'about:blank' }])).toBe(true)
    expect(at([{ origin: ORIGIN, url: `${ORIGIN}/` }, { origin: 'null', url: 'https://evil.example/' }])).toBe(true)
    const unreadable = { get origin(): string { throw new Error('Render frame was disposed') }, url: '' }
    expect(at([{ origin: ORIGIN, url: `${ORIGIN}/` }, unreadable])).toBe(true)
  })
})

describe('virtual passkey controller', () => {
  it('starts one CTAP2 platform authenticator with the browser UI off, and reports only counts', async () => {
    const { start, sent, controller, tab, changed } = fixture()
    const report = await start({ userVerified: false, durationMs: 120_000 })
    expect(sent).toEqual([
      ['WebAuthn.enable', { enableUI: false }],
      ['WebAuthn.addVirtualAuthenticator', { options: expect.objectContaining({ protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, automaticPresenceSimulation: true, isUserVerified: false }) }]
    ])
    expect(report).toMatchObject({ tabId: 'tab-1', origin: ORIGIN, status: 'active', passkey: { userVerified: false, credentials: 0, registrations: 0, signIns: 0 } })
    expect(report.passkey!.remainingMs).toBeGreaterThan(119_000)
    expect(controller.active(tab)).toBe(true)
    expect(controller.summary(tab)).toEqual({ origin: ORIGIN, expiresAt: report.passkey!.expiresAt })
    expect(changed).toHaveBeenCalled()
  })

  it('refuses to start unless the tab, every frame and the load are at the origin, and sends nothing then', async () => {
    const cases: Array<[Parameters<typeof page>[0], string]> = [
      [{ url: 'http://localhost:3001/' }, 'not showing http://localhost:3000'],
      [{ frames: [{ origin: ORIGIN, url: `${ORIGIN}/` }, { origin: 'http://ads.localhost:3000', url: 'http://ads.localhost:3000/frame' }] }, 'frame of another origin'],
      [{ frames: [{ origin: ORIGIN, url: `${ORIGIN}/` }, { origin: 'null', url: 'data:text/html,x' }] }, 'frame of another origin'],
      [{ loading: true }, 'finish loading']
    ]
    for (const [options, message] of cases) {
      const { start, sent, controller, tab } = fixture(options)
      await expect(start()).rejects.toThrow(message)
      expect(sent.filter(([method]) => method !== 'WebAuthn.disable')).toEqual([])
      expect(controller.active(tab)).toBe(false)
    }
    // A sandboxed inline frame has an opaque origin, which cannot use passkeys at all.
    const sandboxed = fixture({ frames: [{ origin: ORIGIN, url: `${ORIGIN}/` }, { origin: 'null', url: 'about:srcdoc' }] })
    await expect(sandboxed.start()).resolves.toMatchObject({ status: 'active' })
    await expect(sandboxed.start()).rejects.toThrow('already active')
    await expect(fixture().controller.manage(fixture().tab, 'start', { origin: 'https://example.com' }, { assertCurrent: () => undefined })).rejects.toThrow('exact localhost origin')
  })

  it('ends at once, in the navigation event itself, when any frame starts or is redirected to load another origin', async () => {
    for (const event of ['did-start-navigation', 'did-redirect-navigation']) {
      const { start, navigate, methods, status, controller, tab, listeners } = fixture()
      await start()
      const before = listeners()
      navigate(`${ORIGIN}/account`)
      navigate('about:srcdoc')
      navigate('about:blank')
      navigate(`blob:${ORIGIN}/0b5c`)
      navigate('https://evil.example/#same-document', true, event)
      expect(controller.active(tab)).toBe(true)
      navigate('http://ads.localhost:3000/frame', false, event)
      // No await: the authenticator was removed and the environment disabled before the event returned.
      expect(methods().slice(-2)).toEqual(['WebAuthn.removeVirtualAuthenticator', 'WebAuthn.disable'])
      expect(controller.active(tab)).toBe(false)
      expect(controller.summary(tab)).toBeUndefined()
      expect(listeners()).toBeLessThan(before)
      expect(listeners()).toBe(0)
      expect(await status()).toMatchObject({ status: 'inactive', lastEnded: { reason: 'origin-left', removalConfirmed: true } })
    }
  })

  it('ends when a committed document or the periodic check finds a frame of another origin, and on an empty document another origin starts', async () => {
    vi.useFakeTimers()
    // A page restored from the back-forward cache comes back with its frames; only the top-level document commits.
    const restored = fixture()
    await restored.start()
    restored.commit([{ origin: ORIGIN, url: `${ORIGIN}/` }])
    expect(restored.controller.active(restored.tab)).toBe(true)
    restored.commit([{ origin: ORIGIN, url: `${ORIGIN}/` }, { origin: 'http://ads.localhost:3000', url: 'http://ads.localhost:3000/frame' }])
    expect(restored.methods().slice(-2)).toEqual(['WebAuthn.removeVirtualAuthenticator', 'WebAuthn.disable'])
    expect((await restored.status()).lastEnded?.reason).toBe('origin-left')

    const polled = fixture()
    await polled.start()
    polled.setFrames([{ origin: ORIGIN, url: `${ORIGIN}/` }, { origin: 'http://ads.localhost:3000', url: 'about:blank' }])
    await vi.advanceTimersByTimeAsync(250)
    expect((await polled.status()).lastEnded?.reason).toBe('origin-left')
    expect(vi.getTimerCount()).toBe(0)

    // Started by a frame of another origin, or by the browser itself.
    for (const initiator of [{ origin: 'http://ads.localhost:3000' }, null]) {
      const blank = fixture()
      await blank.start()
      blank.navigate('about:blank', false, 'did-start-navigation', initiator)
      expect((await blank.status()).lastEnded?.reason).toBe('origin-left')
    }
  })

  it('does not bring back a session that ended while the debugger queue finished its own work, or keep its timers', async () => {
    vi.useFakeTimers()
    const late = fixture()
    await late.start()
    await late.controller.manage(late.tab, 'stop', { origin: ORIGIN }, late.authority)
    late.onAfterOperation(() => late.navigate('https://evil.example/'))
    await expect(late.start()).rejects.toThrow('ended while it was starting')
    expect(late.controller.active(late.tab)).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    // The earlier session's end is still the one reported.
    expect((await late.status()).lastEnded?.reason).toBe('stopped')

    // A frame of another origin that arrived while the authenticator was being added is caught before the start succeeds.
    const framed = fixture()
    framed.hold('WebAuthn.addVirtualAuthenticator')
    const pending = framed.start()
    await vi.waitFor(() => expect(framed.methods()).toContain('WebAuthn.addVirtualAuthenticator'))
    framed.setFrames([{ origin: ORIGIN, url: `${ORIGIN}/` }, { origin: 'http://ads.localhost:3000', url: 'http://ads.localhost:3000/frame' }])
    framed.answer('WebAuthn.addVirtualAuthenticator', { authenticatorId: 'auth-1' })
    await expect(pending).rejects.toThrow('frame of another origin')
    expect(framed.methods().slice(-2)).toEqual(['WebAuthn.removeVirtualAuthenticator', 'WebAuthn.disable'])
    expect(framed.controller.active(framed.tab)).toBe(false)
  })

  it('never leaves an authenticator behind when the page leaves the origin while it is starting', async () => {
    const enabling = fixture()
    enabling.hold('WebAuthn.enable')
    const pending = enabling.start()
    enabling.navigate('https://evil.example/')
    enabling.answer('WebAuthn.enable', {})
    await expect(pending).rejects.toThrow('ended while it was starting')
    expect(enabling.methods()).toEqual(['WebAuthn.enable', 'WebAuthn.disable'])
    expect((await enabling.status()).lastEnded).toBeUndefined()

    // The authenticator exists once its command is dispatched, before its id is known: disabling removes it anyway.
    const adding = fixture()
    adding.hold('WebAuthn.addVirtualAuthenticator')
    const added = adding.start()
    await vi.waitFor(() => expect(adding.methods()).toContain('WebAuthn.addVirtualAuthenticator'))
    adding.navigate('https://evil.example/')
    expect(adding.methods()).toEqual(['WebAuthn.enable', 'WebAuthn.addVirtualAuthenticator', 'WebAuthn.disable'])
    adding.answer('WebAuthn.addVirtualAuthenticator', { authenticatorId: 'late' })
    await expect(added).rejects.toThrow('ended while it was starting')
    expect(adding.controller.active(adding.tab)).toBe(false)

    // A failed command rolls back what was enabled.
    const failing = fixture()
    failing.reject('WebAuthn.addVirtualAuthenticator')
    await expect(failing.start()).rejects.toThrow('addVirtualAuthenticator failed')
    expect(failing.methods()).toEqual(['WebAuthn.enable', 'WebAuthn.addVirtualAuthenticator', 'WebAuthn.disable'])
    expect(failing.controller.active(failing.tab)).toBe(false)
  })

  it('ends when the starting call loses its authority, on a navigation or between them, and when it expires', async () => {
    vi.useFakeTimers()
    const lost = fixture()
    await lost.start()
    lost.authority.assertCurrent.mockImplementation(() => { throw new Error('Workspace ownership changed') })
    lost.navigate(`${ORIGIN}/next`)
    expect(await lost.status()).toMatchObject({ status: 'inactive', lastEnded: { reason: 'authority-changed' } })

    const polled = fixture()
    await polled.start()
    polled.authority.assertCurrent.mockImplementation(() => { throw new Error('A person used the page') })
    await vi.advanceTimersByTimeAsync(250)
    expect(polled.controller.active(polled.tab)).toBe(false)
    expect(polled.methods().slice(-2)).toEqual(['WebAuthn.removeVirtualAuthenticator', 'WebAuthn.disable'])

    const moved = fixture()
    await moved.start()
    moved.leave()
    await vi.advanceTimersByTimeAsync(250)
    expect((await moved.controller.manage(moved.tab, 'status', { origin: ORIGIN }, moved.authority)).lastEnded?.reason).toBe('authority-changed')

    const expiring = fixture()
    await expiring.start({ durationMs: 60_000 })
    await vi.advanceTimersByTimeAsync(59_999)
    expect(expiring.controller.active(expiring.tab)).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(await expiring.status()).toMatchObject({ status: 'inactive', lastEnded: { reason: 'expired' } })
  })

  it('ends on a renderer exit, Developer Tools, a debugger detach, the tab closing and the person\'s stop', async () => {
    const crashed = fixture()
    await crashed.start()
    crashed.emit('render-process-gone')
    // The environment survives a renderer exit, so it is removed explicitly.
    expect(crashed.methods().slice(-2)).toEqual(['WebAuthn.removeVirtualAuthenticator', 'WebAuthn.disable'])
    expect((await crashed.status()).lastEnded?.reason).toBe('renderer-exited')

    const devtools = fixture()
    await devtools.start()
    devtools.emit('devtools-opened')
    expect((await devtools.status()).lastEnded?.reason).toBe('devtools-opened')

    // Opening Developer Tools detaches Hronaut's debugger first.
    const opening = fixture()
    await opening.start()
    opening.openDevTools()
    opening.detach()
    expect((await opening.status()).lastEnded?.reason).toBe('devtools-opened')

    const detached = fixture()
    await detached.start()
    const sentBefore = detached.sent.length
    detached.detach()
    // The ended debugger session took the environment with it; nothing is sent to it.
    expect(detached.sent.length).toBe(sentBefore)
    expect((await detached.status()).lastEnded?.reason).toBe('debugger-detached')

    const closed = fixture()
    await closed.start()
    closed.destroy()
    expect(closed.controller.active(closed.tab)).toBe(false)

    const person = fixture()
    await person.start()
    person.controller.stop(person.tab, 'person-stopped')
    expect((await person.status()).lastEnded?.reason).toBe('person-stopped')
  })

  it('reports removal it could not confirm', async () => {
    const { start, reject, controller, tab, status } = fixture()
    await start()
    reject('WebAuthn.disable')
    controller.stop(tab, 'stopped')
    await vi.waitFor(async () => expect((await status()).lastEnded?.removalConfirmed).toBe(false))
  })

  it('counts credential events of its own authenticator without keeping anything they carry', async () => {
    const { start, debuggerMessage, status } = fixture()
    await start()
    const credential = { credentialId: 'secret-id', privateKey: 'PRIVATE-KEY-CANARY', userName: 'canary@example.test', userHandle: 'handle', rpId: 'localhost', signCount: 1 }
    debuggerMessage('WebAuthn.credentialAdded', { authenticatorId: 'auth-1', credential })
    debuggerMessage('WebAuthn.credentialAdded', { authenticatorId: 'auth-1', credential })
    debuggerMessage('WebAuthn.credentialAsserted', { authenticatorId: 'auth-1', credential })
    debuggerMessage('WebAuthn.credentialDeleted', { authenticatorId: 'auth-1', credentialId: 'secret-id' })
    debuggerMessage('WebAuthn.credentialAdded', { authenticatorId: 'someone-else', credential })
    debuggerMessage('Network.requestWillBeSent', undefined)
    const report = await status()
    expect(report.passkey).toMatchObject({ credentials: 1, registrations: 2, signIns: 1 })
    expect(JSON.stringify(report)).not.toMatch(/CANARY|canary|secret-id|handle/)
  })

  it('configures and stops only the session of the origin a call names, and never describes another', async () => {
    const { start, controller, tab, authority, sent, status } = fixture()
    await expect(controller.manage(tab, 'configure', { origin: ORIGIN, userVerified: false }, authority)).rejects.toThrow('No virtual passkey is active')
    await start()
    await expect(controller.manage(tab, 'configure', { origin: ORIGIN }, authority)).rejects.toThrow('needs userVerified')
    const configured = await controller.manage(tab, 'configure', { origin: ORIGIN, userVerified: false }, authority)
    expect(sent.at(-1)).toEqual(['WebAuthn.setUserVerified', { authenticatorId: 'auth-1', isUserVerified: false }])
    expect(configured.passkey?.userVerified).toBe(false)
    await expect(controller.manage(tab, 'configure', { origin: 'http://app.localhost:3000', userVerified: true }, authority)).rejects.toThrow('No virtual passkey is active')

    expect(await status('http://app.localhost:3000')).toEqual(expect.objectContaining({ status: 'inactive' }))
    expect(await status('http://app.localhost:3000')).not.toHaveProperty('passkey')
    expect(await controller.manage(tab, 'stop', { origin: 'http://app.localhost:3000' }, authority)).toMatchObject({ status: 'inactive' })
    expect(controller.active(tab)).toBe(true)
    expect(await controller.manage(tab, 'stop', { origin: ORIGIN }, authority)).toMatchObject({ status: 'inactive', lastEnded: { reason: 'stopped' } })
    expect(await status('http://app.localhost:3000')).not.toHaveProperty('lastEnded')

    await expect(controller.manage(tab, 'status', { origin: ORIGIN, durationMs: 60_000 }, authority)).rejects.toThrow('only for action start')
    await expect(controller.manage(tab, 'stop', { origin: ORIGIN, userVerified: true }, authority)).rejects.toThrow('only for actions start and configure')
    await expect(start({ durationMs: 1000 })).rejects.toThrow('durationMs must be')
    controller.forget(tab)
    expect(await status()).not.toHaveProperty('lastEnded')
  })

  it('refuses full-access credentials before anything else', () => {
    expect(virtualPasskeySettlement(false).admit()?.structuredContent).toMatchObject({ status: 'REFUSED', reason: 'SEPARATE_GRANT_REQUIRED', effects: 'none' })
    expect(virtualPasskeySettlement(true).admit()).toBeUndefined()
  })
})
