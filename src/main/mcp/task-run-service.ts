import type { TaskRunPersistence } from './task-run-persistence.js'
import {
  TaskRunStore,
  type SavedTaskDefinition,
  type SavedTaskEvidence,
  type SavedTaskInput,
  type SavedTaskStep,
  type TaskRunCheckDefinition
} from './task-run-store.js'

type Authorization = () => void
type CreateInput = Parameters<TaskRunStore['create']>[0]
type RequestedOutcome = Parameters<TaskRunStore['complete']>[2]
type CheckResult = Parameters<TaskRunStore['complete']>[3][number]
interface Evaluation { results: CheckResult[]; contextToken: string }

/** Serializes the durable lifecycle around the pure store. The evaluator is a
 * trusted main-process boundary and must derive check results from current
 * browser state or a retained bounded artifact, never from model narration.
 */
export class TaskRunService {
  private queue: Promise<unknown> = Promise.resolve()
  private initialization: Promise<void> | undefined
  private unavailable = false
  private persistedState = '{"records":[],"tasks":[]}'

  constructor(
    private readonly persistence: Pick<TaskRunPersistence, 'load' | 'save'>,
    private readonly store = new TaskRunStore()
  ) {}

  create(input: CreateInput, authorize: Authorization) {
    const request = structuredClone(input)
    return this.serialize(async () => {
      authorize()
      const result = this.store.create(request)
      await this.saveStable()
      authorize()
      return this.store.get(result.id)
    })
  }

  saveTask(input: {
    workspaceId: string
    name: string
    intent: string
    inputs: SavedTaskInput[]
    steps: SavedTaskStep[]
    evidence: SavedTaskEvidence[]
    retryPolicy: SavedTaskDefinition['retryPolicy']
  }, authorize: Authorization) {
    const request = structuredClone(input)
    return this.serialize(async () => {
      authorize()
      const task = this.store.saveTask(request)
      await this.saveStable()
      authorize()
      return this.requireTaskWorkspace(request.workspaceId, task.id)
    })
  }

  getTask(workspaceId: string, id: string, authorize: Authorization) {
    return this.serialize(async () => {
      authorize()
      return this.requireTaskWorkspace(workspaceId, id)
    })
  }

  listTasks(workspaceId: string, authorize: Authorization) {
    return this.serialize(async () => {
      authorize()
      return this.store.listTasks(workspaceId)
    })
  }

  deleteTask(workspaceId: string, id: string, revision: string, authorize: Authorization) {
    return this.serialize(async () => {
      authorize()
      this.requireTaskWorkspace(workspaceId, id)
      const task = this.store.deleteTask(id, revision)
      await this.saveStable()
      authorize()
      return task
    })
  }

  createFromTask(workspaceId: string, taskId: string, taskRevision: string,
    input: Omit<CreateInput, 'workspaceId' | 'taskDefinition'>, authorize: Authorization) {
    const request = structuredClone(input)
    return this.serialize(async () => {
      authorize()
      const task = this.requireTaskWorkspace(workspaceId, taskId)
      if (task.revision !== taskRevision) throw new Error('Saved task is unavailable or stale')
      const result = this.store.create({
        workspaceId,
        ...request,
        taskDefinition: {
          id: task.id,
          revision: task.revision,
          approvalRequired: task.steps.some(step => step.humanGate)
        }
      })
      await this.saveStable()
      authorize()
      return this.requireWorkspace(workspaceId, result.id)
    })
  }

  heartbeat(workspaceId: string, id: string, revision: string, authorize: Authorization,
    evaluate: (checks: TaskRunCheckDefinition[]) => Promise<Evaluation> = async () => ({ results: [], contextToken: '' })) {
    return this.serialize(async () => {
      authorize()
      this.requireWorkspace(workspaceId, id)
      const checks = this.store.completionChecks(id, revision).filter(check => check.type === 'context-binding')
      const evaluation = checks.length ? await evaluate(checks) : { results: [], contextToken: '' }
      authorize()
      this.requireWorkspace(workspaceId, id)
      let result = this.store.heartbeat(id, revision, evaluation.results)
      await this.saveStable()
      authorize()
      if (checks.length && result.state === 'RUNNING') {
        const fresh = await evaluate(checks)
        authorize()
        this.requireWorkspace(workspaceId, result.id)
        if (fresh.contextToken !== evaluation.contextToken
          || fresh.results.some(check => check.status !== 'PASS')) {
          result = this.store.heartbeat(result.id, result.revision, fresh.results)
          await this.saveStable()
          authorize()
        }
      }
      return this.requireWorkspace(workspaceId, result.id)
    })
  }

