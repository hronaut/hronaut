import { createHash } from 'node:crypto'
import { mkdir, open } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

// This is an internal storage contract, not an MCP input schema. Callers must
// supply only registered tool names and generated identifiers, never page text.
const identifier = z.uuid()
const stateSchema = z.object({
  tabId: identifier.nullable(),
  navigationGeneration: z.number().int().nonnegative().safe(),
  originChanged: z.boolean()
}).strict()
const eventSchema = z.discriminatedUnion('phase', [
  z.object({
    phase: z.literal('verification'),
    actionId: identifier,
    verificationId: identifier,
    maxAttempts: z.number().int().min(1).max(20),
    attempt: z.number().int().min(0).max(20),
    status: z.enum(['pending', 'not-yet-visible', 'verified', 'unknown']),
    reason: z.enum(['awaiting-read', 'postcondition-matched', 'postcondition-not-visible', 'read-unavailable', 'transport-ambiguous', 'transport-failed', 'deadline', 'attempt-limit', 'context-changed', 'clock-invalid', 'cancelled'])
  }).strict(),
  z.object({
    phase: z.literal('decision'),
    scope: z.literal('workspace'),
    actionId: identifier,
    toolName: z.string().regex(/^browser_[a-z_]+$/),
    decision: z.enum(['allowed', 'denied']),
    state: stateSchema.nullable()
  }).strict(),
  z.object({
    phase: z.literal('site-access'),
    actionId: identifier.nullable(),
    decision: z.enum(['allowed', 'denied']),
    reason: z.enum(['unrestricted', 'neutral', 'matched', 'credentials', 'malformed', 'unsupported-scheme', 'no-match']),
    source: z.enum(['direct', 'page', 'redirect', 'popup', 'history', 'policy-change', 'restore']),
    // Opaque, generated within the run. Never an origin URL or matching rule.
    originId: identifier,
    state: stateSchema.nullable()
  }).strict(),
  z.object({
    phase: z.literal('outcome'),
    actionId: identifier,
    status: z.enum(['succeeded', 'failed', 'cancelled', 'interrupted', 'outcome-unknown', 'stale-observation']),
    // Failure or cancellation does not establish that a write was rolled back.
    effects: z.enum(['none', 'possible', 'confirmed']),
    siteAccessDropped: z.number().int().nonnegative().safe(),
    state: stateSchema.nullable()
  }).strict()
])
const entrySchema = z.object({
  sequence: z.number().int().positive().safe(),
  workspaceId: identifier,
  runId: identifier,
  timestamp: z.iso.datetime(),
  event: eventSchema,
  previousHash: z.string().regex(/^(?:[a-f0-9]{64})?$/),
  hash: z.string().regex(/^[a-f0-9]{64}$/)
}).strict()

export type AuditReceiptEvent = z.infer<typeof eventSchema>
export type AuditObservedState = z.infer<typeof stateSchema> | null
export type AuditReceipt = z.infer<typeof entrySchema>

export interface AuditReceiptStoreOptions {
  path: string
  workspaceId: string
  runId: string
  toolNames: ReadonlySet<string>
  maxEntries?: number
  maxBytes?: number
}

function digest(body: Omit<AuditReceipt, 'hash'>): string {
  // Schemas reconstruct objects in a fixed order before hashing or verifying.
  return createHash('sha256').update('hronaut-action-receipt-v1\0').update(JSON.stringify(body)).digest('hex')
}

function transition(actions: Map<string, AuditReceiptEvent>, event: AuditReceiptEvent): void {
  if (event.phase === 'verification') {
    const key = `verification:${event.actionId}`
    const previous = actions.get(key)
    const action = actions.get(event.actionId)
    const invalid = (): never => { throw new Error('Invalid audit receipt transition') }
    if (event.attempt > event.maxAttempts) invalid()
    if (!previous) {
      if (action?.phase !== 'decision' || action.decision !== 'allowed' || event.status !== 'pending' || event.reason !== 'awaiting-read' || event.attempt !== 0) invalid()
    } else {
      if (previous.phase !== 'verification') return invalid()
      if (previous.status === 'verified' || previous.status === 'unknown'
        || event.verificationId !== previous.verificationId || event.maxAttempts !== previous.maxAttempts
        || event.status === 'pending') invalid()
      if (event.status === 'unknown') {
        if (['awaiting-read', 'postcondition-matched', 'postcondition-not-visible'].includes(event.reason)
          || event.attempt < previous.attempt || event.attempt > previous.attempt + 1) invalid()
      } else {
        if (action?.phase !== 'outcome' || action.status !== 'succeeded' || event.attempt !== previous.attempt + 1
          || event.reason !== (event.status === 'verified' ? 'postcondition-matched' : 'postcondition-not-visible')) invalid()
      }
    }
    actions.set(key, event)
    return
  }
  if (event.phase === 'site-access') {
    if (event.actionId === null) return
    const action = actions.get(event.actionId)
    if (action?.phase !== 'decision' || action.decision !== 'allowed') throw new Error('Invalid audit receipt transition')
    return
  }
  const previous = actions.get(event.actionId)
  if (event.phase === 'decision' ? previous !== undefined : (
    previous?.phase !== 'decision' || previous.decision !== 'allowed'
  )) throw new Error('Invalid audit receipt transition')
  actions.set(event.actionId, event)
}

/** One main-process owner per run. Existing receipts are never rewritten.
 * Capacity exhaustion stops appends; the caller must stop recording explicitly,
 * rather than silently discard earlier evidence or retry an agent action.
 */
export class AuditReceiptStore {
  private queue: Promise<void> = Promise.resolve()
  private readonly options: AuditReceiptStoreOptions
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly outcomeReservationBytes: number
  private readonly verificationReservationBytes: number

