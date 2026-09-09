import { currentAuditAction, withAuditAction } from './audit-action-context.js'
import type { AuditReceipt, AuditReceiptEvent, AuditReceiptStore } from './audit-receipt-store.js'

type ObservedState = Extract<AuditReceiptEvent, { phase: 'decision' }>['state']
type SiteAccessInput = Omit<Extract<AuditReceiptEvent, { phase: 'site-access' }>, 'phase' | 'actionId'>
interface ActiveAction {
  acceptingSites: boolean
  dropped: number
  writes: Set<Promise<void>>
}

export interface AuditReceiptActionOptions<T> {
  toolName: string
  readOnly: boolean
  observeState: () => ObservedState
  operation: () => Promise<T>
  isErrorResult: (result: T) => boolean
  /** Trusted dispatch classification; never infer it from page text. */
  classifyErrorResult?: (result: T) => 'outcome-unknown' | 'stale-observation' | undefined
  signal?: AbortSignal
}

/** A single owner for an explicitly started run, after workspace authorization.
 * This class never authorizes access and never retries a browser operation.
 */
export class AuditReceiptRun {
  private accepting = true
  private stopPromise: Promise<void> | undefined
  private persistenceFailed = false
  private readonly pending = new Set<Promise<unknown>>()
  private readonly actions = new Map<string, ActiveAction>()
  private readonly siteWrites = new Set<Promise<void>>()
  private uncorrelatedSiteAccessDropped = 0

  constructor(
    private readonly workspaceId: string,
    private readonly store: Pick<AuditReceiptStore, 'append' | 'read'>
  ) {}

  execute<T>(options: AuditReceiptActionOptions<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new Error('Audit receipt run is stopping or stopped'))
    if (this.persistenceFailed) return Promise.reject(new Error('Audit receipt persistence is unavailable'))
    const execution = withAuditAction(this.workspaceId, async (actionId) => {
      const observe = (): ObservedState => {
        try {
          return structuredClone(options.observeState())
        } catch {
          return null
        }
      }
      if (options.signal?.aborted) throw new Error('Action cancelled before audit admission')
      // An accepted action must have durable admission evidence before any
      // browser operation starts. Failure here cannot trigger an implicit retry.
      await this.store.append({
        phase: 'decision', scope: 'workspace', actionId, toolName: options.toolName,
        decision: 'allowed', state: observe()
      })
      const action: ActiveAction = { acceptingSites: true, dropped: 0, writes: new Set() }
      this.actions.set(actionId, action)
      let status: Extract<AuditReceiptEvent, { phase: 'outcome' }>['status'] = 'failed'
      let invoked = false
      let settled: { ok: true; value: T } | { ok: false; error: unknown }
      try {
        if (options.signal?.aborted) {
          status = 'cancelled'
          throw new Error('Action cancelled before execution')
        }
        invoked = true
        const result = await options.operation()
        status = options.isErrorResult(result)
          ? options.classifyErrorResult?.(result) ?? (options.signal?.aborted ? 'cancelled' : 'failed')
          : 'succeeded'
        settled = { ok: true, value: result }
      } catch (error) {
        if (options.signal?.aborted) status = 'cancelled'
        settled = { ok: false, error }
      }
      action.acceptingSites = false
      await Promise.all([...action.writes])
      this.actions.delete(actionId)
      try {
        await this.store.append({
          phase: 'outcome', actionId, status,
          effects: !invoked || options.readOnly ? 'none' : 'possible',
          siteAccessDropped: action.dropped, state: observe()
        })
      } catch {
        this.persistenceFailed = true
        // Do not attach raw tool errors/results as a cause. The operation may
        // already have changed browser state, so a retry is not appropriate.
        throw new Error('Action settled but its audit outcome could not be saved; do not automatically retry the action')
      }
      if (!settled.ok) throw settled.error
      return settled.value
    })
    this.pending.add(execution)
    void execution.then(
      () => { this.pending.delete(execution) },
      () => { this.pending.delete(execution) }
    )
    return execution
  }

  /** Queues a safe observation without changing a synchronous policy decision.
   * True means queued, not durably written. Missing evidence is counted.
   */
  recordSiteAccess(workspaceId: string, input: SiteAccessInput): boolean {
    if (workspaceId !== this.workspaceId) return false
    const candidateId = currentAuditAction(workspaceId)
    const candidate = candidateId ? this.actions.get(candidateId) : undefined
    const action = candidate?.acceptingSites ? candidate : undefined
    if (!this.accepting && !action) return false
    const dropped = (): void => {
      if (action) action.dropped = Math.min(Number.MAX_SAFE_INTEGER, action.dropped + 1)
      else this.uncorrelatedSiteAccessDropped = Math.min(Number.MAX_SAFE_INTEGER, this.uncorrelatedSiteAccessDropped + 1)
    }
    // Bound queued work as well as the on-disk journal. Navigation callbacks
    // must not create an unbounded promise queue during slow disk writes.
    if (this.siteWrites.size >= 64) {
      dropped()
      return false
    }
    let event: AuditReceiptEvent
    try {
      event = structuredClone({ ...input, phase: 'site-access' as const, actionId: action ? candidateId : null })
    } catch {
      dropped()
      return false
    }
    const write = Promise.resolve().then(() => this.store.append(event)).then(() => undefined, dropped)
    this.siteWrites.add(write)
    action?.writes.add(write)
    void write.then(() => {
      this.siteWrites.delete(write)
      action?.writes.delete(write)
    })
    return true
  }

  stop(): Promise<void> {
    this.accepting = false
    this.stopPromise ??= Promise.allSettled([...this.pending]).then(async () => {
      await Promise.all([...this.siteWrites])
    })
    return this.stopPromise
  }

  async report(): Promise<{ receipts: AuditReceipt[]; persistenceFailed: boolean; uncorrelatedSiteAccessDropped: number }> {
    await Promise.all([...this.siteWrites])
    return {
      receipts: await this.store.read(), persistenceFailed: this.persistenceFailed,
      uncorrelatedSiteAccessDropped: this.uncorrelatedSiteAccessDropped
    }
  }
}
