import { createHmac, randomBytes } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isPersonNeededWebhookKind, webhookAddressProblem } from '../../shared/person-needed-webhook.js'
import type { PersonNeededWebhookConfig, PersonNeededWebhookKind, PersonNeededWebhookSettings, PersonNeededWebhookTest } from '../../shared/types.js'

// Hronaut tells the person an agent needs them with its tray, window and sound, which reach no one away from the
// computer. A person who turns it on also gets a message at an address of their own: a Slack or Discord channel, an
// ntfy topic or their own endpoint. It says which agent needs them in which workspace and what it asked, never the
// page, its address or anything typed in it, and it is the one thing Hronaut sends off the computer for it.

const TEXT_LIMIT = 280
const ATTEMPT_TIMEOUT_MS = 10_000
/** The waits before the second, third and fourth attempt of a delivery that failed for a reason that may pass. */
export const PERSON_NEEDED_RETRY_DELAYS_MS = [2_000, 10_000, 30_000] as const

/** What a message says: which agent needs the person in which workspace, and what it asked. */
export interface PersonNeededEvent {
  id: string
  requestedAt: string
  workspace?: string
  agent?: string
  reason: string
  message?: string
  /** A decision the agent waits on, rather than a step it asked the person to do. */
  decision: boolean
  test?: boolean
}

/**
 * Text an agent wrote, as a message may carry it: one line of at most 280 characters, with each web address cut to its
 * origin and path, since a query or fragment can hold a session or a token.
 */
export function messageText(value: string, limit = TEXT_LIMIT): string {
  const text = value.replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]+/gu, ' ').replace(/\s+/g, ' ').trim()
  const addressed = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi, (found) => {
    // Punctuation that ends a sentence stays with the sentence, not the address.
    const address = found.replace(/[.,;:!?)\]]+$/, '')
    const after = found.slice(address.length)
    try {
      const url = new URL(address)
      return `${url.protocol === 'http:' || url.protocol === 'https:' ? `${url.origin}${url.pathname === '/' ? '' : url.pathname}` : url.protocol}${after}`
    } catch {
      return after
    }
  })
  return addressed.length > limit ? `${addressed.slice(0, limit - 1)}…` : addressed
}

/** Every text an event carries as messageText leaves it, so no caller can send a query, a fragment or a second line. */
function boundedEvent(event: PersonNeededEvent): PersonNeededEvent {
  const workspace = event.workspace ? messageText(event.workspace, 120) : ''
  const agent = event.agent ? messageText(event.agent, 64) : ''
  const message = event.message ? messageText(event.message) : ''
  return {
    id: event.id,
    requestedAt: event.requestedAt,
    ...(workspace ? { workspace } : {}),
    ...(agent ? { agent } : {}),
    reason: messageText(event.reason),
    ...(message ? { message } : {}),
    decision: event.decision,
    ...(event.test ? { test: true } : {})
  }
}

/** The body and headers of a message for the kind of address it goes to. */
export function webhookMessage(kind: PersonNeededWebhookKind, sent: PersonNeededEvent): { body: string; contentType: string; headers: Record<string, string> } {
  const event = boundedEvent(sent)
  const who = event.agent ? `${event.agent} needs you` : 'An agent needs you'
  const where = event.workspace ? ` in ${event.workspace}` : ''
  const asked = event.message && event.message !== event.reason ? `${event.reason} (${event.message})` : event.reason
  const line = `${event.test ? '[Test] ' : ''}${who}${where}: ${asked}`
  if (kind === 'slack') return { body: JSON.stringify({ text: `Hronaut: ${line}` }), contentType: 'application/json', headers: {} }
  // No mention in the message pings anyone.
  if (kind === 'discord') {
    return { body: JSON.stringify({ username: 'Hronaut', content: line, allowed_mentions: { parse: [] } }), contentType: 'application/json', headers: {} }
  }
  if (kind === 'ntfy') {
    // Header values stay plain ASCII; the message itself is UTF-8.
    const title = event.test ? 'Hronaut test' : 'Hronaut: an agent needs you'
    return { body: line, contentType: 'text/plain; charset=utf-8', headers: { Title: title, Tags: 'robot' } }
  }
  return {
    body: JSON.stringify({
      event: 'person-needed',
      id: event.id,
      requestedAt: event.requestedAt,
      kind: event.decision ? 'decision' : 'step',
      ...(event.workspace ? { workspace: { name: event.workspace } } : {}),
      ...(event.agent ? { agent: { name: event.agent } } : {}),
      reason: event.reason,
      ...(event.message ? { message: event.message } : {}),
      ...(event.test ? { test: true } : {})
    }),
    contentType: 'application/json',
    headers: {}
  }
}

/** The HMAC-SHA256 of the timestamp and body, so a receiver can tell the message came from this Hronaut and was not replayed. */
export function webhookSignature(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}

const DEFAULT_SETTINGS = (): PersonNeededWebhookSettings => ({ enabled: false, kind: 'json', url: '', secret: randomBytes(32).toString('base64url') })

function settingsFrom(value: unknown): PersonNeededWebhookSettings | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.enabled !== 'boolean' || !isPersonNeededWebhookKind(record.kind) || typeof record.url !== 'string'
    || typeof record.secret !== 'string' || record.secret.length < 32) return undefined
  if (record.url && webhookAddressProblem(record.url)) return undefined
  return { enabled: record.enabled && Boolean(record.url), kind: record.kind, url: record.url, secret: record.secret }
}

export interface PersonNeededWebhookOptions {
  /** The file the settings live in, readable by this user alone. */
  path: string
  userAgent: string
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  log?: (message: string) => void
}

