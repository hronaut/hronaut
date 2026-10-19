import { createHash, createPublicKey, randomBytes, verify, type KeyObject } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication, Page } from '@playwright/test'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { HronautSettingsApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

// The user name is a canary: credential events carry it, and it must never reach an MCP result or a debug report.
const CANARY = 'passkey-canary@example.test'

interface Outcome { tab: string; action: string; focused: boolean; ok: boolean; name?: string }

/**
 * A small localhost app that verifies passkeys on its server the way a real relying party does: single-use
 * challenges, the client data's type, challenge and origin, the relying party hash and the presence and
 * verification flags, and each sign-in signature against the public key stored at registration.
 */
interface PasskeyApp {
  origin: string
  partnerOrigin: string
  verified: { registrations: number; signIns: number }
  credentialIds: string[]
  outcomes: Outcome[]
  partnerRequested: boolean
  releasePartner(): void
  close(): Promise<void>
}

const page = (partnerOrigin: string) => `<!doctype html><title>Passkey app</title>
<button id="register">Create passkey</button>
<button id="sign-in">Sign in</button>
<button id="sign-in-unknown">Sign in with an unknown passkey</button>
<button id="register-wrong-rp">Create passkey for another site</button>
<button id="embed">Embed partner</button>
<script>
const tab = new URLSearchParams(location.search).get('tab') || 'main'
if (tab !== 'main') document.title = 'Passkey app (' + tab + ')'
const b64 = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '')
const bytes = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4)), c => c.charCodeAt(0))
const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(response => response.json())
// Chromium refuses WebAuthn in a document without focus, so each outcome says whether the document had it. Without
// an authenticator, Electron neither prompts nor applies the request timeout, so the page aborts a request itself.
function attempt(action, run) {
  const focused = document.hasFocus()
  run().then(() => post('/outcome', { tab, action, focused, ok: true }), error => post('/outcome', { tab, action, focused, ok: false, name: error.name }))
}
function rejected(verdict) {
  if (!verdict.ok) throw Object.assign(new Error(verdict.error), { name: 'ServerRejected' })
}
async function register(rpId) {
  const { challenge } = await post('/challenge', {})
  const credential = await navigator.credentials.create({ publicKey: {
    challenge: bytes(challenge), rp: { name: 'Passkey app', id: rpId },
    user: { id: crypto.getRandomValues(new Uint8Array(16)), name: '${CANARY}', displayName: '${CANARY}' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }], attestation: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
  }, signal: AbortSignal.timeout(2000) })
  rejected(await post('/register', {
    id: credential.id, clientDataJSON: b64(credential.response.clientDataJSON),
    authenticatorData: b64(credential.response.getAuthenticatorData()), publicKey: b64(credential.response.getPublicKey()),
    algorithm: credential.response.getPublicKeyAlgorithm()
  }))
}
async function signIn(unknown) {
  const { challenge, credentialIds } = await post('/challenge', {})
  const ids = unknown ? [b64(crypto.getRandomValues(new Uint8Array(32)))] : credentialIds
  const assertion = await navigator.credentials.get({ publicKey: {
    challenge: bytes(challenge), rpId: location.hostname, userVerification: 'required',
    allowCredentials: ids.map(id => ({ type: 'public-key', id: bytes(id) }))
  }, signal: AbortSignal.timeout(2000) })
  rejected(await post('/sign-in', {
    id: assertion.id, clientDataJSON: b64(assertion.response.clientDataJSON),
    authenticatorData: b64(assertion.response.authenticatorData), signature: b64(assertion.response.signature)
  }))
}
document.querySelector('#register').onclick = () => attempt('register', () => register(location.hostname))
document.querySelector('#sign-in').onclick = () => attempt('sign-in', () => signIn(false))
document.querySelector('#sign-in-unknown').onclick = () => attempt('sign-in-unknown', () => signIn(true))
document.querySelector('#register-wrong-rp').onclick = () => attempt('register-wrong-rp', () => register('example.com'))
document.querySelector('#embed').onclick = () => {
  const frame = document.createElement('iframe')
  frame.setAttribute('allow', 'publickey-credentials-create *; publickey-credentials-get *')
  frame.setAttribute('src', '${partnerOrigin}/partner')
  document.body.append(frame)
}
</script>`

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
}

