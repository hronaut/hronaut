import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { javascriptLiteral } from '../../../shared/javascript-literal.js'
import { RendererExitedError } from '../renderer-exit-guard.js'
import {
  WORKER_EVALUATION_CAVEATS,
  WORKER_EVALUATION_LIMITS,
  type WorkerEvaluationReport,
  type WorkerListReport,
  type WorkerSummary
} from '../../../shared/worker-evaluation.js'

interface WorkerTab {
  id: string
  url: string
  navigationGeneration: number
  observationGeneration: number
  webContents: WebContents
}

/** The calling agent's authority over the tab's origin, checked before each dispatch and before a result is kept. */
export interface WorkerEvaluationAuthority { assertCurrent(origin: string): void }

export interface WorkerEvaluationHost<T> {
  isCurrent(tab: T): boolean
  /** Runs in the tab's debugger queue after attaching; rejects while Developer Tools are open. */
  withDebugger<R>(tab: T, operation: () => Promise<R>): Promise<R>
}

/** How long an evaluation waits for its script, and the call's cancellation. */
export interface WorkerEvaluationDeadline {
  timeoutMs: number
  signal?: AbortSignal
}

type StopReason = 'SCRIPT_TIMEOUT' | 'CANCELLED' | 'WORKER_ENDED'

/** An evaluation that stopped waiting for its script: its deadline passed, its call was cancelled or its worker ended. */
export class WorkerEvaluationStoppedError extends Error {
  readonly reason: StopReason
  /** Whether the script reached the worker; false when the evaluation stopped before sending it. */
  readonly sent: boolean

  constructor(reason: StopReason, sent: boolean, timeoutMs: number) {
    super(stopMessage(reason, sent, timeoutMs))
    this.name = 'WorkerEvaluationStoppedError'
    this.reason = reason
    this.sent = sent
  }
}

function stopMessage(reason: StopReason, sent: boolean, timeoutMs: number): string {
  if (!sent) {
    return reason === 'SCRIPT_TIMEOUT' ? `The ${timeoutMs} ms deadline passed before the script was sent; nothing ran.`
      : 'The call was cancelled before the script was sent; nothing ran.'
  }
  if (reason === 'WORKER_ENDED') return 'The worker ended, or Hronaut\'s debugger left the page, before the script finished, so its effects are unknown.'
  const stopped = reason === 'SCRIPT_TIMEOUT' ? `The script did not finish within ${timeoutMs} ms` : 'The call was cancelled before the script finished'
  return `${stopped}. Hronaut stopped the code still running in the worker, but callbacks it scheduled may still run, so its effects are unknown.`
}

/** The worker a handle stands for. */
interface ListedWorker {
  summary: WorkerSummary
  targetId: string
  url: string
}

/** One listing of a tab's workers: the document it was taken in and the handles it issued. */
interface Listing {
  webContents: WebContents
  origin: string
  mainFrameId: string
  loaderId: string
  navigationGeneration: number
  observationGeneration: number
  workers: Map<string, ListedWorker>
}

interface AttachedWorker {
  sessionId: string
  targetId: string
  url: string
  title: string
  parentFrameId: string | undefined
}

interface EvaluateResponse {
  result?: { value?: unknown; objectId?: string }
  exceptionDetails?: { text?: string; exception?: { description?: string; objectId?: string } }
}

const UNKNOWN_HANDLE = 'Unknown worker handle for this tab. Handles last until the tab\'s next listing, so list its workers again; nothing ran.'
const STALE_HANDLE = 'The worker handle expired: the page navigated or reloaded, the workspace\'s agent control changed, or Hronaut\'s debugger left the page. List the tab\'s workers again; nothing ran.'
const ENDED_HANDLE = 'The worker behind this handle ended. List the tab\'s workers again; nothing ran.'
// Control, formatting and line-separator characters, which a page-chosen name could use to break or disguise text.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g

function httpOrigin(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined
  } catch {
    return undefined
  }
}

/** The worker's name as the page gave it, or undefined for an unnamed worker, which Chromium titles with its address. */
function workerName(title: string, url: string): string | undefined {
  const name = title.replace(CONTROL_CHARACTERS, '').trim()
  if (!name || name === url || /^[a-z][a-z\d+.-]*:/i.test(name)) return undefined
  return name.slice(0, WORKER_EVALUATION_LIMITS.maxNameChars)
}

function workerPath(url: string): string {
  return new URL(url).pathname.slice(0, WORKER_EVALUATION_LIMITS.maxPathChars)
}

