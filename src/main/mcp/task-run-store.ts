import { randomUUID } from 'node:crypto'
import { z } from 'zod'

const idSchema = z.uuid().transform(value => value.toLowerCase())
const checkIdSchema = z.string().trim().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/)
const checkDefinitionSchema = z.discriminatedUnion('type', [
  z.object({ id: checkIdSchema, type: z.literal('page-settled'), tabId: idSchema }).strict(),
  z.object({ id: checkIdSchema, type: z.literal('expected-origin'), tabId: idSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ id: checkIdSchema, type: z.literal('audit-run'), artifactId: idSchema }).strict(),
  z.object({
    id: checkIdSchema,
    type: z.literal('context-binding'),
    tabId: idSchema,
    navigationGeneration: z.number().int().nonnegative().safe(),
    observationGeneration: z.number().int().nonnegative().safe(),
    originFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    controlFingerprint: z.string().regex(/^[a-f0-9]{64}$/)
  }).strict()
])
const checkStatusSchema = z.enum(['PENDING', 'PASS', 'FAIL', 'UNAVAILABLE'])
const stateSchema = z.enum(['RUNNING', 'VERIFYING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'BLOCKED', 'TIMED_OUT', 'OUTCOME_UNKNOWN'])
const terminalReasonSchema = z.enum([
  'CALLER_REPORTED_FAILURE', 'CALLER_REPORTED_CANCELLED', 'CALLER_REPORTED_BLOCKED', 'CALLER_REPORTED_UNKNOWN',
  'COMPLETION_CHECK_FAILED', 'COMPLETION_EVIDENCE_UNAVAILABLE',
  'COMPLETION_CONTEXT_CHANGED', 'TASK_CONTEXT_STALE', 'TASK_CONTEXT_UNAVAILABLE',
  'HEARTBEAT_EXPIRED', 'DEADLINE_REACHED', 'CLOCK_INVALID', 'RESTART'
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
  taskDefinition: z.object({
    id: idSchema,
    revision: idSchema,
    approvalRequired: z.boolean()
  }).strict().optional(),
  checks: z.array(storedCheckSchema).max(9)
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

const taskInputSchema = z.object({
  name: z.string().trim().min(1).max(32).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/),
  type: z.enum(['string', 'number', 'boolean']),
  required: z.boolean(),
  sensitive: z.boolean()
}).strict()
const taskStepSchema = z.object({
  id: checkIdSchema,
  kind: z.enum(['read-only', 'review-gated', 'mutation']),
  capability: z.string().trim().min(1).max(64).regex(/^(browser|wallet)_[a-z0-9_]+$/),
  humanGate: z.boolean()
}).strict().superRefine((step, context) => {
  if (step.humanGate !== (step.kind !== 'read-only')) {
    context.addIssue({ code: 'custom', path: ['humanGate'], message: 'Review and mutation steps require a human gate; read-only steps cannot claim one' })
  }
})
const taskEvidenceSchema = z.object({
  id: checkIdSchema,
  type: z.enum(['page-settled', 'expected-origin'])
}).strict()
const savedTaskSchema = z.object({
  id: idSchema,
  revision: idSchema,
  workspaceId: idSchema,
  name: z.string().trim().min(1).max(80),
  intent: z.string().trim().min(1).max(280),
  inputs: z.array(taskInputSchema).max(12),
  steps: z.array(taskStepSchema).min(1).max(16),
  evidence: z.array(taskEvidenceSchema).min(1).max(8),
  retryPolicy: z.object({ maxAttempts: z.number().int().min(1).max(3), retryable: z.literal('read-only-only') }).strict(),
  createdAt: z.number().int().safe(),
  updatedAt: z.number().int().safe()
}).strict().superRefine((task, context) => {
  for (const [path, values] of [
    ['inputs', task.inputs.map(input => input.name)],
    ['steps', task.steps.map(step => step.id)],
    ['evidence', task.evidence.map(evidence => evidence.id)]
  ] as const) {
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', path: [path], message: `Duplicate task ${path} identifier` })
  }
  if (task.evidence.some(evidence => evidence.id === 'task_context')) {
    context.addIssue({ code: 'custom', path: ['evidence'], message: 'task_context is reserved for the bound browser context check' })
  }
  if (task.updatedAt < task.createdAt) context.addIssue({ code: 'custom', path: ['updatedAt'], message: 'Invalid saved-task update time' })
})

const currentSnapshotSchema = z.object({
  version: z.literal(2),
  savedAt: z.number().int().safe(),
  records: z.array(storedRecordSchema).max(1000),
  tasks: z.array(savedTaskSchema).max(50)
}).strict()

export const taskRunSnapshotSchema = z.preprocess(value => {
  if (value && typeof value === 'object' && 'version' in value && value.version === 1) {
    return { ...value, version: 2, tasks: [] }
  }
  return value
}, currentSnapshotSchema)

export type TaskRunCheckDefinition = z.infer<typeof checkDefinitionSchema>
type StoredRecord = z.infer<typeof storedRecordSchema>
type TaskRunState = z.infer<typeof stateSchema>
type TerminalReason = z.infer<typeof terminalReasonSchema>
type CheckStatus = z.infer<typeof checkStatusSchema>
export type TaskRunOutcome = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'blocked' | 'timed-out'
  | 'verifier-rejected' | 'stale-context' | 'reconciliation-required' | 'outcome-unknown'
export type SavedTaskDefinition = z.infer<typeof savedTaskSchema>
export type SavedTaskInput = z.infer<typeof taskInputSchema>
export type SavedTaskStep = z.infer<typeof taskStepSchema>
export type SavedTaskEvidence = z.infer<typeof taskEvidenceSchema>

export interface TaskRunSummary {
  id: string
  revision: string
  workspaceId: string
  state: TaskRunState
  terminalReason: TerminalReason | null
  /** Stable presentation taxonomy. Existing state and terminalReason fields are
   * retained for backward compatibility. */
  outcome: TaskRunOutcome
  reasonCode: TerminalReason | null
  evidenceSource: 'caller-supplied' | 'hronaut-observed'
  /** A task-run contract does not observe every browser side effect in the
   * caller's wider workflow, so terminal state must never imply rollback. */
  effects: 'not-established'
  createdAt: number
  updatedAt: number
  deadlineAt: number
  heartbeatDueAt: number
  taskDefinition?: { id: string; revision: string; approvalRequired: boolean }
  receipt?: {
    formatVersion: 1
    taskDefinitionId: string
    taskRevision: string
    context: { tabId: string; navigationGeneration: number; observationGeneration: number }
    approvalState: 'required' | 'not-required'
    authoritativeResult: { outcome: TaskRunOutcome; reasonCode: TerminalReason | null; evidenceSource: 'caller-supplied' | 'hronaut-observed' }
  }
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
  private readonly tasks = new Map<string, SavedTaskDefinition>()
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
    taskDefinition?: { id: string; revision: string; approvalRequired: boolean }
  }): TaskRunSummary {
    const parsed = z.object({
      workspaceId: idSchema,
      deadlineMs: z.number().int().min(1).max(604_800_000),
      heartbeatTimeoutMs: z.number().int().min(1).max(86_400_000),
      checks: z.array(checkDefinitionSchema).max(9),
      taskDefinition: z.object({ id: idSchema, revision: idSchema, approvalRequired: z.boolean() }).strict().optional()
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
      ...(parsed.taskDefinition ? { taskDefinition: parsed.taskDefinition } : {}),
      checks: parsed.checks.map(check => ({ ...check, status: 'PENDING' }))
    }
    this.records.set(record.id, {
      record,
      deadlineMonotonic: monotonic + parsed.deadlineMs,
      heartbeatDueMonotonic: monotonic + heartbeatMs
    })
    return this.publicRecord(record)
  }

  saveTask(input: {
    workspaceId: string
    name: string
    intent: string
    inputs: SavedTaskInput[]
    steps: SavedTaskStep[]
    evidence: SavedTaskEvidence[]
    retryPolicy: SavedTaskDefinition['retryPolicy']
  }): SavedTaskDefinition {
    const wall = this.checkedWall()
    const task = savedTaskSchema.parse({
      ...structuredClone(input),
      id: randomUUID(),
      revision: randomUUID(),
      createdAt: wall,
      updatedAt: wall
    })
    if (this.tasks.size >= 50) throw new Error('Saved-task capacity reached')
    this.tasks.set(task.id, task)
    return structuredClone(task)
  }

  getTask(id: string): SavedTaskDefinition {
    const task = this.tasks.get(idSchema.parse(id))
    if (!task) throw new Error('Saved task is unavailable')
    return structuredClone(task)
  }

  listTasks(workspaceId: string): SavedTaskDefinition[] {
    const workspace = idSchema.parse(workspaceId)
    return [...this.tasks.values()].filter(task => task.workspaceId === workspace).map(task => structuredClone(task))
  }

  deleteTask(id: string, revision: string): SavedTaskDefinition {
    const parsedId = idSchema.parse(id)
    const task = this.tasks.get(parsedId)
    if (!task || task.revision !== idSchema.parse(revision)) throw new Error('Saved task is unavailable or stale')
    this.tasks.delete(parsedId)
    return structuredClone(task)
  }

  heartbeat(id: string, revision: string,
    contextEvidence: Array<{ id: string; status: Exclude<CheckStatus, 'PENDING'> }> = []): TaskRunSummary {
    const entry = this.current(id, revision)
    const contextChecks = entry.record.checks.filter(check => check.type === 'context-binding')
    if (contextEvidence.length || contextChecks.length) {
      const parsed = z.array(z.object({
        id: checkIdSchema,
        status: checkStatusSchema.exclude(['PENDING'])
      }).strict()).max(1).parse(contextEvidence)
      if (parsed.length !== contextChecks.length
        || contextChecks.some(check => !parsed.some(result => result.id === check.id))) {
        throw new Error('Context evidence must cover the bound task context exactly once')
      }
      const result = parsed[0]
      const contextCheck = contextChecks[0]
      if (!result || !contextCheck) throw new Error('Bound task context evidence is unavailable')
      if (result.status !== 'PASS') {
        const wall = this.checkedWall()
        contextCheck.status = result.status
        this.transition(entry.record, result.status === 'UNAVAILABLE' ? 'OUTCOME_UNKNOWN' : 'BLOCKED',
          result.status === 'UNAVAILABLE' ? 'TASK_CONTEXT_UNAVAILABLE' : 'TASK_CONTEXT_STALE', wall)
        return this.publicRecord(entry.record)
      }
    }
    const monotonic = this.lastMonotonic!
    const remaining = Math.max(0, entry.deadlineMonotonic - monotonic)
    const extension = Math.min(entry.record.heartbeatTimeoutMs, remaining)
    this.checkedWall()
    // Derive durable wall timestamps from the monotonic deadline established at
    // admission. A system-clock correction must not make the persisted heartbeat
    // precede its run or corrupt the entire task-run snapshot.
    const wall = Math.round(entry.record.deadlineAt - remaining)
    entry.heartbeatDueMonotonic = monotonic + extension
    entry.record.heartbeatDueAt = Math.min(entry.record.deadlineAt, wall + extension)
    this.touch(entry.record, wall)
    return this.publicRecord(entry.record)
  }

  complete(id: string, revision: string, requested: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'BLOCKED' | 'OUTCOME_UNKNOWN',
    evidence: Array<{ id: string; status: Exclude<CheckStatus, 'PENDING'> }>): TaskRunSummary {
    const entry = this.current(id, revision)
    if (requested !== 'SUCCEEDED') {
      if (evidence.length) throw new Error('Completion evidence is accepted only for a success claim')
      const reason: TerminalReason = requested === 'FAILED' ? 'CALLER_REPORTED_FAILURE'
        : requested === 'CANCELLED' ? 'CALLER_REPORTED_CANCELLED'
          : requested === 'BLOCKED' ? 'CALLER_REPORTED_BLOCKED' : 'CALLER_REPORTED_UNKNOWN'
      this.transition(entry.record, requested, reason)
      return this.publicRecord(entry.record)
    }
    if (!entry.record.checks.length) throw new Error('A successful task run requires at least one machine-checkable completion check')
    const parsed = z.array(z.object({
      id: checkIdSchema,
      status: checkStatusSchema.exclude(['PENDING'])
    }).strict()).max(9).parse(evidence)
    if (new Set(parsed.map(result => result.id)).size !== parsed.length
      || parsed.length !== entry.record.checks.length
      || entry.record.checks.some(check => !parsed.some(result => result.id === check.id))) {
      throw new Error('Completion evidence must cover every configured check exactly once')
    }
    const wall = this.checkedWall()
    for (const check of entry.record.checks) check.status = parsed.find(result => result.id === check.id)!.status
    const contextCheck = entry.record.checks.find(check => check.type === 'context-binding')
    if (contextCheck?.status === 'UNAVAILABLE') {
      this.transition(entry.record, 'OUTCOME_UNKNOWN', 'TASK_CONTEXT_UNAVAILABLE', wall)
    } else if (contextCheck?.status === 'FAIL') {
      this.transition(entry.record, 'BLOCKED', 'TASK_CONTEXT_STALE', wall)
    } else if (entry.record.checks.some(check => check.status === 'UNAVAILABLE')) {
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
      version: 2,
      savedAt: this.checkedWall(),
      records: [...this.records.values()].map(entry => entry.record),
      tasks: [...this.tasks.values()]
    })
  }

  restore(value: unknown): void {
    if (this.records.size) throw new Error('Task-run history already initialized')
    const snapshot = taskRunSnapshotSchema.parse(value)
    if (snapshot.records.length > this.capacity
      || new Set(snapshot.records.map(record => record.id)).size !== snapshot.records.length) {
      throw new Error('Invalid task-run history capacity or duplicate record')
    }
    if (new Set(snapshot.tasks.map(task => task.id)).size !== snapshot.tasks.length) {
      throw new Error('Invalid saved-task history or duplicate task')
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
    for (const task of snapshot.tasks) this.tasks.set(task.id, structuredClone(task))
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
    record.updatedAt = Math.max(record.createdAt, record.updatedAt, wall)
  }

  private transition(record: StoredRecord, state: Exclude<TaskRunState, 'RUNNING'>,
    reason: TerminalReason | null, wall = this.checkedWall()): void {
    record.state = state
    record.terminalReason = reason
    this.touch(record, wall)
  }

  private publicRecord(record: StoredRecord): TaskRunSummary {
    const outcome: TaskRunOutcome = record.state === 'RUNNING' || record.state === 'VERIFYING' ? 'running'
      : record.state === 'SUCCEEDED' ? 'succeeded'
        : record.state === 'FAILED' ? 'failed'
          : record.state === 'CANCELLED' ? 'cancelled'
            : record.state === 'TIMED_OUT' ? 'timed-out'
              : record.terminalReason === 'TASK_CONTEXT_UNAVAILABLE' ? 'reconciliation-required'
                : record.state === 'OUTCOME_UNKNOWN' ? 'outcome-unknown'
                  : record.terminalReason === 'TASK_CONTEXT_STALE' ? 'stale-context'
                    : record.terminalReason === 'COMPLETION_CHECK_FAILED' ? 'verifier-rejected' : 'blocked'
    const evidenceSource = record.terminalReason?.startsWith('CALLER_REPORTED_')
      ? 'caller-supplied' as const
      : 'hronaut-observed' as const
    const context = record.checks.find(check => check.type === 'context-binding')
    return structuredClone({
      id: record.id,
      revision: record.revision,
      workspaceId: record.workspaceId,
      state: record.state,
      terminalReason: record.terminalReason,
      outcome,
      reasonCode: record.terminalReason,
      evidenceSource,
      effects: 'not-established' as const,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deadlineAt: record.deadlineAt,
      heartbeatDueAt: record.heartbeatDueAt,
      ...(record.taskDefinition ? {
        taskDefinition: record.taskDefinition,
        ...(context && context.type === 'context-binding' ? {
          receipt: {
            formatVersion: 1 as const,
            taskDefinitionId: record.taskDefinition.id,
            taskRevision: record.taskDefinition.revision,
            context: {
              tabId: context.tabId,
              navigationGeneration: context.navigationGeneration,
              observationGeneration: context.observationGeneration
            },
            approvalState: record.taskDefinition.approvalRequired ? 'required' as const : 'not-required' as const,
            authoritativeResult: { outcome, reasonCode: record.terminalReason, evidenceSource }
          }
        } : {})
      } : {}),
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