async function passkeyApp(): Promise<PasskeyApp> {
  const challenges = new Set<string>()
  const keys = new Map<string, KeyObject>()
  let releasePartner = (): void => undefined
  const partnerHeld = new Promise<void>(resolve => { releasePartner = resolve })
  const app: Omit<PasskeyApp, 'close'> = {
    origin: '', partnerOrigin: '', verified: { registrations: 0, signIns: 0 }, credentialIds: [], outcomes: [],
    partnerRequested: false, releasePartner: () => releasePartner()
  }
  const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest()
  const clientData = (encoded: unknown, type: string): string | undefined => {
    const data = JSON.parse(Buffer.from(String(encoded), 'base64url').toString('utf8')) as Record<string, unknown>
    if (data.type !== type) return 'type'
    if (data.origin !== app.origin) return 'origin'
    if (!challenges.delete(String(data.challenge))) return 'challenge'
    return undefined
  }
  // User present (0x01) and user verified (0x04), plus attested credential data (0x40) at registration.
  const authenticatorData = (data: Buffer, flags: number): string | undefined => {
    if (!data.subarray(0, 32).equals(sha256(new URL(app.origin).hostname))) return 'rpIdHash'
    return (data[32]! & flags) === flags ? undefined : 'flags'
  }
  const verifyRegistration = (input: Record<string, unknown>): string | undefined => {
    const data = Buffer.from(String(input.authenticatorData), 'base64url')
    const problem = clientData(input.clientDataJSON, 'webauthn.create') ?? authenticatorData(data, 0x45)
    if (problem) return problem
    if (input.algorithm !== -7) return 'algorithm'
    const idLength = data.readUInt16BE(53)
    if (data.subarray(55, 55 + idLength).toString('base64url') !== input.id) return 'credential id'
    keys.set(String(input.id), createPublicKey({ key: Buffer.from(String(input.publicKey), 'base64url'), format: 'der', type: 'spki' }))
    app.credentialIds.push(String(input.id))
    app.verified.registrations += 1
    return undefined
  }
  const verifySignIn = (input: Record<string, unknown>): string | undefined => {
    const key = keys.get(String(input.id))
    if (!key) return 'unknown credential'
    const clientDataJSON = Buffer.from(String(input.clientDataJSON), 'base64url')
    const data = Buffer.from(String(input.authenticatorData), 'base64url')
    const problem = clientData(input.clientDataJSON, 'webauthn.get') ?? authenticatorData(data, 0x05)
    if (problem) return problem
    if (!verify('sha256', Buffer.concat([data, sha256(clientDataJSON)]), key, Buffer.from(String(input.signature), 'base64url'))) return 'signature'
    app.verified.signIns += 1
    return undefined
  }
  const json = (response: import('node:http').ServerResponse, value: unknown) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(value))
  }
  const server: Server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (path === '/partner') {
        app.partnerRequested = true
        await partnerHeld
        response.setHeader('content-type', 'text/html')
        response.end('<!doctype html><title>Partner</title>partner')
      } else if (path === '/challenge') {
        const challenge = randomBytes(32).toString('base64url')
        challenges.add(challenge)
        json(response, { challenge, credentialIds: app.credentialIds })
      } else if (path === '/register') {
        const problem = verifyRegistration(await body(request))
        json(response, problem ? { ok: false, error: problem } : { ok: true })
      } else if (path === '/sign-in') {
        const problem = verifySignIn(await body(request))
        json(response, problem ? { ok: false, error: problem } : { ok: true })
      } else if (path === '/outcome') {
        app.outcomes.push(await body(request) as unknown as Outcome)
        json(response, { ok: true })
      } else {
        response.setHeader('content-type', 'text/html')
        response.end(page(app.partnerOrigin))
      }
    })()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  app.origin = `http://localhost:${port}`
  app.partnerOrigin = `http://127.0.0.1:${port}`
  // The same object the server updates, so the test reads its current state.
  return Object.assign(app, { close: async () => { releasePartner(); await closeFixtureServer(server) } })
}

const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>

