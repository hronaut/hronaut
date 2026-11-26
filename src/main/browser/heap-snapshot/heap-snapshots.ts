import type { WebContents } from 'electron'
import type { Worker } from 'node:worker_threads'
import {
  HEAP_SNAPSHOT_LIMITS,
  type HeapSnapshotClassChange,
  type HeapSnapshotComparison,
  type HeapSnapshotSummary
} from '../../../shared/heap-snapshot.js'
import { redactNetworkUrl } from '../../../shared/network-details.js'
import type { DebuggerOperationOptions } from '../debugger-queue.js'
import { isHronautHomeUrl } from '../url.js'
import startHeapSnapshotWorker from './heap-snapshot.worker?nodeWorker'
import type { HeapSnapshotWorkerReply, HeapSnapshotWorkerRequest } from './heap-snapshot.worker.js'
import type { HeapSnapshotCounts } from './heap-snapshot-summary.js'

export interface HeapSnapshotTab {
  id: string
  url: string
  navigationGeneration: number
  webContents: WebContents
}

export interface HeapSnapshotHost<Tab extends HeapSnapshotTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>, options?: DebuggerOperationOptions): Promise<T>
  /** Whether allocation sampling records in the tab, which keeps the HeapProfiler domain enabled. */
  allocationSampling(tab: Tab): boolean
}

export type HeapSnapshotAction = 'take-heap-snapshot' | 'list-heap-snapshots' | 'compare-heap-snapshots' | 'clear-heap-snapshots'

export interface HeapSnapshotOptions {
  tabId?: string
  action: HeapSnapshotAction
  label?: string
  baseSnapshotId?: string
  targetSnapshotId?: string
  limit?: number
}

export interface HeapSnapshotReport {
  tabId: string
  url: string
  action: HeapSnapshotAction
  /** The snapshot just taken, with its classes cut to limit. */
  snapshot?: HeapSnapshotSummary
  /** Every summary the tab keeps, without classes. */
  snapshots: Array<Omit<HeapSnapshotSummary, 'classes'> & { classes: number }>
  comparison?: HeapSnapshotComparison
  cleared?: number
  caveats: string[]
}

/** Starts a worker for one snapshot; a test passes its own. */
export type StartWorker = () => Worker

/**
 * How long taking a heap snapshot may hold the page's debugger beyond the usual budget: Chromium streams a large
 * page's heap, up to HEAP_SNAPSHOT_LIMITS.maxSnapshotBytes, over minutes.
 */
const HEAP_SNAPSHOT_WAIT_MS = 240_000

const CAVEATS = [
  'Taking a heap snapshot collects garbage first and pauses the page for as long as it takes, often seconds on a large app.',
  'Sizes are self sizes, the bytes an object holds itself, not what it keeps alive; compare snapshots taken after the same interaction to see what grows.',
  'Only class names and counts are kept: never object values, strings, source code or the object graph.',
  'Detached nodes are DOM nodes no document holds that the heap still does; '
    + 'a detached document usually means a removed frame or old page whose window something still references.'
]

/**
 * Takes V8 heap snapshots of a tab through Hronaut's DevTools session and keeps only their per-class summaries,
 * parsed in a worker so the window stays responsive. A tab keeps up to four; closing it drops them with it.
 */
export class HeapSnapshots<Tab extends HeapSnapshotTab> {
  private readonly kept = new WeakMap<Tab, HeapSnapshotSummary[]>()
  private readonly taking = new WeakSet<Tab>()
  private lastId = 0

  constructor(
    private readonly host: HeapSnapshotHost<Tab>,
    private readonly startWorker: StartWorker = () => startHeapSnapshotWorker({ name: 'Hronaut heap snapshot' })
  ) {}