/** What one attempt got: the status the address answered, or why it answered none. */
interface AttemptResult {
  status?: number
  error?: 'unreachable' | 'timeout'
  retryAfterMs?: number
}

/** The person's webhook: its settings, kept in a file only they can read, and the messages it sends. */
export function createPersonNeededWebhook(options: PersonNeededWebhookOptions) {
  const send = options.fetch ?? fetch
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms).unref() }))
  const now = options.now ?? Date.now
  let loaded: Promise<PersonNeededWebhookSettings> | undefined
  let writes: Promise<unknown> = Promise.resolve()

  async function write(settings: PersonNeededWebhookSettings): Promise<void> {
    await mkdir(dirname(options.path), { recursive: true, mode: 0o700 })
    const temporary = `${options.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(`${JSON.stringify(settings)}\n`, 'utf8')
    } finally {
      await file.close()
    }
    try {
      await rename(temporary, options.path)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
    await chmod(options.path, 0o600)
  }

  function settings(): Promise<PersonNeededWebhookSettings> {
    loaded ??= (async () => {
      try {
        const kept = settingsFrom(JSON.parse(await readFile(options.path, 'utf8')))
        if (kept) {
          await chmod(options.path, 0o600)
          return kept
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
      }
      const fresh = DEFAULT_SETTINGS()
      await write(fresh)
      return fresh
    })()
    loaded.catch(() => { loaded = undefined })
    return loaded
  }

  /** One attempt: the status it got, or why it got none. */
  async function attempt(settings: PersonNeededWebhookSettings, event: PersonNeededEvent): Promise<AttemptResult> {
    const message = webhookMessage(settings.kind, event)
    const timestamp = String(Math.floor(now() / 1000))
    try {
      const response = await send(settings.url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        headers: {
          ...message.headers,
          'Content-Type': message.contentType,
          'User-Agent': options.userAgent,
          'X-Hronaut-Event': event.test ? 'test' : 'person-needed',
          'X-Hronaut-Timestamp': timestamp,
          'X-Hronaut-Signature': webhookSignature(settings.secret, timestamp, message.body)
        },
        body: message.body
      })
      await response.body?.cancel().catch(() => undefined)
      const retryAfter = Number(response.headers.get('retry-after'))
      return { status: response.status, ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: Math.min(retryAfter, 60) * 1000 } : {}) }
    } catch (error) {
      return { error: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'unreachable' }
    }
  }

  const delivered = (status: number | undefined) => status !== undefined && status >= 200 && status < 300
  const retryable = (status: number | undefined) => status === undefined || status === 408 || status === 429 || status >= 500

  return {
    settings,
    /** Changes what the person chose; the signing secret stays. */
    async configure(config: PersonNeededWebhookConfig): Promise<PersonNeededWebhookSettings> {
      if (typeof config?.enabled !== 'boolean' || !isPersonNeededWebhookKind(config.kind) || typeof config.url !== 'string') {
        throw new TypeError('Invalid webhook settings')
      }
      const url = config.url.trim()
      const problem = url ? webhookAddressProblem(url) : config.enabled ? 'no-address' : undefined
      if (problem) throw new TypeError(`Invalid webhook address: ${problem}`)
      const next = writes.then(async () => {
        const current = await settings()
        const updated = { ...current, enabled: config.enabled, kind: config.kind, url }
        await write(updated)
        loaded = Promise.resolve(updated)
        return updated
      })
      writes = next.catch(() => undefined)
      return next
    },
    /** A new signing secret, for a person who shared the old one. */
    async renewSecret(): Promise<PersonNeededWebhookSettings> {
      const next = writes.then(async () => {
        const updated = { ...await settings(), secret: randomBytes(32).toString('base64url') }
        await write(updated)
        loaded = Promise.resolve(updated)
        return updated
      })
      writes = next.catch(() => undefined)
      return next
    },
    /**
     * Sends the message for an agent's request when the person turned the webhook on, trying again after 2, 10 and 30
     * seconds while the address cannot be reached, times out or answers 408, 429 or 5xx. It never throws.
     */
    async personNeeded(event: Omit<PersonNeededEvent, 'test'>): Promise<boolean> {
      try {
        const current = await settings()
        if (!current.enabled || !current.url) return false
        for (let index = 0; ; index++) {
          const result = await attempt(current, event)
          if (delivered(result.status)) return true
          const delay = PERSON_NEEDED_RETRY_DELAYS_MS[index]
          if (delay === undefined || !retryable(result.status)) {
            options.log?.(`[attention] The webhook did not take the message: ${result.status ?? result.error}`)
            return false
          }
          await sleep(Math.max(delay, result.retryAfterMs ?? 0))
          // The person may have turned it off or changed it meanwhile.
          const latest = await settings()
          if (!latest.enabled || latest.url !== current.url) return false
        }
      } catch (error) {
        options.log?.(`[attention] The webhook could not send: ${error instanceof Error ? error.message : String(error)}`)
        return false
      }
    },
    /** One test message to the address the person entered, whether or not it is on, with what came back. */
    async test(): Promise<PersonNeededWebhookTest> {
      const current = await settings()
      if (!current.url) return { ok: false, reason: 'no-address' }
      const result = await attempt(current, {
        id: randomBytes(16).toString('hex'), requestedAt: new Date(now()).toISOString(), workspace: 'Test workspace', agent: 'Hronaut',
        reason: 'This is a test message from Hronaut. Agents that need you will send messages like this one.', decision: false, test: true
      })
      if (delivered(result.status)) return { ok: true, status: result.status! }
      return result.status === undefined ? { ok: false, reason: result.error ?? 'unreachable' } : { ok: false, reason: 'refused', status: result.status }
    }
  }
}

export type PersonNeededWebhook = ReturnType<typeof createPersonNeededWebhook>
