import { randomUUID } from 'node:crypto'
import { NativeInputCleanupError } from './native-input-cleanup.js'
import type { NativeInputDispatchObserver } from './native-key-hold.js'

interface AttachedDebugger { sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown> }
interface Evaluation { result?: { objectId?: string; value?: unknown }; exceptionDetails?: unknown }
export interface NativeClickProgress {
  inputCleanupFailed: boolean
  preparationAttempted: boolean
  moveAttempted: number
  moveAcknowledged: number
  downAttempted: number
  downAcknowledged: number
  upAttempted: number
  upAcknowledged: number
  targetCleanup: 'not-acquired' | 'pending' | 'confirmed' | 'unconfirmed'
}
export const nativeClickProgress = (): NativeClickProgress => ({ inputCleanupFailed: false, preparationAttempted: false, moveAttempted: 0,
  moveAcknowledged: 0, downAttempted: 0, downAcknowledged: 0, upAttempted: 0, upAcknowledged: 0, targetCleanup: 'not-acquired' })
const clickReasons = ['TARGET_CHANGED', 'TARGET_DISABLED', 'POINT_OUTSIDE_VIEWPORT', 'TARGET_OCCLUDED', 'HIT_CHANGED',
  'TARGET_UNVERIFIABLE', 'HIT_UNVERIFIABLE', 'EMBEDDED_HIT_UNSUPPORTED', 'TARGET_UNAVAILABLE',
  'TARGET_CLEANUP_UNCONFIRMED', 'NATIVE_INPUT_CLEANUP_FAILED', 'CONTEXT_OR_INPUT_UNCERTAIN', 'CLICK_STATE_UNCONFIRMED'] as const
export type NativeClickReason = typeof clickReasons[number]
export const nativeClickReason = (value: unknown): NativeClickReason => clickReasons.includes(value as NativeClickReason)
  ? value as NativeClickReason : 'CONTEXT_OR_INPUT_UNCERTAIN'
export const nativeClickEffectsPossible = (progress: NativeClickProgress): boolean =>
  progress.preparationAttempted || progress.moveAttempted > 0 || progress.downAttempted > 0
export class NativeClickAdmissionError extends NativeInputCleanupError {
  constructor(readonly reason: NativeClickReason, readonly progress: NativeClickProgress, cause?: unknown) {
    super(cause)
    this.name = 'NativeClickAdmissionError'
    this.message = 'Native semantic click did not complete. Inspect fresh state; do not replay automatically.'
  }
}
export function nativeClickObserver(progress: NativeClickProgress, publish: () => void): NativeInputDispatchObserver {
  const record = (params: Record<string, unknown>, acknowledged: boolean): void => {
    const key = params.type === 'mouseMoved' ? acknowledged ? 'moveAcknowledged' : 'moveAttempted'
      : params.type === 'mousePressed' ? acknowledged ? 'downAcknowledged' : 'downAttempted'
        : params.type === 'mouseReleased' ? acknowledged ? 'upAcknowledged' : 'upAttempted' : undefined
    if (key) progress[key]++
    publish()
  }
  return { rawAttempted: params => record(params, false), rawAcknowledged: params => record(params, true), emergencyReleaseStarted: publish, cleanupFailed: () => { progress.inputCleanupFailed = true; publish() } }
}

// An operation-local object in an isolated realm retains the original node. No
// page-global target registry, page-owned method call, or exported node identity.
export function nativeClickTargetScript(target: { ref?: string; selector?: string }): string {
  return `(() => {
    const request = ${JSON.stringify(target)};
    const query = Document.prototype.querySelectorAll, item = NodeList.prototype.item;
    const connected = Object.getOwnPropertyDescriptor(Node.prototype, 'isConnected').get;
    const root = Node.prototype.getRootNode, contains = Node.prototype.contains;
    const hit = Document.prototype.elementFromPoint, matches = Element.prototype.matches;
    const selector = request.ref ? '[data-hronaut-ref="' + CSS.escape(request.ref) + '"]' : request.selector;
    const resolve = () => { const nodes = query.call(document, selector); return nodes.length === 1 ? item.call(nodes, 0) : null; };
    const original = resolve(), doc = document;
    if (!original || root.call(original) !== doc) throw Error('TARGET_UNAVAILABLE');
    return {
      receiver: null,
      sample(x, y, final) {
        if (document !== doc || !connected.call(original) || root.call(original) !== doc || resolve() !== original) return 'TARGET_CHANGED';
        if (matches.call(original, ':disabled')) return 'TARGET_DISABLED';
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return 'POINT_OUTSIDE_VIEWPORT';
        const current = hit.call(doc, x, y);
        if (!current || root.call(current) !== doc || !contains.call(original, current)) return 'TARGET_OCCLUDED';
        if (final && current !== this.receiver) return 'HIT_CHANGED';
        if (!final) this.receiver = current;
        return 'ADMITTED';
      }
    };
  })()`
}

