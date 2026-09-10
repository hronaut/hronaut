import { randomUUID } from 'node:crypto'
import { z } from 'zod'

const idSchema = z.uuid().transform(value => value.toLowerCase())
const checkIdSchema = z.string().trim().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/)
const checkDefinitionSchema = z.discriminatedUnion('type', [
  z.object({ id: checkIdSchema, type: z.literal('page-settled'), tabId: idSchema }).strict(),
  z.object({ id: checkIdSchema, type: z.literal('expected-origin'), tabId: idSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ id: checkIdSchema, type: z.literal('audit-run'), artifactId: idSchema }).strict()
])
const checkStatusSchema = z.enum(['PENDING', 'PASS', 'FAIL', 'UNAVAILABLE'])
const stateSchema = z.enum(['RUNNING', 'VERIFYING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'TIMED_OUT', 'OUTCOME_UNKNOWN'])
const terminalReasonSchema = z.enum([
  'CALLER_REPORTED_FAILURE', 'CALLER_REPORTED_BLOCKED', 'CALLER_REPORTED_UNKNOWN',
  'COMPLETION_CHECK_FAILED', 'COMPLETION_EVIDENCE_UNAVAILABLE',
  'COMPLETION_CONTEXT_CHANGED', 'HEARTBEAT_EXPIRED', 'DEADLINE_REACHED', 'CLOCK_INVALID', 'RESTART'
])
const storedCheckSchema = checkDefinitionSchema.and(z.object({ status: checkStatusSchema }).strict())
const storedRecordSchema = z.object({
  id: idSchema,
  revision: idSchema,
  workspaceId: idSchema,
  state: stateSchema,
  terminalReason: terminalReasonSchema.nullable(),
  createdAt: z.number().int().safe(),
  updatedAt: z.number().int().safe(),
  deadlineAt: z.number().int().safe(),
  heartbeatDueAt: z.number().int().safe(),
  heartbeatTimeoutMs: z.number().int().min(1).max(86_400_000),
  checks: z.array(storedCheckSchema).max(8)
}).strict().superRefine((record, context) => {
  if (record.updatedAt < record.createdAt) {
    context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'Invalid task-run update time' })
  }
  if (record.deadlineAt <= record.createdAt || record.deadlineAt - record.createdAt > 604_800_000) {
    context.addIssue({ code: 'custom', path: ['deadlineAt'], message: 'Invalid task-run deadline' })
  }
  if (record.heartbeatDueAt < record.createdAt || record.heartbeatDueAt > record.deadlineAt) {
    context.addIssue({ code: 'custom', path: ['heartbeatDueAt'], message: 'Invalid task-run heartbeat deadline' })
  }
  if ((['RUNNING', 'VERIFYING', 'SUCCEEDED'].includes(record.state) && record.terminalReason !== null)
    || (!['RUNNING', 'VERIFYING', 'SUCCEEDED'].includes(record.state) && record.terminalReason === null)) {
    context.addIssue({ code: 'custom', path: ['terminalReason'], message: 'Invalid task-run terminal state' })
  }
  if (new Set(record.checks.map(check => check.id)).size !== record.checks.length) {
    context.addIssue({ code: 'custom', path: ['checks'], message: 'Duplicate task-run check ID' })
  }
  if (record.state === 'RUNNING' && record.checks.some(check => check.status !== 'PENDING')) {
    context.addIssue({ code: 'custom', path: ['checks'], message: 'Running task-run checks must be pending' })
  }
  if (['VERIFYING', 'SUCCEEDED'].includes(record.state)
    && (!record.checks.length || record.checks.some(check => check.status !== 'PASS'))) {
    context.addIssue({ code: 'custom', path: ['checks'], message: 'Successful task-run checks must all pass' })
  }
})

export const taskRunSnapshotSchema = z.object({
  version: z.literal(1),
  savedAt: z.number().int().safe(),
  records: z.array(storedRecordSchema).max(1000)
}).strict()

export type TaskRunCheckDefinition = z.infer<typeof checkDefinitionSchema>
type StoredRecord = z.infer<typeof storedRecordSchema>
type TaskRunState = z.infer<typeof stateSchema>
type TerminalReason = z.infer<typeof terminalReasonSchema>
type CheckStatus = z.infer<typeof checkStatusSchema>

export interface TaskRunSummary {
  id: string
  revision: string
  workspaceId: string
  state: TaskRunState
  terminalReason: TerminalReason | null
  createdAt: number
  updatedAt: number
  deadlineAt: number
  heartbeatDueAt: number
  checks: Array<{
    id: string
    type: TaskRunCheckDefinition['type']
    status: CheckStatus
    tabId?: string
    artifactId?: string
  }>
}

interface Entry {
  record: StoredRecord
  deadlineMonotonic: number
  heartbeatDueMonotonic: number
}

const terminal = (state: TaskRunState): boolean => state !== 'RUNNING' && state !== 'VERIFYING'

/** Main-owned bounded lifecycle. Callers authorize workspace access and evaluate
 * completion checks outside this store. IDs and revisions grant no authority.
 */
export class TaskRunStore {
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

