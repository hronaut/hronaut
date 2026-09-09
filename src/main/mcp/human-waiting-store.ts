import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { HumanWaitingInput as WaitingInput, HumanWaitingRecord as WaitingRecord, HumanWaitingState as WaitingState } from '../../shared/human-waiting.js'

const inputSchema = z.object({
  workspaceId: z.uuid(),
  runId: z.uuid(),
  decision: z.enum(['review-page', 'approve-action', 'provide-input', 'resolve-unknown']),
  owner: z.string().trim().min(1).max(128),
  fallbackOwner: z.string().trim().min(1).max(128),
  timeoutMs: z.number().int().min(1).max(86_400_000),
  priorOutcome: z.enum(['NONE', 'STALE_OBSERVATION', 'OUTCOME_UNKNOWN'])
}).strict()
interface Entry { record: WaitingRecord; createdMonotonic: number; deadlineMonotonic: number }
const terminal = (state: WaitingState): boolean => ['RESOLVED', 'EXPIRED', 'CANCELLED'].includes(state)
const recordSchema = inputSchema.omit({ timeoutMs: true }).extend({
  id: z.uuid(), revision: z.uuid(),
  state: z.enum(['WAITING_FOR_HUMAN', 'ACKNOWLEDGED', 'RESOLVED', 'EXPIRED', 'CANCELLED']),
  createdAt: z.number().int().safe(), deadlineAt: z.number().int().safe(),
  notificationAttempts: z.number().int().min(0).max(3),
  notificationStatus: z.enum(['not-attempted', 'pending', 'delivered', 'failed']),
  nextAction: z.enum(['REVIEW_CURRENT_STATE', 'MAKE_FRESH_DECISION'])
}).strict().refine(record => record.deadlineAt > record.createdAt && record.deadlineAt - record.createdAt <= 86_400_000)
export const humanWaitingSnapshotSchema = z.object({
  version: z.literal(1), savedAt: z.number().int().safe(), records: z.array(recordSchema).max(1000)
}).strict()

/** Main-owned lifecycle only. Callers authorize every read/write and validate
 * fresh browser continuity before resolve. IDs grant no authority. No method
 * dispatches, retries, or claims the outcome of the original browser action.
 */
export class HumanWaitingStore {
  private readonly records = new Map<string, Entry>()
  private readonly capacity: number
  private readonly monotonicNow: () => number
  private readonly wallNow: () => number
  private lastMonotonic: number | undefined

  constructor(options: { capacity?: number; monotonicNow?: () => number; wallNow?: () => number } = {}) {
    this.capacity = z.number().int().min(1).max(1000).parse(options.capacity ?? 100)
    this.monotonicNow = options.monotonicNow ?? (() => performance.now())
    this.wallNow = options.wallNow ?? Date.now
  }

  private expire(): number {
    const now = this.monotonicNow()
    const rolledBack = this.lastMonotonic !== undefined && now < this.lastMonotonic
    for (const entry of this.records.values()) {
      if (!terminal(entry.record.state) && (!Number.isFinite(now) || rolledBack || now < entry.createdMonotonic || now >= entry.deadlineMonotonic)) {
        this.transition(entry.record, 'EXPIRED')
      }
    }
    if (Number.isFinite(now)) this.lastMonotonic = now
    return now
  }

  private transition(record: WaitingRecord, state: WaitingState): void {
    record.state = state
    record.revision = randomUUID()
    record.nextAction = terminal(state) ? 'MAKE_FRESH_DECISION' : 'REVIEW_CURRENT_STATE'
  }

  create(input: WaitingInput): WaitingRecord {
    const parsed = inputSchema.parse(input)
    const now = this.expire()
    const createdAt = this.wallNow()
    if (!Number.isFinite(now) || !Number.isSafeInteger(createdAt) || !Number.isSafeInteger(createdAt + parsed.timeoutMs)) throw new Error('Waiting clock unavailable')
    if (this.records.size >= this.capacity) {
      const retired = [...this.records].find(([, entry]) => terminal(entry.record.state))
      if (!retired) throw new Error('Human waiting capacity reached')
      this.records.delete(retired[0])
    }
    const { timeoutMs, ...metadata } = parsed
    const record: WaitingRecord = {
      ...metadata, id: randomUUID(), revision: randomUUID(), state: 'WAITING_FOR_HUMAN',
      createdAt, deadlineAt: createdAt + timeoutMs, notificationAttempts: 0,
      notificationStatus: 'not-attempted', nextAction: 'REVIEW_CURRENT_STATE'
    }
    this.records.set(record.id, { record, createdMonotonic: now, deadlineMonotonic: now + timeoutMs })
    return structuredClone(record)
  }