/** A capability credential for the fixture's workspace whose profile lists exactly these origins. */
async function originGrant(appWindow: Page, mcpPort: number, owner: Client, workspace: { workspaceId: string; resumeKey: string }, origins: string[]): Promise<Client> {
  await owner.callTool({ name: 'browser_workspaces', arguments: { action: 'release-ownership', workspaceId: workspace.workspaceId } })
  await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setMcpAuthentication(true))
  const grant = await appWindow.evaluate(origins => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.createMcpCapabilityProfile({
    name: 'Passkey origin', preset: 'complete', argumentConstraints: { 'browser_virtual_passkey.origin': origins }
  }), origins)
  const client = new Client({ name: 'virtual-passkey-origin', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${grant.credential}` } } }))
  await connectMcpWorkspace(client, 'Virtual passkey origin', false, workspace)
  return client
}

/** Collects every result text so the test can show that no credential detail ever reached the agent. */
function recorder(client: Client) {
  const seen: string[] = []
  return {
    seen,
    call: async (name: string, args: Record<string, unknown>) => {
      const result = await call(client, name, args)
      seen.push(JSON.stringify(result))
      return result
    }
  }
}

async function passkey(run: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await run('browser_virtual_passkey', args)
  expect(result.isError, text(result)).not.toBe(true)
  return JSON.parse(text(result)) as Record<string, unknown>
}

async function outcome(app: PasskeyApp, run: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>, tabId: string, button: string, action: string, tab = 'main'): Promise<Outcome> {
  const before = app.outcomes.filter(entry => entry.action === action && entry.tab === tab).length
  const clicked = await run('browser_click', { tabId, selector: button })
  expect(clicked.isError, text(clicked)).not.toBe(true)
  await expect.poll(() => app.outcomes.filter(entry => entry.action === action && entry.tab === tab).length, { timeout: 10_000 }).toBe(before + 1)
  return app.outcomes.filter(entry => entry.action === action && entry.tab === tab).at(-1)!
}

/** Clicks a button from inside the page, as its own script would, with no agent or person involved. */
async function pageClick(electronApp: ElectronApplication, pageUrl: string, selector: string): Promise<void> {
  await electronApp.evaluate(({ webContents }, { pageUrl, selector }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)!
    return page.mainFrame.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`)
  }, { pageUrl, selector })
}

async function humanClick(electronApp: ElectronApplication, pageUrl: string): Promise<void> {
  await electronApp.evaluate(({ webContents }, pageUrl) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)!
    page.sendInputEvent({ type: 'mouseDown', x: 5, y: 200, button: 'left', clickCount: 1 })
    page.sendInputEvent({ type: 'mouseUp', x: 5, y: 200, button: 'left', clickCount: 1 })
  }, pageUrl)
}

