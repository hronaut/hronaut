import { HumanWaitingStore } from './human-waiting-store.js'
import type { HumanWaitingPersistence } from './human-waiting-persistence.js'

type Authorization = () => void
type WaitingInput = Parameters<HumanWaitingStore['create']>[0]

/** One main-process owner. Serialization makes returned decisions durable and
 * prevents queued operations from using a superseded revision. Browser actions
 * are never dispatched here. The resolve validator must inspect fresh context.
 */
export class HumanWaitingService {
  private queue: Promise<unknown> = Promise.resolve()
  private initialization: Promise<void> | undefined
  private unavailable = false
  private persistedRecords = '[]'

  constructor(
    private readonly persistence: Pick<HumanWaitingPersistence, 'load' | 'save'>,
    private readonly store = new HumanWaitingStore()
  ) {}

  private initialize(): Promise<void> {
    this.initialization ??= (async () => {
      try {
        const snapshot = await this.persistence.load()
        if (snapshot) {
          this.store.restore(snapshot)
          await this.save()
        }
      } catch {
        this.unavailable = true
        throw new Error('Human waiting history is unavailable')
      }
    })()
    return this.initialization
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(async () => {
      await this.initialize()
      if (this.unavailable) throw new Error('Human waiting history is unavailable')
      return operation()
    })
    this.queue = pending.catch(() => undefined)
    return pending
  }

  private async save(): Promise<void> {
    try {
      const snapshot = this.store.snapshot()
      await this.persistence.save(snapshot)
      this.persistedRecords = JSON.stringify(snapshot.records)
    } catch {
      this.unavailable = true
      throw new Error('Human waiting change could not be saved; inspect recovery before retrying')
    }
  }

  create(input: WaitingInput, authorize: Authorization) {
    const request = structuredClone(input)
    return this.serialize(async () => {
      authorize()
      const result = this.store.create(request)
      await this.save()
      authorize()
      return this.current(request.workspaceId, result.id)
    })
  }

  list(workspaceId: string, authorize: Authorization) {
    return this.serialize(async () => {
      authorize()
      this.store.list(workspaceId)
      // Expiry is part of the durable lifecycle, including expiry observed by
      // a status read. A failed write cannot masquerade as an empty history.
      await this.save()
      authorize()
      return this.store.list(workspaceId)
    })
  }

  change(workspaceId: string, id: string, revision: string, action: 'acknowledge' | 'cancel' | 'resolve', authorize: Authorization, validateFresh?: () => Promise<void>) {
    return this.serialize(async () => {
      authorize()
      if (!this.store.list(workspaceId).some(record => record.id === id)) throw new Error('Waiting decision unavailable')
      if (action === 'resolve') {
        if (!validateFresh) throw new Error('Fresh browser review is required')
        await validateFresh()
        authorize()
      }
      const result = this.store[action](id, revision)
      await this.save()
      if (action === 'resolve') {
        try {
          await validateFresh!()
          authorize()
        } catch {
          this.store.invalidateResolution(id)
          await this.save()
          throw new Error('Browser review changed while saving; inspect current state again')
        }
      } else authorize()
      return this.current(workspaceId, result.id)
    })
  }

  private current(workspaceId: string, id: string) {
    const record = this.store.list(workspaceId).find(candidate => candidate.id === id)
    if (!record) throw new Error('Waiting decision unavailable')
    return record
  }

  requireDispatch(workspaceId: string, authorize: Authorization): Promise<void> {
    return this.serialize(async () => {
      authorize()
      // Dispatch checks also observe expiry. Persist that transition before
      // admitting work, without rewriting unchanged history on every action.
      const snapshot = this.store.snapshot()
      if (JSON.stringify(snapshot.records) !== this.persistedRecords) await this.save()
      authorize()
      if (snapshot.records.some(record => record.workspaceId === workspaceId && (record.state === 'WAITING_FOR_HUMAN' || record.state === 'ACKNOWLEDGED'))) {
        throw new Error('Workspace is waiting for a human decision')
      }
      // Terminal waiting status grants no permission. The caller still checks
      // continuity, current ownership, pause state, and action authorization.
    })
  }

  notify(workspaceId: string, id: string, authorize: Authorization, deliver: () => Promise<void>) {
    return this.serialize(async () => {
      authorize()
      this.current(workspaceId, id)
      this.store.recordNotification(id, 'pending')
      await this.save()
      authorize()
      if (this.current(workspaceId, id).state !== 'WAITING_FOR_HUMAN') {
        this.store.finishNotification(id, 'failed')
        await this.save()
        authorize()
        return this.current(workspaceId, id)
      }
      let status: 'delivered' | 'failed' = 'failed'
      try { await deliver(); status = 'delivered' } catch { /* Preserve the waiting decision when local alert delivery fails. */ }
      this.store.finishNotification(id, status)
      await this.save()
      authorize()
      return this.current(workspaceId, id)
    })
  }
}