  create(input: {
    workspaceId: string
    deadlineMs: number
    heartbeatTimeoutMs: number
    checks: TaskRunCheckDefinition[]
  }): TaskRunSummary {
    const parsed = z.object({
      workspaceId: idSchema,
      deadlineMs: z.number().int().min(1).max(604_800_000),
      heartbeatTimeoutMs: z.number().int().min(1).max(86_400_000),
      checks: z.array(checkDefinitionSchema).max(8)
    }).strict().parse(input)
    if (new Set(parsed.checks.map(check => check.id)).size !== parsed.checks.length) throw new Error('Duplicate task-run check ID')
    const monotonic = this.expire()
    const wall = this.wallNow()
    if (!Number.isFinite(monotonic) || !Number.isSafeInteger(wall)
      || !Number.isSafeInteger(wall + parsed.deadlineMs)) throw new Error('Task-run clock unavailable')
    if (this.records.size >= this.capacity) {
      const retired = [...this.records].find(([, entry]) => terminal(entry.record.state))
      if (!retired) throw new Error('Task-run capacity reached')
      this.records.delete(retired[0])
    }
    const heartbeatMs = Math.min(parsed.heartbeatTimeoutMs, parsed.deadlineMs)
    const record: StoredRecord = {
      id: randomUUID(), revision: randomUUID(), workspaceId: parsed.workspaceId,
      state: 'RUNNING', terminalReason: null,
      createdAt: wall, updatedAt: wall, deadlineAt: wall + parsed.deadlineMs,
      heartbeatDueAt: wall + heartbeatMs, heartbeatTimeoutMs: parsed.heartbeatTimeoutMs,
      checks: parsed.checks.map(check => ({ ...check, status: 'PENDING' }))
    }
    this.records.set(record.id, {
      record,
      deadlineMonotonic: monotonic + parsed.deadlineMs,
      heartbeatDueMonotonic: monotonic + heartbeatMs
    })
    return this.publicRecord(record)
  }

  heartbeat(id: string, revision: string): TaskRunSummary {
    const entry = this.current(id, revision)
    const monotonic = this.lastMonotonic!
    const remaining = Math.max(0, entry.deadlineMonotonic - monotonic)
    const extension = Math.min(entry.record.heartbeatTimeoutMs, remaining)
    const wall = this.checkedWall()
    entry.heartbeatDueMonotonic = monotonic + extension
    entry.record.heartbeatDueAt = Math.min(entry.record.deadlineAt, wall + extension)
    this.touch(entry.record, wall)
    return this.publicRecord(entry.record)
  }

  complete(id: string, revision: string, requested: 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'OUTCOME_UNKNOWN',
    evidence: Array<{ id: string; status: Exclude<CheckStatus, 'PENDING'> }>): TaskRunSummary {
    const entry = this.current(id, revision)
    if (requested !== 'SUCCEEDED') {
      if (evidence.length) throw new Error('Completion evidence is accepted only for a success claim')
      const reason: TerminalReason = requested === 'FAILED' ? 'CALLER_REPORTED_FAILURE'
        : requested === 'BLOCKED' ? 'CALLER_REPORTED_BLOCKED' : 'CALLER_REPORTED_UNKNOWN'
      this.transition(entry.record, requested, reason)
      return this.publicRecord(entry.record)
    }
    if (!entry.record.checks.length) throw new Error('A successful task run requires at least one machine-checkable completion check')
    const parsed = z.array(z.object({
      id: checkIdSchema,
      status: checkStatusSchema.exclude(['PENDING'])
    }).strict()).max(8).parse(evidence)
    if (new Set(parsed.map(result => result.id)).size !== parsed.length
      || parsed.length !== entry.record.checks.length
      || entry.record.checks.some(check => !parsed.some(result => result.id === check.id))) {
      throw new Error('Completion evidence must cover every configured check exactly once')
    }
    const wall = this.checkedWall()
    for (const check of entry.record.checks) check.status = parsed.find(result => result.id === check.id)!.status
    if (entry.record.checks.some(check => check.status === 'UNAVAILABLE')) {
      this.transition(entry.record, 'OUTCOME_UNKNOWN', 'COMPLETION_EVIDENCE_UNAVAILABLE', wall)
    } else if (entry.record.checks.some(check => check.status === 'FAIL')) {
      this.transition(entry.record, 'BLOCKED', 'COMPLETION_CHECK_FAILED', wall)
    } else {
      entry.record.state = 'VERIFYING'
      entry.record.terminalReason = null
      this.touch(entry.record, wall)
    }
    return this.publicRecord(entry.record)
  }

  confirmSuccess(id: string, revision: string): TaskRunSummary {
    this.expire()
    const entry = this.records.get(idSchema.parse(id))
    if (!entry || entry.record.state !== 'VERIFYING' || entry.record.revision !== idSchema.parse(revision)) {
      throw new Error('Verifying task run is unavailable or stale')
    }
    this.transition(entry.record, 'SUCCEEDED', null)
    return this.publicRecord(entry.record)
  }