async function mainFrame(contents: WebContents): Promise<{ id: string; loaderId: string; url: string }> {
  const tree = await contents.debugger.sendCommand('Page.getFrameTree') as { frameTree?: { frame?: { id?: unknown; loaderId?: unknown; url?: unknown } } }
  const frame = tree.frameTree?.frame
  if (typeof frame?.id !== 'string' || typeof frame.loaderId !== 'string' || typeof frame.url !== 'string') throw new Error('Could not read the page\'s top-level document')
  return { id: frame.id, loaderId: frame.loaderId, url: frame.url }
}

/**
 * Attaches the tab's debugger session to the page's dedicated workers for one
 * operation and detaches them again after it, also when it fails. Chromium
 * attaches the workers that exist before it answers, and only the page's own:
 * not another tab's, shared or service workers, or workers other workers
 * started. Nothing is paused or enabled in them, so the only event their
 * sessions send is Inspector.workerScriptLoaded, which carries no page state.
 * `ended` settles once a session detaches, the debugger leaves the page or
 * the renderer exits: a command pending in a detached session never answers.
 * Reactions wait until the event's dispatch has returned: turning auto-attach
 * off from inside the dispatch of a detach crashes Electron's main process.
 */
async function withAttachedWorkers<R>(
  contents: WebContents,
  use: (attached: Map<string, AttachedWorker>, ended: (sessionId: string) => Promise<void>) => Promise<R>
): Promise<R> {
  const attached = new Map<string, AttachedWorker>()
  const gone = new Set<string>()
  const endings = new Map<string, () => void>()
  let allGone = false
  const message = (_event: unknown, method: string, params: Record<string, unknown> | undefined, sessionId?: string): void => {
    if (sessionId) return
    if (method === 'Target.attachedToTarget') {
      const info = params?.targetInfo as Record<string, unknown> | undefined
      const session = params?.sessionId
      if (typeof session !== 'string' || info?.type !== 'worker' || typeof info.targetId !== 'string' || typeof info.url !== 'string') return
      attached.set(session, {
        sessionId: session, targetId: info.targetId, url: info.url,
        title: typeof info.title === 'string' ? info.title : '',
        parentFrameId: typeof info.parentFrameId === 'string' ? info.parentFrameId : undefined
      })
    } else if (method === 'Target.detachedFromTarget' && typeof params?.sessionId === 'string') {
      gone.add(params.sessionId)
      const end = endings.get(params.sessionId)
      if (end) setImmediate(end)
    }
  }
  const leave = (): void => {
    allGone = true
    for (const end of endings.values()) setImmediate(end)
  }
  const ended = (sessionId: string): Promise<void> => new Promise(resolve => {
    if (allGone || gone.has(sessionId)) setImmediate(resolve)
    else endings.set(sessionId, resolve)
  })
  contents.debugger.on('message', message)
  contents.debugger.on('detach', leave)
  contents.on('render-process-gone', leave)
  try {
    await contents.debugger.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: 'worker' }] })
    return await use(attached, ended)
  } finally {
    leave()
    if (!contents.isDestroyed()) {
      contents.debugger.removeListener('message', message)
      contents.debugger.removeListener('detach', leave)
      contents.removeListener('render-process-gone', leave)
      // Chromium detaches every worker session before it answers, in the
      // browser process, so also while the renderer is gone; auto-attach would
      // otherwise outlive it and attach the next renderer's workers. A failure
      // leaves it to the next listing or evaluation, which ends it too.
      await new Promise(resolve => setImmediate(resolve))
      if (!contents.isDestroyed() && contents.debugger.isAttached()) {
        await contents.debugger.sendCommand('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => undefined)
      }
    }
  }
}

/** Wraps the script so the worker returns its value as bounded JSON text, which crosses the protocol whatever its size. */
function workerScript(script: string): string {
  const limit = WORKER_EVALUATION_LIMITS.maxResultChars
  return `(async () => {
    const value = await (0, eval)(${javascriptLiteral(script)});
    if (value === undefined) return { kind: 'undefined' };
    let text;
    try { text = JSON.stringify(value); } catch { return { kind: 'unserializable' }; }
    if (typeof text !== 'string') return { kind: 'unserializable' };
    return text.length > ${limit} ? { kind: 'truncated', text: text.slice(0, ${limit}), totalChars: text.length } : { kind: 'json', text };
  })()`
}

/** Reads the wrapper's answer again in the main process, since worker code can replace what the wrapper calls. */
function readResult(value: unknown): Pick<WorkerEvaluationReport, 'resultKind' | 'result' | 'resultPreview' | 'resultChars'> {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const limit = WORKER_EVALUATION_LIMITS.maxResultChars
  if (record.kind === 'undefined') return { resultKind: 'undefined' }
  if ((record.kind !== 'json' && record.kind !== 'truncated') || typeof record.text !== 'string') return { resultKind: 'unserializable' }
  if (record.kind === 'json' && record.text.length <= limit) {
    try {
      return { resultKind: 'json', result: JSON.parse(record.text) }
    } catch {
      return { resultKind: 'unserializable' }
    }
  }
  const total = typeof record.totalChars === 'number' && Number.isSafeInteger(record.totalChars) ? record.totalChars : 0
  return { resultKind: 'truncated', resultPreview: record.text.slice(0, limit), resultChars: Math.max(total, record.text.length) }
}