  constructor(options: AuditReceiptStoreOptions) {
    identifier.parse(options.workspaceId)
    identifier.parse(options.runId)
    this.maxEntries = z.number().int().min(2).max(10_000).parse(options.maxEntries ?? 1_000)
    this.maxBytes = z.number().int().min(1_024).max(10_485_760).parse(options.maxBytes ?? 1_048_576)
    this.options = { ...options, toolNames: new Set(options.toolNames) }
    // Reserve the largest valid outcome envelope, including a full predecessor
    // hash and the largest sequence/document generation. This survives reopen
    // and does not rely on the eventual outcome resembling the decision state.
    this.outcomeReservationBytes = Buffer.byteLength(JSON.stringify({
      sequence: this.maxEntries,
      workspaceId: options.workspaceId,
      runId: options.runId,
      timestamp: '9999-12-31T23:59:59.999Z',
      event: {
        phase: 'outcome', actionId: options.runId, status: 'stale-observation', effects: 'confirmed',
        siteAccessDropped: Number.MAX_SAFE_INTEGER,
        state: { tabId: options.runId, navigationGeneration: Number.MAX_SAFE_INTEGER, originChanged: false }
      },
      previousHash: 'f'.repeat(64), hash: 'f'.repeat(64)
    }) + '\n')
    this.verificationReservationBytes = Buffer.byteLength(JSON.stringify({
      sequence: this.maxEntries, workspaceId: options.workspaceId, runId: options.runId,
      timestamp: '9999-12-31T23:59:59.999Z',
      event: { phase: 'verification', actionId: options.runId, verificationId: options.runId, maxAttempts: 20, attempt: 20, status: 'verified', reason: 'postcondition-matched' },
      previousHash: 'f'.repeat(64), hash: 'f'.repeat(64)
    }) + '\n')
  }

  append(input: AuditReceiptEvent): Promise<AuditReceipt> {
    // Validate and snapshot before queueing so a caller cannot mutate a queued
    // record into an unvalidated payload. Error messages omit supplied values.
    let event: AuditReceiptEvent
    try {
      event = eventSchema.parse(input)
      if (event.phase === 'decision' && !this.options.toolNames.has(event.toolName)) throw new Error()
    } catch {
      return Promise.reject(new Error('Invalid audit receipt event'))
    }
    return this.exclusive(async () => {
      const { entries, bytes, actions } = await this.readVerified()
      transition(actions, event)
      const pending = [...actions.values()].filter(action => action.phase === 'decision' && action.decision === 'allowed').length
      const pendingVerification = [...actions.values()].filter(action => action.phase === 'verification' && (action.status === 'pending' || action.status === 'not-yet-visible')).length
      if (entries.length + 1 + pending + pendingVerification > this.maxEntries) throw new Error('Audit receipt capacity reached')
      const body = {
        sequence: entries.length + 1,
        workspaceId: this.options.workspaceId,
        runId: this.options.runId,
        timestamp: new Date().toISOString(),
        event,
        previousHash: entries.at(-1)?.hash ?? ''
      }
      const entry = { ...body, hash: digest(body) }
      const line = `${JSON.stringify(entry)}\n`
      if (bytes + Buffer.byteLength(line) + pending * this.outcomeReservationBytes + pendingVerification * this.verificationReservationBytes > this.maxBytes) {
        throw new Error('Audit receipt capacity reached')
      }
      await mkdir(dirname(this.options.path), { recursive: true, mode: 0o700 })
      const handle = await open(this.options.path, 'a', 0o600)
      try {
        await handle.writeFile(line)
        await handle.sync()
      } finally {
        await handle.close()
      }
      return structuredClone(entry)
    })
  }

  read(): Promise<AuditReceipt[]> {
    return this.exclusive(async () => (await this.readVerified()).entries)
  }

  private async readVerified(): Promise<{ entries: AuditReceipt[]; bytes: number; actions: Map<string, AuditReceiptEvent> }> {
    const actions = new Map<string, AuditReceiptEvent>()
    let handle
    try {
      handle = await open(this.options.path, 'r')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [], bytes: 0, actions }
      throw new Error('Audit receipt history is unavailable')
    }
    try {
      const buffer = Buffer.alloc(this.maxBytes + 1)
      let bytes = 0
      while (bytes < buffer.length) {
        const read = await handle.read(buffer, bytes, buffer.length - bytes, bytes)
        if (read.bytesRead === 0) break
        bytes += read.bytesRead
      }
      if (bytes > this.maxBytes) throw new Error()
      const text = buffer.subarray(0, bytes).toString('utf8')
      if (!text) return { entries: [], bytes, actions }
      // A partial last line is evidence of interrupted persistence, not an
      // invitation to overwrite or silently repair history.
      if (!text.endsWith('\n')) throw new Error()
      const lines = text.slice(0, -1).split('\n')
      if (lines.length > this.maxEntries) throw new Error()
      const entries: AuditReceipt[] = []
      for (const line of lines) {
        const entry = entrySchema.parse(JSON.parse(line))
        const { hash, ...body } = entry
        if (entry.workspaceId !== this.options.workspaceId || entry.runId !== this.options.runId
          || entry.sequence !== entries.length + 1 || entry.previousHash !== (entries.at(-1)?.hash ?? '')
          || hash !== digest(body)
          || (entry.event.phase === 'decision' && !this.options.toolNames.has(entry.event.toolName))) throw new Error()
        transition(actions, entry.event)
        entries.push(entry)
      }
      return { entries, bytes, actions }
    } catch {
      throw new Error('Audit receipt history verification failed')
    } finally {
      await handle.close()
    }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }
}