  complete(workspaceId: string, id: string, revision: string, requested: RequestedOutcome,
    authorize: Authorization,
    evaluate: (checks: TaskRunCheckDefinition[]) => Promise<Evaluation> = async () => ({ results: [], contextToken: '' })) {
    return this.serialize(async () => {
      authorize()
      this.requireWorkspace(workspaceId, id)
      const checks = requested === 'SUCCEEDED' ? this.store.completionChecks(id, revision) : []
      const evaluation = requested === 'SUCCEEDED' ? await evaluate(checks) : { results: [], contextToken: '' }
      authorize()
      this.requireWorkspace(workspaceId, id)
      let result = this.store.complete(id, revision, requested, evaluation.results)
      await this.saveStable()
      authorize()
      if (result.state === 'VERIFYING') {
        const fresh = await evaluate(checks)
        authorize()
        if (fresh.contextToken !== evaluation.contextToken
          || fresh.results.some(check => check.status !== 'PASS')) {
          result = this.store.invalidateVerification(result.id, result.revision)
        } else result = this.store.confirmSuccess(result.id, result.revision)
        await this.saveStable()
        authorize()
      }
      return this.requireWorkspace(workspaceId, result.id)
    })
  }

  get(workspaceId: string, id: string, authorize: Authorization) {
    return this.serialize(async () => {
      authorize()
      this.requireWorkspace(workspaceId, id)
      await this.saveIfChanged()
      authorize()
      const result = this.requireWorkspace(workspaceId, id)
      await this.saveIfChanged()
      authorize()
      return result
    })
  }

  list(workspaceId: string, authorize: Authorization) {
    return this.serialize(async () => {
      authorize()
      this.store.list(workspaceId)
      await this.saveIfChanged()
      authorize()
      const refreshed = this.store.list(workspaceId)
      await this.saveIfChanged()
      authorize()
      return refreshed
    })
  }

  private initialize(): Promise<void> {
    this.initialization ??= (async () => {
      try {
        const snapshot = await this.persistence.load()
        if (snapshot) {
          this.store.restore(snapshot)
          await this.saveStable()
        } else {
          this.persistedState = this.serializedState(this.store.snapshot())
        }
      } catch {
        this.unavailable = true
        throw new Error('Task-run history is unavailable')
      }
    })()
    return this.initialization
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(async () => {
      await this.initialize()
      if (this.unavailable) throw new Error('Task-run history is unavailable')
      return operation()
    })
    this.queue = pending.catch(() => undefined)
    return pending
  }

  private async saveIfChanged(): Promise<void> {
    const snapshot = this.store.snapshot()
    if (this.serializedState(snapshot) !== this.persistedState) await this.saveStable(snapshot)
  }

  private async saveStable(first = this.store.snapshot()): Promise<void> {
    try {
      await this.persistence.save(first)
      let persisted = first
      const after = this.store.snapshot()
      if (JSON.stringify(after.records) !== JSON.stringify(first.records)) {
        await this.persistence.save(after)
        persisted = after
      }
      this.persistedState = this.serializedState(persisted)
    } catch {
      this.unavailable = true
      throw new Error('Task-run change could not be saved; inspect recovery before retrying')
    }
  }

  private requireWorkspace(workspaceId: string, id: string) {
    const result = this.store.get(id)
    if (result.workspaceId !== workspaceId) throw new Error('Task run is unavailable in this workspace')
    return result
  }

  private requireTaskWorkspace(workspaceId: string, id: string) {
    const result = this.store.getTask(id)
    if (result.workspaceId !== workspaceId) throw new Error('Saved task is unavailable in this workspace')
    return result
  }

  private serializedState(snapshot: ReturnType<TaskRunStore['snapshot']>): string {
    return JSON.stringify({ records: snapshot.records, tasks: snapshot.tasks })
  }
}
