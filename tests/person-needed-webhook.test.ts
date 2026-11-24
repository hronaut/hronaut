import { createHmac } from 'node:crypto'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createPersonNeededWebhook, messageText, webhookMessage, type PersonNeededEvent } from '../src/main/attention/person-needed-webhook.js'
import { webhookAddressProblem } from '../src/shared/person-needed-webhook.js'

// When an agent needs the person, a webhook they turned on tells them elsewhere: which agent, in which workspace, and
// what it asked. Off by default, signed, retried while the address cannot be reached, never with a page or its address.

const event: Omit<PersonNeededEvent, 'test'> = {
  id: 'request-1', requestedAt: '2026-11-24T18:00:00.000Z', workspace: 'Checkout', agent: 'Claude Code',
  reason: 'Sign in at https://shop.example/login?session=query-canary#token, please.', decision: false
}

async function webhook(responses: Array<number | Error>, options: { now?: number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-webhook-'))
  const path = join(directory, 'person-needed-webhook.json')
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! })
    const next = responses.shift() ?? 200
    if (next instanceof Error) throw next
    return new Response(null, { status: next })
  })
  const sleep = vi.fn(async (_ms: number) => undefined)
  const created = createPersonNeededWebhook({
    path, userAgent: 'Hronaut/test', fetch: fetch as typeof globalThis.fetch, sleep, now: () => options.now ?? 1_764_007_200_000
  })
  return { webhook: created, path, calls, fetch, sleep }
}