test('registers and signs in through a localhost app that verifies passkeys on its server, without exposing credential details', async ({ capabilities, appWindow, mcpPort }) => {
  const { client: owner, tabId, workspace } = capabilities
  const app = await passkeyApp()
  let client: Client | undefined
  try {
    const navigated = await call(owner, 'browser_navigate', { tabId, url: `${app.origin}/` })
    expect(navigated.isError, text(navigated)).not.toBe(true)

    // Full access is not enough: the person names the origins in a capability profile.
    const fullAccess = await call(owner, 'browser_virtual_passkey', { tabId, action: 'start', origin: app.origin })
    expect(fullAccess.isError, text(fullAccess)).toBe(true)
    expect(fullAccess.structuredContent).toMatchObject({ status: 'REFUSED', reason: 'SEPARATE_GRANT_REQUIRED', effects: 'none' })

    client = await originGrant(appWindow, mcpPort, owner, workspace, [app.origin])
    const agent = recorder(client)
    const unlisted = await agent.call('browser_virtual_passkey', { tabId, action: 'start', origin: 'http://localhost:1' })
    expect(unlisted.isError, text(unlisted)).toBe(true)
    expect(await passkey(agent.call, { tabId, action: 'status', origin: app.origin })).toMatchObject({ status: 'inactive' })

    expect(await passkey(agent.call, { tabId, action: 'start', origin: app.origin })).toMatchObject({
      tabId, origin: app.origin, status: 'active',
      passkey: { userVerified: true, credentials: 0, registrations: 0, signIns: 0 }
    })
    await expect(appWindow.getByTestId('virtual-passkey-pill')).toHaveAccessibleName(`Stop the virtual passkey for ${app.origin}`)

    expect(await outcome(app, agent.call, tabId, '#register', 'register')).toMatchObject({ ok: true })
    expect(app.verified.registrations).toBe(1)
    expect(await outcome(app, agent.call, tabId, '#sign-in', 'sign-in')).toMatchObject({ ok: true })
    expect(app.verified.signIns).toBe(1)
    expect(await passkey(agent.call, { tabId, action: 'status', origin: app.origin })).toMatchObject({
      status: 'active', passkey: { credentials: 1, registrations: 1, signIns: 1 }
    })

    // Failures the page has to handle: a credential the authenticator does not hold, a relying party that is not
    // the page's own, and failed user verification.
    expect(await outcome(app, agent.call, tabId, '#sign-in-unknown', 'sign-in-unknown')).toMatchObject({ ok: false, name: 'NotAllowedError' })
    expect(await outcome(app, agent.call, tabId, '#register-wrong-rp', 'register-wrong-rp')).toMatchObject({ ok: false, name: 'SecurityError' })
    expect(await passkey(agent.call, { tabId, action: 'configure', origin: app.origin, userVerified: false })).toMatchObject({ passkey: { userVerified: false } })
    expect(await outcome(app, agent.call, tabId, '#sign-in', 'sign-in')).toMatchObject({ ok: false, name: 'NotAllowedError' })
    await passkey(agent.call, { tabId, action: 'configure', origin: app.origin, userVerified: true })
    expect(await outcome(app, agent.call, tabId, '#sign-in', 'sign-in')).toMatchObject({ ok: true })
    expect(app.verified).toEqual({ registrations: 1, signIns: 2 })

    const report = await agent.call('browser_debug_report', { tabId })
    expect(report.isError, text(report)).not.toBe(true)
    expect(await passkey(agent.call, { tabId, action: 'stop', origin: app.origin })).toMatchObject({
      status: 'inactive', lastEnded: { reason: 'stopped', removalConfirmed: true }
    })
    await expect(appWindow.getByTestId('virtual-passkey-pill')).toHaveCount(0)
    // Its credentials went with it: the request finds no authenticator until the page gives up.
    expect(await outcome(app, agent.call, tabId, '#sign-in', 'sign-in')).toMatchObject({ focused: true, ok: false, name: expect.stringMatching(/^(TimeoutError|AbortError)$/u) })
    expect(app.verified).toEqual({ registrations: 1, signIns: 2 })

    const seen = agent.seen.join('\n')
    expect(seen).not.toContain(CANARY)
    for (const id of app.credentialIds) expect(seen).not.toContain(id)
  } finally {
    await client?.close()
    await app.close()
  }
})

test('the virtual passkey ends before a frame of another origin loads, and other tabs never get it', async ({ capabilities, appWindow, electronApp, mcpPort }) => {
  const { client: owner, tabId, workspace } = capabilities
  const app = await passkeyApp()
  let client: Client | undefined
  try {
    client = await originGrant(appWindow, mcpPort, owner, workspace, [app.origin])
    const agent = recorder(client)
    expect((await agent.call('browser_navigate', { tabId, url: `${app.origin}/` })).isError).not.toBe(true)
    await passkey(agent.call, { tabId, action: 'start', origin: app.origin })

    // Another tab of the same origin and workspace keeps the computer's own authenticators. The person shows it, so
    // its document has focus, and the attempt runs in the page itself rather than as an agent action.
    const opened = await agent.call('browser_new_tab', { url: `${app.origin}/?tab=other` })
    expect(opened.isError, text(opened)).not.toBe(true)
    const otherTabId = (JSON.parse(text(opened)) as { tabs: Array<{ id: string }> }).tabs.find(tab => tab.id !== tabId)!.id
    await appWindow.getByRole('tab', { name: /^Passkey app \(other\)/u }).click()
    await pageClick(electronApp, `${app.origin}/?tab=other`, '#register')
    await expect.poll(() => app.outcomes.find(entry => entry.tab === 'other'), { timeout: 10_000 }).toMatchObject({
      focused: true, ok: false, name: expect.stringMatching(/^(TimeoutError|AbortError)$/u)
    })
    const otherStatus = await passkey(agent.call, { tabId: otherTabId, action: 'status', origin: app.origin })
    expect(otherStatus).toMatchObject({ status: 'inactive' })
    expect(otherStatus).not.toHaveProperty('passkey')
    expect(await passkey(agent.call, { tabId, action: 'status', origin: app.origin })).toMatchObject({ status: 'active', passkey: { registrations: 0 } })
    expect(app.verified.registrations).toBe(0)
    await appWindow.getByRole('tab', { name: /^Passkey app —/u }).click()
    expect(await outcome(app, agent.call, tabId, '#register', 'register')).toMatchObject({ focused: true, ok: true })
    expect(await passkey(agent.call, { tabId, action: 'status', origin: app.origin })).toMatchObject({ status: 'active', passkey: { registrations: 1 } })

    // The partner frame's response is held: the session has already ended while its document cannot load yet.
    const clicked = await agent.call('browser_click', { tabId, selector: '#embed' })
    expect(clicked.isError, text(clicked)).not.toBe(true)
    await expect.poll(() => app.partnerRequested).toBe(true)
    expect(await passkey(agent.call, { tabId, action: 'status', origin: app.origin })).toMatchObject({
      status: 'inactive', lastEnded: { reason: 'origin-left', removalConfirmed: true }
    })
    app.releasePartner()

    // Once the partner frame has loaded, a new start is refused for it (while it loads, for the loading page).
    await expect.poll(() => electronApp.evaluate(({ webContents }, { pageUrl, frameUrl }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)
      return page !== undefined && !page.isLoading() && page.mainFrame.framesInSubtree.some(frame => frame.url === frameUrl)
    }, { pageUrl: `${app.origin}/`, frameUrl: `${app.partnerOrigin}/partner` })).toBe(true)
    const refused = await agent.call('browser_virtual_passkey', { tabId, action: 'start', origin: app.origin })
    expect(refused.isError, text(refused)).toBe(true)
    expect(text(refused)).toContain('A frame of another origin is in the page')
    expect(await outcome(app, agent.call, tabId, '#sign-in', 'sign-in')).toMatchObject({ focused: true, ok: false, name: expect.stringMatching(/^(TimeoutError|AbortError)$/u) })
    expect(app.verified).toEqual({ registrations: 1, signIns: 0 })
  } finally {
    await client?.close()
    await app.close()
  }
})

