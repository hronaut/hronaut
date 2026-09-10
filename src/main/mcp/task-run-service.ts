import type { TaskRunPersistence } from './task-run-persistence.js'
import { TaskRunStore, type TaskRunCheckDefinition } from './task-run-store.js'

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
  private persistedRecords = '[]'

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

  heartbeat(workspaceId: string, id: string, revision: string, authorize: Authorization) {
    return this.serialize(async () => {
      authorize()
      this.requireWorkspace(workspaceId, id)
      const result = this.store.heartbeat(id, revision)
      await this.saveStable()
      authorize()
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
          this.persistedRecords = JSON.stringify(this.store.snapshot().records)
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
    if (JSON.stringify(snapshot.records) !== this.persistedRecords) await this.saveStable(snapshot)
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
      this.persistedRecords = JSON.stringify(persisted.records)
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
}
