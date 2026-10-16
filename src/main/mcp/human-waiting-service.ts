import { HumanWaitingStore, currentHumanWaitingReviewStep } from './human-waiting-store.js'
import type { HumanWaitingPersistence } from './human-waiting-persistence.js'
import {
  normalizeHumanWaitingNote,
  requiresHumanWaitingAccountAndTargetConfirmation,
  type HumanWaitingState,
  type HumanWaitingTrustedConfirmation
} from '../../shared/human-waiting.js'

type Authorization = () => void
export interface HumanWaitingSavedState { id: string; workspaceId: string; state: HumanWaitingState }
type WaitingInput = Parameters<HumanWaitingStore['create']>[0]
export interface HumanWaitingReviewBinding {
  id: string
  revision: string
  toolName: string
  artifactHash: string
  sessionBinding: string
  origin?: string
  tabId?: string
  navigationGeneration?: number
  humanInputGeneration?: number
  browserSessionGeneration?: number
}

function sameReviewBinding(left: HumanWaitingReviewBinding, right: HumanWaitingReviewBinding): boolean {
  return left.id === right.id
    && left.revision === right.revision
    && left.toolName === right.toolName
    && left.artifactHash === right.artifactHash
    && left.sessionBinding === right.sessionBinding
    && left.origin === right.origin
    && left.tabId === right.tabId
    && left.navigationGeneration === right.navigationGeneration
    && left.humanInputGeneration === right.humanInputGeneration
    && left.browserSessionGeneration === right.browserSessionGeneration
}

/** One main-process owner. Serialization makes returned decisions durable and
 * prevents queued operations from using a superseded revision. Browser actions
 * are never dispatched here. The resolve validator must inspect fresh context.
 */