describe('the person-needed webhook', () => {
  it('is off until the person turns it on, and keeps its settings in a file only they can read', async () => {
    const { webhook: hook, path, fetch } = await webhook([])
    const settings = await hook.settings()
    expect(settings).toMatchObject({ enabled: false, kind: 'json', url: '' })
    expect(settings.secret.length).toBeGreaterThanOrEqual(32)
    expect(await hook.personNeeded(event)).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
    await hook.configure({ enabled: true, kind: 'slack', url: 'https://hooks.slack.example/services/T/B/x' })
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ enabled: true, kind: 'slack', secret: settings.secret })
  })

  it('refuses an address that is not https, holds a user name, or is missing while on', async () => {
    const { webhook: hook } = await webhook([])
    await expect(hook.configure({ enabled: true, kind: 'json', url: 'http://hooks.example/in' })).rejects.toThrow(/not-https/)
    await expect(hook.configure({ enabled: true, kind: 'json', url: 'https://user:pass@hooks.example/in' })).rejects.toThrow(/credentials/)
    await expect(hook.configure({ enabled: true, kind: 'json', url: '' })).rejects.toThrow(/no-address/)
    await expect(hook.configure({ enabled: true, kind: 'teams' as never, url: 'https://hooks.example/in' })).rejects.toThrow(TypeError)
    expect(webhookAddressProblem('http://127.0.0.1:8080/in')).toBeUndefined()
    expect(webhookAddressProblem('not an address')).toBe('not-an-address')
  })

  it('signs the JSON it posts and leaves the query and fragment out of addresses the agent wrote', async () => {
    const { webhook: hook, calls } = await webhook([200])
    await hook.configure({ enabled: true, kind: 'json', url: 'https://hooks.example/in' })
    expect(await hook.personNeeded(event)).toBe(true)
    const { url, init } = calls[0]!
    expect(url).toBe('https://hooks.example/in')
    const headers = init.headers as Record<string, string>
    const body = String(init.body)
    expect(body).not.toContain('query-canary')
    expect(body).not.toContain('token')
    expect(JSON.parse(body)).toEqual({
      event: 'person-needed', id: 'request-1', requestedAt: '2026-11-24T18:00:00.000Z', kind: 'step',
      workspace: { name: 'Checkout' }, agent: { name: 'Claude Code' }, reason: 'Sign in at https://shop.example/login, please.'
    })
    expect(headers['X-Hronaut-Event']).toBe('person-needed')
    expect(headers['X-Hronaut-Timestamp']).toBe('1764007200')
    const secret = (await hook.settings()).secret
    expect(headers['X-Hronaut-Signature']).toBe(`sha256=${createHmac('sha256', secret).update(`1764007200.${body}`).digest('hex')}`)
    expect(init.redirect).toBe('error')
  })

  it('tries again after 2, 10 and 30 seconds while the address cannot take it, and not after a refusal', async () => {
    const failing = await webhook([new Error('ECONNREFUSED'), 503, 429, 200])
    await failing.webhook.configure({ enabled: true, kind: 'discord', url: 'https://discord.example/api/webhooks/1/x' })
    expect(await failing.webhook.personNeeded(event)).toBe(true)
    expect(failing.calls).toHaveLength(4)
    expect(failing.sleep.mock.calls.map(([ms]) => ms)).toEqual([2_000, 10_000, 30_000])

    const refused = await webhook([404])
    await refused.webhook.configure({ enabled: true, kind: 'json', url: 'https://hooks.example/in' })
    expect(await refused.webhook.personNeeded(event)).toBe(false)
    expect(refused.calls).toHaveLength(1)

    const gone = await webhook([500, 500, 500, 500, 500])
    await gone.webhook.configure({ enabled: true, kind: 'json', url: 'https://hooks.example/in' })
    expect(await gone.webhook.personNeeded(event)).toBe(false)
    expect(gone.calls).toHaveLength(4)
  })

  it('stops trying once the person turns it off', async () => {
    const { webhook: hook, calls, sleep } = await webhook([503, 200])
    await hook.configure({ enabled: true, kind: 'json', url: 'https://hooks.example/in' })
    sleep.mockImplementationOnce(async (_ms: number) => { await hook.configure({ enabled: false, kind: 'json', url: 'https://hooks.example/in' }) })
    expect(await hook.personNeeded(event)).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('sends a test message once and says what came back', async () => {
    const { webhook: hook, calls } = await webhook([502, new Error('offline')])
    expect(await hook.test()).toEqual({ ok: false, reason: 'no-address' })
    await hook.configure({ enabled: false, kind: 'ntfy', url: 'https://ntfy.example/hronaut-topic' })
    expect(await hook.test()).toEqual({ ok: false, reason: 'refused', status: 502 })
    expect(await hook.test()).toEqual({ ok: false, reason: 'unreachable' })
    expect(await hook.test()).toEqual({ ok: true, status: 200 })
    expect(calls).toHaveLength(3)
    expect((calls[0]!.init.headers as Record<string, string>)['X-Hronaut-Event']).toBe('test')
  })

  it('renews the signing secret, and starts over from a file that is not its own', async () => {
    const { webhook: hook, path } = await webhook([])
    const before = (await hook.settings()).secret
    expect((await hook.renewSecret()).secret).not.toBe(before)
    await writeFile(path, '{"enabled":true,"kind":"json","url":"ftp://x","secret":"short"}')
    const fresh = await webhook([])
    await writeFile(fresh.path, 'not json')
    expect(await fresh.webhook.settings()).toMatchObject({ enabled: false, url: '' })
  })
})

describe('webhook messages', () => {
  it('shape the message for Slack, Discord and ntfy without pinging anyone', () => {
    const sample = { ...event, reason: messageText(event.reason) }
    expect(JSON.parse(webhookMessage('slack', sample).body))
      .toEqual({ text: 'Hronaut: Claude Code needs you in Checkout: Sign in at https://shop.example/login, please.' })
    expect(JSON.parse(webhookMessage('discord', sample).body)).toEqual({
      username: 'Hronaut', content: 'Claude Code needs you in Checkout: Sign in at https://shop.example/login, please.', allowed_mentions: { parse: [] }
    })
    const ntfy = webhookMessage('ntfy', { ...sample, test: true })
    expect(ntfy.body).toBe('[Test] Claude Code needs you in Checkout: Sign in at https://shop.example/login, please.')
    expect(ntfy.headers).toEqual({ Title: 'Hronaut test', Tags: 'robot' })
  })

  it('keep agent text to one bounded line', () => {
    expect(messageText('a\n\u0007b   c\u202Ed')).toBe('a b c d')
    expect(messageText('x'.repeat(400))).toHaveLength(280)
    expect(messageText('see file:///etc/passwd and https://a.example/?q=1')).toBe('see file: and https://a.example')
  })
})