function stopSignal(deadline: WorkerEvaluationDeadline): AbortSignal {
  const timeout = AbortSignal.timeout(deadline.timeoutMs)
  return deadline.signal ? AbortSignal.any([deadline.signal, timeout]) : timeout
}

function stopReason(stop: AbortSignal): 'SCRIPT_TIMEOUT' | 'CANCELLED' {
  return stop.reason instanceof DOMException && stop.reason.name === 'TimeoutError' ? 'SCRIPT_TIMEOUT' : 'CANCELLED'
}

/** The pending outcome, or the stop error once the stop signal fires first. */
function untilStopped<R>(pending: Promise<R>, stop: AbortSignal, stopped: () => Error | undefined): Promise<R> {
  // An outcome that settles after the stop has nobody waiting for it.
  pending.catch(() => undefined)
  const early = stopped()
  if (early) return Promise.reject(early)
  return new Promise<R>((resolve, reject) => {
    const onStop = (): void => reject(stopped())
    stop.addEventListener('abort', onStop, { once: true })
    pending.then(resolve, reject).finally(() => stop.removeEventListener('abort', onStop))
  })
}

/**
 * Lists a tab's own dedicated workers and evaluates scripts in them. A listing
 * attaches Hronaut's debugger session to the page's workers only for the
 * call, keeps the workers the top-level document created from scripts of its
 * own origin, and issues each an opaque handle bound to the tab, its document,
 * the worker's target and its script address. An evaluation names one handle,
 * attaches again, finds that same worker or refuses, and runs the script in it
 * alone. A new listing, a navigation or reload, a workspace control change,
 * Hronaut's debugger leaving the page, the tab closing or the worker ending
 * retires handles; nothing ever falls back to another worker or the page.
 * Nothing is persisted, and workers are never paused, created or terminated.
 */
export class WorkerEvaluations<T extends WorkerTab> {
  private readonly listings = new Map<T, Listing>()
  private readonly watched = new WeakSet<WebContents>()

  constructor(private readonly host: WorkerEvaluationHost<T>) {}

  forget(tab: T): void {
    this.listings.delete(tab)
  }

  async list(tab: T, authority: WorkerEvaluationAuthority): Promise<WorkerListReport> {
    const contents = tab.webContents
    const origin = httpOrigin(tab.url)
    if (!origin || contents.isDestroyed() || httpOrigin(contents.getURL()) !== origin) throw new Error('Workers can be listed only on an HTTP(S) page')
    authority.assertCurrent(origin)
    const navigationGeneration = tab.navigationGeneration, observationGeneration = tab.observationGeneration
    const unchanged = (): void => {
      // A detached debugger, as when Developer Tools opened, would leave handles its detach no longer retires.
      if (!this.host.isCurrent(tab) || tab.webContents !== contents || contents.isDestroyed() || !contents.debugger.isAttached()
        || tab.navigationGeneration !== navigationGeneration || tab.observationGeneration !== observationGeneration || httpOrigin(tab.url) !== origin) {
        throw new Error('The page changed while its workers were being listed; list them again')
      }
    }
    // A new listing retires the tab's earlier handles, also when it fails.
    this.listings.delete(tab)
    this.watch(contents)
    const omitted = { frameWorkers: 0, otherScripts: 0, overLimit: 0 }
    const listing = await this.host.withDebugger(tab, async (): Promise<Listing> => {
      unchanged()
      const main = await mainFrame(contents)
      if (httpOrigin(main.url) !== origin) throw new Error('The page changed while its workers were being listed; list them again')
      return withAttachedWorkers(contents, async attached => {
        const workers = new Map<string, ListedWorker>()
        for (const worker of attached.values()) {
          if (worker.parentFrameId !== main.id) omitted.frameWorkers++
          else if (httpOrigin(worker.url) !== origin) omitted.otherScripts++
          else if (workers.size >= WORKER_EVALUATION_LIMITS.maxWorkers) omitted.overLimit++
          else {
            const handle = randomUUID()
            const name = workerName(worker.title, worker.url)
            workers.set(handle, { targetId: worker.targetId, url: worker.url, summary: { handle, path: workerPath(worker.url), ...(name ? { name } : {}) } })
          }
        }
        return { webContents: contents, origin, mainFrameId: main.id, loaderId: main.loaderId, navigationGeneration, observationGeneration, workers }
      })
    })
    unchanged()
    authority.assertCurrent(origin)
    this.listings.set(tab, listing)
    return {
      action: 'list', tabId: tab.id, origin,
      workers: [...listing.workers.values()].map(worker => worker.summary),
      omitted, caveats: [...WORKER_EVALUATION_CAVEATS]
    }
  }