  async manage(options: HeapSnapshotOptions): Promise<HeapSnapshotReport> {
    const tab = this.host.getTab(options.tabId)
    const limit = options.limit ?? HEAP_SNAPSHOT_LIMITS.defaultLimit
    if (!Number.isInteger(limit) || limit < 1 || limit > HEAP_SNAPSHOT_LIMITS.maxLimit) {
      throw new Error(`limit must be a whole number from 1 to ${HEAP_SNAPSHOT_LIMITS.maxLimit}`)
    }
    if (options.action !== 'take-heap-snapshot' && options.label !== undefined) throw new Error('label is only for action take-heap-snapshot')
    const comparing = options.action === 'compare-heap-snapshots'
    if (!comparing && (options.baseSnapshotId !== undefined || options.targetSnapshotId !== undefined)) {
      throw new Error('baseSnapshotId and targetSnapshotId are only for action compare-heap-snapshots')
    }
    const list = this.kept.get(tab) ?? []
    if (options.action === 'list-heap-snapshots') return this.report(tab, options.action, list)
    if (options.action === 'clear-heap-snapshots') {
      this.kept.delete(tab)
      return { ...this.report(tab, options.action, []), cleared: list.length }
    }
    if (comparing) return { ...this.report(tab, options.action, list), comparison: this.compare(list, options, limit) }
    if (options.action !== 'take-heap-snapshot') throw new Error('Unsupported heap snapshot action')
    const label = options.label?.replace(/\p{Cc}/gu, ' ').trim()
    if (label !== undefined && (label === '' || label.length > HEAP_SNAPSHOT_LIMITS.maxLabelChars)) {
      throw new Error(`label must be 1 to ${HEAP_SNAPSHOT_LIMITS.maxLabelChars} characters`)
    }
    const snapshot = await this.take(tab, label)
    const next = [...(this.kept.get(tab) ?? []), snapshot].slice(-HEAP_SNAPSHOT_LIMITS.maxSnapshotsPerTab)
    this.kept.set(tab, next)
    return { ...this.report(tab, options.action, next), snapshot: { ...snapshot, classes: snapshot.classes.slice(0, limit) } }
  }