  list(workspaceId: string): WaitingRecord[] {
    this.expire()
    return [...this.records.values()].filter(entry => entry.record.workspaceId === workspaceId).map(entry => structuredClone(entry.record))
  }

  snapshot(): z.infer<typeof humanWaitingSnapshotSchema> {
    this.expire()
    return humanWaitingSnapshotSchema.parse({ version: 1, savedAt: this.wallNow(), records: [...this.records.values()].map(entry => entry.record) })
  }

  /** Restore only into a fresh owner. A restart never resolves or dispatches a
   * decision and invalidates pre-restart review handles. Disk errors must be
   * surfaced by the persistence owner rather than treated as an empty history.
   */
  restore(value: unknown): void {
    if (this.records.size) throw new Error('Waiting history already initialized')
    const snapshot = humanWaitingSnapshotSchema.parse(value)
    if (snapshot.records.length > this.capacity || new Set(snapshot.records.map(record => record.id)).size !== snapshot.records.length) throw new Error('Invalid waiting history capacity or duplicate record')
    const now = this.monotonicNow()
    const wall = this.wallNow()
    if (!Number.isFinite(now) || !Number.isSafeInteger(wall)) throw new Error('Waiting clock unavailable')
    const restored = snapshot.records.map(record => {
      const remaining = record.deadlineAt - wall
      if (!terminal(record.state)) {
        this.transition(record, wall < snapshot.savedAt || wall < record.createdAt || remaining <= 0 ? 'EXPIRED' : 'WAITING_FOR_HUMAN')
      } else record.nextAction = 'MAKE_FRESH_DECISION'
      return { record, createdMonotonic: now, deadlineMonotonic: now + Math.max(0, Math.min(86_400_000, remaining)) }
    })
    for (const entry of restored) this.records.set(entry.record.id, entry)
    this.lastMonotonic = now
  }

  private current(id: string, revision?: string): WaitingRecord {
    this.expire()
    const record = this.records.get(id)?.record
    if (!record || terminal(record.state) || (revision !== undefined && record.revision !== revision)) throw new Error('Waiting decision unavailable or stale')
    return record
  }

  acknowledge(id: string, revision: string): WaitingRecord {
    const record = this.current(id, revision)
    this.transition(record, 'ACKNOWLEDGED')
    return structuredClone(record)
  }

  resolve(id: string, revision: string): WaitingRecord {
    const record = this.current(id, revision)
    this.transition(record, 'RESOLVED')
    return structuredClone(record)
  }

  cancel(id: string, revision: string): WaitingRecord {
    const record = this.current(id, revision)
    this.transition(record, 'CANCELLED')
    return structuredClone(record)
  }

  invalidateResolution(id: string): void {
    const record = this.records.get(id)?.record
    if (!record || record.state !== 'RESOLVED') throw new Error('Resolved decision unavailable')
    this.transition(record, 'WAITING_FOR_HUMAN')
  }

  recordNotification(id: string, status: 'pending' | 'delivered' | 'failed'): WaitingRecord {
    const record = this.current(id)
    if (record.state !== 'WAITING_FOR_HUMAN') throw new Error('Notification no longer needed after acknowledgment')
    if (record.notificationAttempts >= 3) throw new Error('Notification attempt limit reached')
    record.notificationAttempts += 1
    record.notificationStatus = status
    return structuredClone(record)
  }

  finishNotification(id: string, status: 'delivered' | 'failed'): void {
    const record = this.records.get(id)?.record
    if (!record || record.notificationStatus !== 'pending') throw new Error('Notification attempt unavailable')
    record.notificationStatus = status
  }
}