  async evaluate(tab: T, handle: string, script: string, deadline: WorkerEvaluationDeadline, authority: WorkerEvaluationAuthority): Promise<WorkerEvaluationReport> {
    const listing = this.listings.get(tab)
    const worker = listing?.workers.get(handle)
    if (!listing || !worker) throw new Error(UNKNOWN_HANDLE)
    const contents = tab.webContents
    const current = (): void => {
      if (this.listings.get(tab) !== listing || !listing.workers.has(handle)) throw new Error(STALE_HANDLE)
      if (!this.host.isCurrent(tab) || contents !== listing.webContents || contents.isDestroyed()
        || tab.navigationGeneration !== listing.navigationGeneration || tab.observationGeneration !== listing.observationGeneration
        || httpOrigin(tab.url) !== listing.origin) {
        this.listings.delete(tab)
        throw new Error(STALE_HANDLE)
      }
    }
    current()
    authority.assertCurrent(listing.origin)
    const stop = stopSignal(deadline)
    let sent = false
    const stopped = (): WorkerEvaluationStoppedError | undefined => stop.aborted ? new WorkerEvaluationStoppedError(stopReason(stop), sent, deadline.timeoutMs) : undefined
    const unstopped = (): void => {
      const error = stopped()
      if (error) throw error
    }
    unstopped()
    const operation = this.host.withDebugger(tab, async () => {
      unstopped()
      current()
      const main = await mainFrame(contents)
      if (main.id !== listing.mainFrameId || main.loaderId !== listing.loaderId) {
        if (this.listings.get(tab) === listing) this.listings.delete(tab)
        throw new Error(STALE_HANDLE)
      }
      return withAttachedWorkers(contents, async (attached, ended) => {
        const target = [...attached.values()].find(candidate => candidate.targetId === worker.targetId)
        if (!target || target.parentFrameId !== listing.mainFrameId || target.url !== worker.url) {
          listing.workers.delete(handle)
          throw new Error(ENDED_HANDLE)
        }
        unstopped()
        current()
        authority.assertCurrent(listing.origin)
        sent = true
        const command = contents.debugger.sendCommand('Runtime.evaluate', {
          expression: workerScript(script), awaitPromise: true, returnByValue: true, allowUnsafeEvalBlockedByCSP: true
        }, target.sessionId) as Promise<EvaluateResponse>
        const workerEnded = ended(target.sessionId).then((): never => { throw new WorkerEvaluationStoppedError('WORKER_ENDED', true, deadline.timeoutMs) })
        let response: EvaluateResponse
        try {
          response = await untilStopped(Promise.race([command, workerEnded]), stop, stopped)
        } catch (error) {
          // The worker ran in the renderer that exited.
          if (error instanceof RendererExitedError) throw new WorkerEvaluationStoppedError('WORKER_ENDED', true, deadline.timeoutMs)
          if (error instanceof WorkerEvaluationStoppedError && error.reason !== 'WORKER_ENDED') {
            // Stops code still running, such as a loop; the worker itself keeps running.
            await contents.debugger.sendCommand('Runtime.terminateExecution', {}, target.sessionId).catch(() => undefined)
          }
          throw error
        }
        return readResponse(contents, target.sessionId, response)
      })
    })
    // Also stops waiting for the debugger queue; the queued operation then finds the stop and sends nothing.
    const outcome = await untilStopped(operation, stop, stopped)
    authority.assertCurrent(listing.origin)
    return { action: 'evaluate', tabId: tab.id, worker: worker.summary, ...outcome }
  }

  /** Retires the page's handles once Hronaut's debugger leaves it, as when Developer Tools open. */
  private watch(contents: WebContents): void {
    if (this.watched.has(contents)) return
    this.watched.add(contents)
    contents.debugger.on('detach', () => {
      for (const [tab, listing] of this.listings) if (listing.webContents === contents) this.listings.delete(tab)
    })
  }
}

async function readResponse(contents: WebContents, sessionId: string, response: EvaluateResponse): Promise<ReturnType<typeof readResult>> {
  // Exceptions allocate handles even by value; they belong to the worker's session.
  const objectIds = new Set([response.result?.objectId, response.exceptionDetails?.exception?.objectId].filter((id): id is string => typeof id === 'string'))
  await Promise.allSettled([...objectIds].map(objectId => contents.debugger.sendCommand('Runtime.releaseObject', { objectId }, sessionId)))
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'unknown error'
    throw new Error(`The worker script threw: ${detail.slice(0, WORKER_EVALUATION_LIMITS.maxExceptionChars)}`)
  }
  return readResult(response.result?.value)
}