  private async take(tab: Tab, label: string | undefined): Promise<HeapSnapshotSummary> {
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before taking a heap snapshot')
    if (this.taking.has(tab)) throw new Error('A heap snapshot is already being taken in this tab')
    const generation = tab.navigationGeneration
    const url = tab.url
    this.taking.add(tab)
    const worker = this.startWorker()
    try {
      const reply = new Promise<HeapSnapshotWorkerReply>((resolve) => {
        worker.once('message', resolve)
        worker.once('error', (error) => resolve({ error: error instanceof Error ? error.message : String(error) }))
        worker.once('exit', () => resolve({ error: 'The heap snapshot parser stopped' }))
      })
      let bytes = 0
      let tooLarge = false
      const contents = tab.webContents
      const chunk = (_event: unknown, method: string, params: { chunk?: unknown }): void => {
        if (method !== 'HeapProfiler.addHeapSnapshotChunk' || tooLarge || typeof params?.chunk !== 'string') return
        bytes += params.chunk.length
        if (bytes > HEAP_SNAPSHOT_LIMITS.maxSnapshotBytes) {
          tooLarge = true
          void worker.terminate()
          return
        }
        worker.postMessage({ chunk: params.chunk } satisfies HeapSnapshotWorkerRequest)
      }
      await this.host.withDebugger(contents, async () => {
        const keepEnabled = this.host.allocationSampling(tab)
        contents.debugger.on('message', chunk)
        try {
          await contents.debugger.sendCommand('HeapProfiler.enable')
          await contents.debugger.sendCommand('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false, exposeInternals: false })
        } finally {
          contents.debugger.removeListener('message', chunk)
          if (!keepEnabled && !this.host.allocationSampling(tab)) await contents.debugger.sendCommand('HeapProfiler.disable').catch(() => undefined)
        }
      }, { waitMs: HEAP_SNAPSHOT_WAIT_MS })
      if (tooLarge) throw new Error(`The heap snapshot is larger than ${HEAP_SNAPSHOT_LIMITS.maxSnapshotBytes / 1024 / 1024} MiB, so it was not kept`)
      this.assertSamePage(tab, generation)
      worker.postMessage({ end: true } satisfies HeapSnapshotWorkerRequest)
      const parsed = await reply
      if ('error' in parsed) throw new Error(`The heap snapshot could not be read: ${parsed.error}`)
      this.assertSamePage(tab, generation)
      return this.summary(parsed.summary, label, url)
    } finally {
      this.taking.delete(tab)
      void worker.terminate()
    }
  }

  private summary(counts: HeapSnapshotCounts, label: string | undefined, url: string): HeapSnapshotSummary {
    return { id: `heap-${++this.lastId}`, ...(label ? { label } : {}), takenAt: new Date().toISOString(), url: redactNetworkUrl(url), ...counts }
  }

  private assertSamePage(tab: Tab, generation: number): void {
    const current = this.host.findTab(tab.id)
    if (current !== tab || tab.webContents.isDestroyed() || tab.navigationGeneration !== generation) {
      throw new Error('The page changed while the heap snapshot was taken. Take it again.')
    }
  }

  private compare(list: HeapSnapshotSummary[], options: HeapSnapshotOptions, limit: number): HeapSnapshotComparison {
    if (list.length < 2 && (options.baseSnapshotId === undefined || options.targetSnapshotId === undefined)) {
      throw new Error('Take two heap snapshots in this tab before comparing them')
    }
    const find = (id: string | undefined, fallback: HeapSnapshotSummary | undefined): HeapSnapshotSummary => {
      const found = id === undefined ? fallback : list.find(item => item.id === id)
      if (!found) throw new Error(`No heap snapshot ${id ?? ''} is kept for this tab; list-heap-snapshots names the kept ones`.replace('  ', ' '))
      return found
    }
    // By default the two latest, oldest first.
    const base = find(options.baseSnapshotId, list.at(-2))
    const target = find(options.targetSnapshotId, list.at(-1))
    if (base === target) throw new Error('Compare two different heap snapshots')
    const baseClasses = new Map(base.classes.map(item => [item.name, item]))
    const targetClasses = new Map(target.classes.map(item => [item.name, item]))
    const changes: HeapSnapshotClassChange[] = []
    for (const name of new Set([...baseClasses.keys(), ...targetClasses.keys()])) {
      const before = baseClasses.get(name)
      const after = targetClasses.get(name)
      const change = {
        name,
        baseCount: before?.count ?? 0,
        targetCount: after?.count ?? 0,
        countDelta: (after?.count ?? 0) - (before?.count ?? 0),
        baseSelfBytes: before?.selfBytes ?? 0,
        targetSelfBytes: after?.selfBytes ?? 0,
        selfBytesDelta: (after?.selfBytes ?? 0) - (before?.selfBytes ?? 0)
      }
      if (change.countDelta !== 0 || change.selfBytesDelta !== 0) changes.push(change)
    }
    changes.sort((a, b) => b.selfBytesDelta - a.selfBytesDelta || b.countDelta - a.countDelta || (a.name < b.name ? -1 : 1))
    return {
      baseId: base.id,
      targetId: target.id,
      totalSelfBytesDelta: target.totalSelfBytes - base.totalSelfBytes,
      nodeCountDelta: target.nodeCount - base.nodeCount,
      nativeContextsDelta: target.nativeContexts - base.nativeContexts,
      detachedNodesDelta: target.detached.nodes - base.detached.nodes,
      detachedDocumentsDelta: target.detached.documents - base.detached.documents,
      changes: changes.slice(0, limit),
      truncated: changes.length > limit
    }
  }

  private report(tab: Tab, action: HeapSnapshotAction, list: HeapSnapshotSummary[]): HeapSnapshotReport {
    return {
      tabId: tab.id,
      url: redactNetworkUrl(tab.url),
      action,
      snapshots: list.map(({ classes, ...rest }) => ({ ...rest, classes: classes.length })),
      caveats: [...CAVEATS]
    }
  }
}