/** Uses an ALREADY acquired debugger. Never enter BrowserDebuggerQueue here. */
export async function acquireNativeClickAdmission(api: AttachedDebugger, target: { ref?: string; selector?: string },
  validate: () => void, progress: NativeClickProgress, publish: () => void): Promise<{ sample(x: number, y: number): Promise<void>; dispose(): Promise<void> }> {
  const group = `hronaut-native-click-${randomUUID()}`
  let disposed = false
  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    try { await api.sendCommand('Runtime.releaseObjectGroup', { objectGroup: group }); progress.targetCleanup = 'confirmed' }
    catch (cause) { progress.targetCleanup = 'unconfirmed'; throw new NativeClickAdmissionError('TARGET_CLEANUP_UNCONFIRMED', { ...progress }, cause) }
    finally { publish() }
  }
  try {
    validate()
    const tree = await api.sendCommand('Page.getFrameTree') as { frameTree?: { frame?: { id?: string } } }
    validate()
    const frameId = tree.frameTree?.frame?.id
    if (!frameId) throw new Error('Top document unavailable')
    const world = await api.sendCommand('Page.createIsolatedWorld', { frameId, worldName: 'hronaut-native-click-admission', grantUniveralAccess: false }) as { executionContextId?: number }
    validate()
    if (!Number.isInteger(world.executionContextId)) throw new Error('Isolated document unavailable')
    progress.targetCleanup = 'pending'; publish()
    const acquired = await api.sendCommand('Runtime.evaluate', { expression: nativeClickTargetScript(target), contextId: world.executionContextId, objectGroup: group, returnByValue: false }) as Evaluation
    validate()
    const objectId = acquired.result?.objectId
    if (acquired.exceptionDetails || !objectId) throw new Error('Unique target unavailable')
    const call = async (functionDeclaration: string, args: unknown[], returnByValue = true): Promise<Evaluation> => {
      const result = await api.sendCommand('Runtime.callFunctionOn', { objectId, functionDeclaration,
        arguments: args.map(value => ({ value })), objectGroup: group, returnByValue }) as Evaluation
      validate()
      if (result.exceptionDetails) throw new Error('Target sample unavailable')
      return result
    }
    const sample = async (x: number, y: number): Promise<void> => {
      const inspect = async (final: boolean): Promise<void> => {
        const result = await call('function(x,y,final) { return this.sample(x,y,final); }', [x, y, final])
        if (result.result?.value !== 'ADMITTED') {
          const reason = result.result?.value
          throw new NativeClickAdmissionError(typeof reason === 'string' && ['TARGET_CHANGED', 'TARGET_DISABLED', 'POINT_OUTSIDE_VIEWPORT', 'TARGET_OCCLUDED', 'HIT_CHANGED'].includes(reason) ? nativeClickReason(reason) : 'TARGET_UNVERIFIABLE', { ...progress })
        }
      }
      await inspect(false)
      const receiver = await call('function() { return this.receiver; }', [], false)
      if (!receiver.result?.objectId) throw new NativeClickAdmissionError('HIT_UNVERIFIABLE', { ...progress })
      // Native metadata exposes CLOSED and user-agent roots as well. Do not
      // inspect attributes/text or substitute integer DOM.getNodeForLocation.
      const description = await api.sendCommand('DOM.describeNode', { objectId: receiver.result.objectId, depth: 0, pierce: false }) as {
        node?: { nodeName?: string; shadowRoots?: unknown[]; contentDocument?: unknown; frameId?: string }
      }
      validate()
      const node = description.node
      if (!node || node.shadowRoots?.length || node.contentDocument || node.frameId
        || ['IFRAME', 'FRAME', 'OBJECT', 'EMBED'].includes(node.nodeName ?? '')) {
        throw new NativeClickAdmissionError('EMBEDDED_HIT_UNSUPPORTED', { ...progress })
      }
      // The descriptor and sample are not atomic. Recheck exact receiver and
      // original identity after metadata acquisition; later renderer changes
      // can STILL redirect the raw press. No routing/handler guarantee.
      await inspect(true)
    }
    return { sample, dispose }
  } catch (error) {
    try { await dispose() } catch { /* Preserve acquisition cause with current cleanup provenance. */ }
    throw new NativeClickAdmissionError(error instanceof NativeClickAdmissionError ? error.reason : 'TARGET_UNAVAILABLE', { ...progress }, error)
  }
}
