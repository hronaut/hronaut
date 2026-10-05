import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { FRAME_OBSERVATION_LIMITS, type BrowserFrameSnapshot, type FrameObservationOmission } from '../../shared/frame-observation.js'
import { redactDiagnosticText } from '../../shared/debug-report.js'
import { FrameProvenance, type ObservedFrame } from './frame-provenance.js'
import { frameObservationScript, frameSelectorScript } from './frame-observation-script.js'
interface Target { page: WebContents; identity: object; workspace: object | undefined; generation: number; observationGeneration: number; permissionGeneration: number }
interface Host {
  resolve(tabId: string): Target
  requireOwner(tabId: string, page: WebContents): void
  run<T>(id: number, operation: () => Promise<T>): Promise<T>
}
export interface PendingFrameObservation {
  snapshot: BrowserFrameSnapshot
  finish(): Promise<void>
  assertCurrent(): void
  discard(): void
}
const unavailable = (reason = 'context'): Error => new Error(`Frame observation unavailable (${reason}): obtain a fresh supported document and browser context; no automatic reload was performed.`)
interface FrameTree { frame: ObservedFrame; childFrames?: FrameTree[] }
interface RemoteResult { result?: { objectId?: string; value?: unknown }; exceptionDetails?: unknown }
const omissions: FrameObservationOmission[] = ['nested-frames','shadow-dom','private-editors','offscreen-or-clipped','uncertain-layout','node-limit','depth-limit','duration-limit','text-limit']