export class HumanWaitingService {
  private queue: Promise<unknown> = Promise.resolve()
  private initialization: Promise<void> | undefined
  private unavailable = false
  private persistedRecords = '[]'
  private requestEpoch = 0
  private pendingRequests = 0
  private readonly savedListeners = new Set<(records: readonly HumanWaitingSavedState[]) => void>()
  /** Answers people gave in Hronaut, by decision. Kept in memory only, so their notes are never saved. */
  private readonly answers = new Map<string, { answeredAt: number; note?: string }>()
  /** What the running operation saved last, reported once it settles. */
  private unreportedRecords: readonly HumanWaitingSavedState[] | undefined

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
    this.requestEpoch++
    this.pendingRequests++
    const pending = this.queue.then(async () => {
      await this.initialize()
      if (this.unavailable) throw new Error('Human waiting history is unavailable')
      return operation()
    }).finally(() => {
      this.pendingRequests--
      this.notifySaved()
    })
    this.queue = pending.catch(() => undefined)
    return pending
  }

  private async save(): Promise<void> {
    try {
      const snapshot = this.store.snapshot()
      await this.persistence.save(snapshot)
      this.persistedRecords = JSON.stringify(snapshot.records)
      this.unreportedRecords = snapshot.records.map(({ id, workspaceId, state }) => ({ id, workspaceId, state }))
    } catch {
      this.unavailable = true
      throw new Error('Human waiting change could not be saved; inspect recovery before retrying')
    }
  }

  // An operation can save a step it then undoes, such as a resolution whose fresh check fails, so
  // listeners hear only where it ended.
  private notifySaved(): void {
    const records = this.unreportedRecords
    if (!records) return
    this.unreportedRecords = undefined
    for (const listener of [...this.savedListeners]) {
      try { listener(records) } catch (error) { console.error('[human-waiting] A saved-state listener failed:', error) }
    }
  }

  /** Called once each operation that saved settles, with every decision's id, workspace and state. */
  onSaved(listener: (records: readonly HumanWaitingSavedState[]) => void): () => void {
    this.savedListeners.add(listener)
    return () => { this.savedListeners.delete(listener) }
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
      // a status read. Saving can itself cross a deadline, so rescan until the
      // returned lifecycle state is the same state held on disk.
      while (true) {
        await this.save()
        authorize()
        const result = this.store.list(workspaceId)
        if (JSON.stringify(this.store.snapshot().records) === this.persistedRecords) return result.map(record => this.withAnswer(record))
      }
    })
  }

  change(
    workspaceId: string,
    id: string,
    revision: string,
    action: 'acknowledge' | 'cancel' | 'reject' | 'resolve',
    authorize: Authorization,
    validateFresh?: () => Promise<void>,
    trustedConfirmation?: HumanWaitingTrustedConfirmation,
    /** Given when a person answers in Hronaut, with what they wrote to the agent. */
    answer?: { note?: string }
  ) {
    return this.serialize(async () => {
      if (answer?.note !== undefined && ((action !== 'resolve' && action !== 'reject') || normalizeHumanWaitingNote(answer.note) !== answer.note)) {
        throw new Error('Waiting decision note unavailable')
      }
      authorize()
      if (!this.store.list(workspaceId).some(record => record.id === id)) throw new Error('Waiting decision unavailable')
      if (action === 'resolve') {
        const record = this.current(workspaceId, id)
        if (requiresHumanWaitingAccountAndTargetConfirmation(record) && trustedConfirmation?.accountAndTargetVerified !== true) {
          throw new Error('Confirm the signed-in account and target in the trusted review UI')
        }
        if (!validateFresh) throw new Error('Fresh browser review is required')
        await validateFresh()
        authorize()
      }
      const result = this.store[action](id, revision)
      if (answer && action !== 'acknowledge') this.remember(id, answer.note)
      await this.save()
      if (action === 'resolve') {
        try {
          await validateFresh!()
          authorize()
        } catch {
          this.store.invalidateResolution(id)
          this.answers.delete(id)
          await this.save()
          throw new Error('Browser review changed while saving; inspect current state again')
        }
      } else authorize()
      return this.withAnswer(this.current(workspaceId, result.id))
    })
  }

  private remember(id: string, note: string | undefined): void {
    this.answers.delete(id)
    this.answers.set(id, { answeredAt: Date.now(), ...(note ? { note } : {}) })
    // Bounded like the history itself; the oldest answers go first.
    for (const old of this.answers.keys()) {
      if (this.answers.size <= 1000) break
      this.answers.delete(old)
    }
  }

  private withAnswer<T extends { id: string }>(record: T): T & { answeredAt?: number; note?: string } {
    const answer = this.answers.get(record.id)
    return answer ? { ...record, ...answer } : record
  }

  private current(workspaceId: string, id: string) {
    const record = this.store.list(workspaceId).find(candidate => candidate.id === id)
    if (!record) throw new Error('Waiting decision unavailable')
    return record
  }

  async requireDispatch(
    workspaceId: string,
    authorize: Authorization,
    review?: HumanWaitingReviewBinding,
    activeSessionBinding?: string,
    settlingReviewAttemptId?: string
  ): Promise<void> {
    await this.dispatchCheck(workspaceId, authorize, review, activeSessionBinding, settlingReviewAttemptId)
  }

  certifyDispatch(
    workspaceId: string,
    authorize: Authorization,
    review?: HumanWaitingReviewBinding,
    activeSessionBinding?: string,
    settlingReviewAttemptId?: string
  ): Promise<() => void> {
    return this.dispatchCheck(workspaceId, authorize, review, activeSessionBinding, settlingReviewAttemptId, true)
  }

  private dispatchCheck(
    workspaceId: string,
    authorize: Authorization,
    review?: HumanWaitingReviewBinding,
    activeSessionBinding?: string,
    settlingReviewAttemptId?: string,
    certify = false
  ): Promise<() => void> {
    const epoch = this.requestEpoch + 1
    return this.serialize(async () => {
      authorize()
      // Dispatch checks also observe expiry. Persist that transition before
      // admitting work, without rewriting unchanged history on every action.
      const snapshot = this.store.snapshot()
      if (JSON.stringify(snapshot.records) !== this.persistedRecords) await this.save()
      authorize()
      let workspaceRecords = snapshot.records.filter(record => record.workspaceId === workspaceId)
      let sessionInvalidated = false
      if (activeSessionBinding) {
        for (const record of workspaceRecords) {
          sessionInvalidated = this.store.invalidateReviewSession(record.id, activeSessionBinding)
            || sessionInvalidated
        }
      }
      if (sessionInvalidated) {
        await this.save()
        authorize()
        workspaceRecords = this.store.list(workspaceId)
      }
      if (workspaceRecords.some(record => record.state === 'WAITING_FOR_HUMAN' || record.state === 'ACKNOWLEDGED')) {
        throw new Error('Workspace is waiting for a human decision')
      }
      if (workspaceRecords.some(record => record.review?.status === 'ATTEMPTED'
        && record.id !== settlingReviewAttemptId)) {
        throw new Error('A reviewed action outcome is unresolved; inspect current state before continuing')
      }
      const approved = workspaceRecords.find(record => record.review?.status === 'APPROVED')
      if (approved) {
        if (!review) {
          throw new Error('An approved review is waiting for its exact proposed action')
        }
        if (review.id !== approved.id || review.revision !== approved.revision) {
          this.store.invalidateResolution(approved.id)
          await this.save()
          throw new Error('The reviewed action binding changed; create a fresh review')
        }
        const artifact = this.store.approvedReview(review.id, review.revision).review!
        const step = currentHumanWaitingReviewStep(artifact)
        if (step.toolName !== review.toolName || step.artifactHash !== review.artifactHash
          || artifact.sessionBinding !== review.sessionBinding) {
          this.store.invalidateResolution(review.id)
          await this.save()
          throw new Error('The reviewed action or session changed; create a fresh review')
        }
      } else if (review) {
        throw new Error('Approved review unavailable or stale')
      }
      authorize()
      // Terminal waiting status grants no permission. The caller still checks
      // continuity, current ownership, pause state, and action authorization.
      if (!certify) return () => undefined
      const certifiedRecords = JSON.stringify(this.store.snapshot().records)
      if (certifiedRecords !== this.persistedRecords) throw new Error('Human waiting state requires persistence')
      return () => {
        if (this.unavailable || this.pendingRequests !== 0 || this.requestEpoch !== epoch
          || settlingReviewAttemptId !== undefined && !this.store.reviewAttemptDispatchIsCurrent(settlingReviewAttemptId)
          || certifiedRecords !== this.persistedRecords
          || JSON.stringify(this.store.snapshot().records) !== certifiedRecords) {
          throw new Error('Human waiting dispatch certificate changed')
        }
        authorize()
      }
    })
  }

  beginReviewedDispatch(
    workspaceId: string,
    currentReview: () => HumanWaitingReviewBinding,
    authorize: Authorization,
    validateFresh: () => void | Promise<void>
  ) {
    return this.serialize(async () => {
      authorize()
      const requested = currentReview()
      const approved = this.store.approvedReview(requested.id, requested.revision)
      if (approved.workspaceId !== workspaceId) throw new Error('Approved review unavailable or stale')
      let review: HumanWaitingReviewBinding
      try {
        await validateFresh()
        authorize()
        review = currentReview()
        if (review.id !== requested.id || review.revision !== requested.revision) {
          throw new Error('Reviewed action binding changed')
        }
      } catch {
        this.store.invalidateResolution(requested.id)
        await this.save()
        throw new Error('Browser context changed before reviewed dispatch; create a fresh review')
      }
      const attempted = this.store.beginReviewAttempt(review.id, review.revision, review)
      await this.save()
      if (!attempted.accepted) throw new Error('The reviewed action or session changed; create a fresh review')
      try {
        await validateFresh()
        authorize()
        if (!sameReviewBinding(review, currentReview())) throw new Error('Reviewed action binding changed')
      } catch {
        this.store.invalidateReviewAttempt(attempted.record.id, attempted.record.revision)
        await this.save()
        throw new Error('Browser context changed before reviewed dispatch; create a fresh review')
      }
      return this.current(workspaceId, attempted.record.id)
    })
  }

  finishReviewedDispatch(workspaceId: string, id: string, revision: string, outcome: 'verified' | 'unknown', authorize: Authorization) {
    return this.serialize(async () => {
      authorize()
      if (!this.store.list(workspaceId).some(record => record.id === id)) throw new Error('Reviewed attempt unavailable')
      const result = this.store.finishReviewAttempt(id, revision, outcome)
      await this.save()
      authorize()
      return this.current(workspaceId, result.id)
    })
  }

  invalidateApprovedReview(workspaceId: string, id: string, revision: string): Promise<void> {
    return this.serialize(async () => {
      const approved = this.store.approvedReview(id, revision)
      if (approved.workspaceId !== workspaceId) throw new Error('Approved review unavailable or stale')
      this.store.invalidateResolution(id)
      await this.save()
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
