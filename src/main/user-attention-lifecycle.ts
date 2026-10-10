import type { UserAttentionRequest } from '../shared/types.js'

export type UserAttentionState = 'pending' | 'acknowledged' | 'dismissed' | 'resolved'
  | 'superseded' | 'expired' | 'target-closed' | 'workspace-removed'
export interface UserAttentionStatus extends UserAttentionRequest { state: UserAttentionState }
const pending = (state: UserAttentionState): boolean => ['pending', 'acknowledged', 'dismissed'].includes(state)

/** Runtime-only correlation history. Resolving an alert never authorizes browser actions. */
export class UserAttentionLifecycle {
  private records = new Map<string, { status: UserAttentionStatus; deadline: number }>()
  private listeners = new Set<() => void>()
  constructor(private readonly now: () => number = () => performance.now()) {}

  private changed(): void { for (const listener of [...this.listeners]) listener() }
  private expire(): void {
    for (const record of this.records.values()) {
      if (pending(record.status.state) && this.now() >= record.deadline) record.status.state = 'expired'
    }
  }
  supersede(): void {
    this.expire()
    for (const record of this.records.values()) if (pending(record.status.state)) record.status.state = 'superseded'
    this.changed()
  }
  request(request: UserAttentionRequest): void {
    if (this.records.has(request.id)) throw new Error('Attention request identity was reused')
    this.supersede()
    while (this.records.size >= 100) this.records.delete(this.records.keys().next().value!)
    this.records.set(request.id, { status: { ...request, state: 'pending' }, deadline: this.now() + 86_400_000 })
    this.changed()
  }
  acknowledge(id: string, state: 'acknowledged' | 'dismissed'): void {
    this.expire()
    const record = this.records.get(id)
    if (record && pending(record.status.state)) { record.status.state = state; this.changed() }
  }
  forTab(tabId: string, workspaceId: string | undefined): UserAttentionStatus | undefined {
    this.expire()
    const record = [...this.records.values()].find(({ status }) => status.tabId === tabId
      && status.workspaceId === workspaceId && pending(status.state))
    return record ? { ...record.status } : undefined
  }
  resolve(id: string, tabId: string, workspaceId: string | undefined): boolean {
    const current = this.forTab(tabId, workspaceId)
    if (current?.id !== id) return false
    this.records.get(id)!.status.state = 'resolved'
    this.changed()
    return true
  }
  reconcile(tabs: ReadonlyArray<{ id: string; mcpGroupId?: string }>, workspaceIds: readonly string[]): void {
    this.expire()
    for (const { status } of this.records.values()) {
      if (!pending(status.state)) continue
      if (status.workspaceId && !workspaceIds.includes(status.workspaceId)) status.state = 'workspace-removed'
      else if (status.tabId && !tabs.some(tab => tab.id === status.tabId && tab.mcpGroupId === status.workspaceId)) status.state = 'target-closed'
    }
    this.changed()
  }
  status(id: string, workspaceId: string): UserAttentionStatus {
    this.expire()
    const record = this.records.get(id)
    if (!record || record.status.workspaceId !== workspaceId) throw new Error('Attention request unavailable')
    return { ...record.status }
  }
  wait(id: string, workspaceId: string, timeoutMs: number, authorize: () => void, signal?: AbortSignal) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new Error('Attention wait timeout must be between 1 and 60000 ms')
    if (this.listeners.size >= 100) throw new Error('Attention wait capacity reached')
    return new Promise<{ outcome: UserAttentionState | 'timed-out'; request: UserAttentionStatus }>((resolve, reject) => {
      const deadline = this.now() + timeoutMs
      let timer: NodeJS.Timeout | undefined
      let finished = false
      const cleanup = (): void => {
        finished = true
        if (timer) clearTimeout(timer)
        this.listeners.delete(check)
        signal?.removeEventListener('abort', check)
      }
      const check = (): void => {
        if (finished) return
        if (timer) clearTimeout(timer)
        try {
          if (signal?.aborted) throw new Error('User attention wait cancelled')
          authorize()
          const request = this.status(id, workspaceId)
          if (!pending(request.state) || this.now() >= deadline) {
            cleanup()
            resolve({ outcome: pending(request.state) ? 'timed-out' : request.state, request })
            return
          }
          timer = setTimeout(check, Math.min(250, Math.max(1, deadline - this.now())))
          timer.unref()
        } catch (error) { cleanup(); reject(error) }
      }
      this.listeners.add(check)
      signal?.addEventListener('abort', check, { once: true })
      check()
    })
  }
}