  invalidateVerification(id: string, revision: string): TaskRunSummary {
    this.expire()
    const entry = this.records.get(idSchema.parse(id))
    if (!entry || entry.record.state !== 'VERIFYING' || entry.record.revision !== idSchema.parse(revision)) {
      throw new Error('Verifying task run is unavailable or stale')
    }
    this.transition(entry.record, 'OUTCOME_UNKNOWN', 'COMPLETION_CONTEXT_CHANGED')
    return this.publicRecord(entry.record)
  }

  get(id: string): TaskRunSummary {
    this.expire()
    const record = this.records.get(idSchema.parse(id))?.record
    if (!record) throw new Error('Task run is unavailable')
    return this.publicRecord(record)
  }

  list(workspaceId: string): TaskRunSummary[] {
    this.expire()
    const workspace = idSchema.parse(workspaceId)
    return [...this.records.values()].filter(entry => entry.record.workspaceId === workspace)
      .map(entry => this.publicRecord(entry.record))
  }

  completionChecks(id: string, revision: string): TaskRunCheckDefinition[] {
    return structuredClone(this.current(id, revision).record.checks.map(({ status: _status, ...check }) => check))
  }

  snapshot(): z.infer<typeof taskRunSnapshotSchema> {
    this.expire()
    return taskRunSnapshotSchema.parse({
      version: 1,
      savedAt: this.checkedWall(),
      records: [...this.records.values()].map(entry => entry.record)
    })
  }

  restore(value: unknown): void {
    if (this.records.size) throw new Error('Task-run history already initialized')
    const snapshot = taskRunSnapshotSchema.parse(value)
    if (snapshot.records.length > this.capacity
      || new Set(snapshot.records.map(record => record.id)).size !== snapshot.records.length) {
      throw new Error('Invalid task-run history capacity or duplicate record')
    }
    const monotonic = this.monotonicNow()
    const wall = this.wallNow()
    if (!Number.isFinite(monotonic) || !Number.isSafeInteger(wall)) throw new Error('Task-run clock unavailable')
    for (const candidate of snapshot.records) {
      const record = structuredClone(candidate)
      if (record.state === 'RUNNING' || record.state === 'VERIFYING') this.transition(record, 'OUTCOME_UNKNOWN', 'RESTART')
      const deadlineRemaining = Math.max(0, Math.min(604_800_000, record.deadlineAt - wall))
      const heartbeatRemaining = Math.max(0, Math.min(deadlineRemaining, record.heartbeatDueAt - wall))
      this.records.set(record.id, {
        record,
        deadlineMonotonic: monotonic + deadlineRemaining,
        heartbeatDueMonotonic: monotonic + heartbeatRemaining
      })
    }
    this.lastMonotonic = monotonic
  }

  private current(id: string, revision: string): Entry {
    this.expire()
    const entry = this.records.get(idSchema.parse(id))
    if (!entry || entry.record.state !== 'RUNNING' || entry.record.revision !== idSchema.parse(revision)) {
      throw new Error('Task run is unavailable or stale')
    }
    return entry
  }

  private expire(): number {
    const monotonic = this.monotonicNow()
    const rolledBack = this.lastMonotonic !== undefined && monotonic < this.lastMonotonic
    if (!Number.isFinite(monotonic) || rolledBack) {
      for (const entry of this.records.values()) {
        if (entry.record.state === 'RUNNING' || entry.record.state === 'VERIFYING') {
          this.transition(entry.record, 'OUTCOME_UNKNOWN', 'CLOCK_INVALID')
        }
      }
    } else {
      for (const entry of this.records.values()) {
        if (entry.record.state !== 'RUNNING') continue
        if (monotonic >= entry.deadlineMonotonic) this.transition(entry.record, 'TIMED_OUT', 'DEADLINE_REACHED')
        else if (monotonic >= entry.heartbeatDueMonotonic) this.transition(entry.record, 'TIMED_OUT', 'HEARTBEAT_EXPIRED')
      }
      this.lastMonotonic = monotonic
    }
    return monotonic
  }

  private checkedWall(): number {
    const wall = this.wallNow()
    if (!Number.isSafeInteger(wall)) throw new Error('Task-run clock unavailable')
    return wall
  }

  private touch(record: StoredRecord, wall = this.checkedWall()): void {
    record.revision = randomUUID()
    record.updatedAt = wall
  }

  private transition(record: StoredRecord, state: Exclude<TaskRunState, 'RUNNING'>,
    reason: TerminalReason | null, wall = this.checkedWall()): void {
    record.state = state
    record.terminalReason = reason
    this.touch(record, wall)
  }

  private publicRecord(record: StoredRecord): TaskRunSummary {
    return structuredClone({
      id: record.id,
      revision: record.revision,
      workspaceId: record.workspaceId,
      state: record.state,
      terminalReason: record.terminalReason,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deadlineAt: record.deadlineAt,
      heartbeatDueAt: record.heartbeatDueAt,
      checks: record.checks.map(check => ({
        id: check.id,
        type: check.type,
        status: check.status,
        ...('tabId' in check ? { tabId: check.tabId } : {}),
        ...('artifactId' in check ? { artifactId: check.artifactId } : {})
      }))
    })
  }
}