test('the person, a pause or a click in the page ends the virtual passkey', async ({ capabilities, appWindow, electronApp, mcpPort }) => {
  const { client: owner, tabId, workspace } = capabilities
  const app = await passkeyApp()
  let client: Client | undefined
  try {
    client = await originGrant(appWindow, mcpPort, owner, workspace, [app.origin])
    const agent = recorder(client)
    expect((await agent.call('browser_navigate', { tabId, url: `${app.origin}/` })).isError).not.toBe(true)
    const status = () => passkey(agent.call, { tabId, action: 'status', origin: app.origin })

    await passkey(agent.call, { tabId, action: 'start', origin: app.origin })
    await appWindow.getByTestId('virtual-passkey-pill').click()
    await expect(appWindow.getByTestId('virtual-passkey-pill')).toHaveCount(0)
    expect(await status()).toMatchObject({ status: 'inactive', lastEnded: { reason: 'person-stopped', removalConfirmed: true } })

    await passkey(agent.call, { tabId, action: 'start', origin: app.origin })
    await appWindow.getByRole('button', { name: 'Pause agents', exact: true }).click()
    await expect(appWindow.getByTestId('virtual-passkey-pill')).toHaveCount(0)
    await appWindow.getByRole('button', { name: 'Resume agents', exact: true }).click()
    await expect.poll(() => appWindow.evaluate('window.hronautMcp.getState()')).toMatchObject({ status: 'ready', paused: false })
    expect(await status()).toMatchObject({ status: 'inactive', lastEnded: { reason: 'authority-changed' } })
    // Pausing revoked the write lease, which a writer claims again after inspecting the page.
    const claimed = await agent.call('browser_workspaces', { action: 'claim-ownership', workspaceId: workspace.workspaceId })
    expect(claimed.isError, text(claimed)).not.toBe(true)

    await passkey(agent.call, { tabId, action: 'start', origin: app.origin })
    await humanClick(electronApp, `${app.origin}/`)
    await expect.poll(async () => (await status()).status).toBe('inactive')
    expect(await status()).toMatchObject({ lastEnded: { reason: 'authority-changed' } })
    expect(await outcome(app, agent.call, tabId, '#register', 'register')).toMatchObject({ focused: true, ok: false, name: expect.stringMatching(/^(TimeoutError|AbortError)$/u) })
    expect(app.verified.registrations).toBe(0)
  } finally {
    await client?.close()
    await app.close()
  }
})