export class FrameObservationController {
  private readonly histories = new WeakMap<WebContents, FrameProvenance>()
  private readonly worlds = new WeakMap<WebContents, Map<number, string>>()
  private readonly slots = new Map<number, () => void>()
  constructor(private readonly host: Host) {}
  track(page: WebContents): void {
    const history = new FrameProvenance(randomUUID())
    this.histories.set(page, history)
    const worlds = new Map<number, string>()
    this.worlds.set(page, worlds)
    page.debugger.on('message', (_event, method, params, sessionId) => {
      history.observe(method, params, sessionId)
      if (method === 'Runtime.executionContextsCleared') worlds.clear()
      if (method === 'Runtime.executionContextDestroyed') worlds.delete(params.executionContextId)
      if (method === 'Runtime.executionContextCreated' && params.context?.name === 'hronaut-frame-observation') {
        const context = params.context as { id?: unknown; uniqueId?: unknown }
        if (typeof context.id !== 'number' || typeof context.uniqueId !== 'string' || context.uniqueId.length > 256 || worlds.size >= 16) history.invalidate()
        else worlds.set(context.id, context.uniqueId)
      }
    })
    page.debugger.on('detach', () => { history.invalidate(); this.slots.get(page.id)?.() })
    page.on('did-start-navigation', () => history.navigation())
    page.on('render-process-gone', () => { history.invalidate(); this.slots.get(page.id)?.() })
    page.once('destroyed', () => { history.invalidate(); this.slots.get(page.id)?.(); this.slots.delete(page.id) })
  }
  async capture(tabId: string, selector: string, maxChars: number, authority: () => void): Promise<PendingFrameObservation> {
    const target = this.host.resolve(tabId), page = target.page, history = this.histories.get(page)
    if (!history || this.slots.has(page.id) || this.slots.size >= 16) throw unavailable()
    const revision = history.revision, deadline = Date.now() + FRAME_OBSERVATION_LIMITS.deadlineMs
    const group = 'hronaut-frame-' + randomUUID(), key = '__frame_' + randomUUID().replaceAll('-', '')
    let contextId: number | undefined, uniqueContextId: string | undefined, expired = false, closed = false, cleanupQueued = false
    let stage = 'context'
    let parent: ObservedFrame | undefined, child: ObservedFrame | undefined
    const assertCurrent = (): void => {
      authority()
      const current = this.host.resolve(tabId)
      this.host.requireOwner(tabId, page)
      if (expired || Date.now() > deadline || current.page !== page || current.identity !== target.identity || current.workspace !== target.workspace
        || current.generation !== target.generation || current.observationGeneration !== target.observationGeneration || current.permissionGeneration !== target.permissionGeneration || history.revision !== revision || page.isLoading()
        || (parent && child && !history.pair(parent, child))) throw unavailable()
    }
    const send = async <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
      this.host.requireOwner(tabId, page)
      return page.debugger.sendCommand(method, params) as Promise<T>
    }
    const evaluate = async (expression: string, byValue = true): Promise<RemoteResult['result']> => {
      const r = await send<RemoteResult>('Runtime.evaluate', { expression, uniqueContextId, objectGroup: group, returnByValue: byValue, userGesture: false, silent: true, generatePreview: false })
      if (r.exceptionDetails || !r.result) throw unavailable()
      return r.result
    }
    const contextDestroyed = (_event: Electron.Event, method: string, params: Record<string, unknown>): void => {
      if (contextId !== undefined && (method === 'Runtime.executionContextsCleared'
        || (method === 'Runtime.executionContextDestroyed' && params.executionContextId === contextId))) {
        expired = true
        clearSlot()
      }
    }
    const clearSlot = (): void => {
      closed = true
      clearTimeout(timer)
      page.debugger.removeListener('message', contextDestroyed)
      if (this.slots.get(page.id) === discard) this.slots.delete(page.id)
    }
    const discard = (): void => {
      if (closed || cleanupQueued) return
      expired = true; cleanupQueued = true
      // Keep the slot quarantined until cleanup really finishes or the page dies.
      void this.host.run(page.id, async () => {
        if (page.isDestroyed()) { clearSlot(); return }
        if (contextId !== undefined) await evaluate(`(()=>{const h=this[${JSON.stringify(key)}];if(h)h.close();delete this[${JSON.stringify(key)}];return true})()`)
        await send('Runtime.releaseObjectGroup', { objectGroup: group })
        clearSlot()
      }).catch(() => { /* Ownership loss or a hung renderer cannot certify cleanup. */ })
    }
    this.slots.set(page.id, discard)
    const timer = setTimeout(discard, FRAME_OBSERVATION_LIMITS.deadlineMs)
    page.debugger.on('message', contextDestroyed)
    const bounded = async <T>(operation: Promise<T>): Promise<T> => {
      let timeout: NodeJS.Timeout | undefined
      try {
        return await Promise.race([operation, new Promise<never>((_resolve,reject) => {
          timeout = setTimeout(() => { discard(); reject(unavailable()) }, Math.max(1, deadline - Date.now()))
        })])
      } finally { if (timeout) clearTimeout(timeout) }
    }
    try {
      assertCurrent()
      const snapshot = await bounded(this.host.run(page.id, async () => {
        assertCurrent()
        const tree = await send<{frameTree: FrameTree}>('Page.getFrameTree')
        parent = tree.frameTree.frame
        stage = 'parent-history:' + history.reason(parent)
        if (!history.matches(parent)) throw unavailable()
        const world = await send<{executionContextId:number}>('Page.createIsolatedWorld', { frameId: parent.id, worldName: 'hronaut-frame-observation', grantUniveralAccess: false })
        contextId = world.executionContextId
        uniqueContextId = this.worlds.get(page)?.get(contextId)
        if (!uniqueContextId) throw unavailable('isolated-context-identity')
        assertCurrent()
        stage = 'selection'
        const object = await evaluate(`this[${JSON.stringify(key)}]={frame:${frameSelectorScript(selector)},close:()=>{}};this[${JSON.stringify(key)}].frame`, false)
        if (!object?.objectId) throw unavailable()
        const described = await send<{node:{frameId?:string;backendNodeId:number}}>('DOM.describeNode', { objectId: object.objectId, depth: 0, pierce: false })
        if (!described.node.frameId) throw unavailable()
        const owner = await send<{backendNodeId:number}>('DOM.getFrameOwner', { frameId: described.node.frameId })
        const current = await send<{frameTree:FrameTree}>('Page.getFrameTree')
        child = current.frameTree.childFrames?.find(f => f.frame.id === described.node.frameId)?.frame
        stage = 'child-provenance'
        if (owner.backendNodeId !== described.node.backendNodeId || !child || current.frameTree.frame.loaderId !== parent.loaderId || !history.pair(parent,child)) throw unavailable()
        stage = 'viewport-or-sop'
        await evaluate(`this[${JSON.stringify(key)}]=${frameObservationScript(selector,maxChars,`this[${JSON.stringify(key)}].frame`)};true`)
        stage = 'collection'
        const raw = (await evaluate(`this[${JSON.stringify(key)}].read()`))?.value as {text?:unknown;omissions?:unknown}
        if (!raw || typeof raw.text !== 'string' || raw.text.length > maxChars || !Array.isArray(raw.omissions)
          || raw.omissions.some(v => !omissions.includes(v))) throw unavailable()
        assertCurrent()
        return {
          kind: 'frame-observation', formatVersion: 1, captureId: randomUUID(), scope: 'direct-child-viewport',
          text: redactDiagnosticText(raw.text), untrusted: true,
          completeness: { complete: raw.omissions.length === 0, omissions: raw.omissions as FrameObservationOmission[], absenceNotEstablished: true },
          limits: FRAME_OBSERVATION_LIMITS
        } satisfies BrowserFrameSnapshot
      }))
      return {
        snapshot, assertCurrent, discard,
        finish: async () => {
          try {
            stage = 'settlement'
            await bounded(this.host.run(page.id, async () => {
              assertCurrent()
              // Release remote handles BEFORE the final renderer check. The private
              // world owns the bounded guard until that last check closes it.
              await send('Runtime.releaseObjectGroup', { objectGroup: group })
              const valid = (await evaluate(`(()=>{const h=this[${JSON.stringify(key)}];const ok=!!h&&h.check();if(h)h.close();delete this[${JSON.stringify(key)}];return ok})()`))?.value
              if (valid !== true) throw unavailable()
              assertCurrent(); clearSlot()
            }))
            assertCurrent()
          } catch { discard(); throw unavailable(stage) }
        }
      }
    } catch { discard(); throw unavailable(stage) }
  }
}
