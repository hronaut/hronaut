/** Session-local browser evidence. Never infer history from a current frame tree. */
interface DocumentEvidence {
  frameId: string
  loaderId: string
  requestId?: string
  requestUrl?: string
  responseUrl?: string
  status?: number
  commitUrl?: string
  parentId?: string
  committed: boolean
  poisoned: boolean
}
export interface ObservedFrame { id: string; loaderId: string; url: string; parentId?: string; unreachableUrl?: string }
const string = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 && value.length <= 8192 ? value : undefined
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
export function committedHttpOrigin(value: string): string | undefined {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.origin : undefined } catch { return undefined }
}
export class FrameProvenance {
  private readonly entries = new Map<string, DocumentEvidence>()
  private readonly active = new Map<string, string>()
  private unavailable = false
  private unavailableReason = 'unknown'
  revision = 0
  constructor(readonly epoch: string) {}
  invalidate(reason = 'session-gap'): void { this.unavailable = true; this.unavailableReason = reason; this.revision++ }
  navigation(): void { this.revision++ }
  private key(frame: string, loader: string): string { return JSON.stringify([this.epoch, frame, loader]) }
  private entry(frameId: unknown, loaderId: unknown): DocumentEvidence | undefined {
    const frame = string(frameId), loader = string(loaderId)
    if (!frame || !loader) { this.invalidate(!frame ? 'missing-frame' : 'missing-loader'); return }
    const key = this.key(frame, loader)
    let value = this.entries.get(key)
    if (!value) {
      if (this.entries.size >= 128) { this.invalidate('history-cap'); return }
      value = { frameId: frame, loaderId: loader, committed: false, poisoned: false }
      this.entries.set(key, value)
    }
    return value
  }
  observe(method: string, input: unknown, sessionId?: string): void {
    if (this.unavailable) return
    if (sessionId) { this.invalidate(); return }
    const p = object(input)
    if (method === 'Page.frameDetached') {
      this.revision++
      if (p.reason === 'swap') this.invalidate('process-swap')
      const frame = string(p.frameId)
      if (frame) this.active.delete(frame)
      return
    }
    if (method === 'Runtime.executionContextsCleared' || method === 'Page.navigatedWithinDocument') { this.revision++; return }
    if (method === 'Inspector.detached' || method === 'Inspector.targetCrashed') { this.invalidate(); return }
    if (method === 'Network.requestWillBeSent' && p.type === 'Document') {
      this.revision++
      const e = this.entry(p.frameId, p.loaderId), requestId = string(p.requestId), url = string(object(p.request).url)
      if (!e || !requestId || !url) { this.invalidate(); return }
      if (!e.requestId) { e.requestId = requestId; this.active.set(e.frameId, this.key(e.frameId, e.loaderId)) }
      if (e.requestId !== requestId) e.poisoned = true
      e.requestUrl = url
    } else if (method === 'Network.responseReceived' && p.type === 'Document') {
      const e = this.entry(p.frameId, p.loaderId), response = object(p.response)
      const url = string(response.url), status = response.status
      if (!e || !url || typeof status !== 'number' || !Number.isInteger(status)) { this.invalidate(); return }
      if (e.requestId !== p.requestId || status < 200 || status === 204 || status === 205 || (status >= 300 && status < 400) || status >= 600) e.poisoned = true
      if (e.responseUrl && (e.responseUrl !== url || e.status !== status)) e.poisoned = true
      e.responseUrl = url; e.status = status
    } else if (method === 'Network.loadingFailed') {
      for (const e of this.entries.values()) if (e.requestId === p.requestId) { e.poisoned = true; this.revision++ }
    } else if (method === 'Page.frameNavigated' || method === 'Page.documentOpened') {
      this.revision++
      const frame = object(p.frame), e = this.entry(frame.id, frame.loaderId)
      if (!e) return
      if (method === 'Page.documentOpened') { e.poisoned = true; return }
      if (p.type === 'BackForwardCacheRestore') { this.invalidate('bfcache'); return }
      const url = string(frame.url)
      if (!url) { this.invalidate(); return }
      if (frame.unreachableUrl || (e.committed && e.commitUrl !== url)) e.poisoned = true
      e.committed = true; e.commitUrl = url; e.parentId = string(frame.parentId)
    }
  }
  reason(frame: ObservedFrame): string {
    if (this.unavailable) return this.unavailableReason
    const key = this.key(frame.id, frame.loaderId), e = this.entries.get(key)
    if (!e) return 'unknown-loader'
    if (e.poisoned) return 'poisoned-loader'
    if (!e.requestId) return 'missing-request'
    if (!e.responseUrl) return 'missing-response'
    if (!e.committed) return 'missing-commit'
    if (this.active.get(frame.id) !== key) return 'stale-loader'
    return 'inconsistent-document'
  }
  matches(frame: ObservedFrame): boolean {
    if (this.unavailable || !frame.id || !frame.loaderId || frame.unreachableUrl) return false
    const key = this.key(frame.id, frame.loaderId), e = this.entries.get(key)
    return !!e && !e.poisoned && e.committed && this.active.get(frame.id) === key
      && e.parentId === frame.parentId && e.requestUrl === frame.url && e.responseUrl === frame.url
      && e.commitUrl === frame.url && committedHttpOrigin(frame.url) !== undefined
  }
  pair(parent: ObservedFrame, child: ObservedFrame): boolean {
    return !parent.parentId && child.parentId === parent.id && this.matches(parent) && this.matches(child)
      && committedHttpOrigin(parent.url) === committedHttpOrigin(child.url)
  }
}
