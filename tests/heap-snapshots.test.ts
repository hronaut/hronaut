import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { heapClassName } from '../src/shared/heap-snapshot.js'
import { summarizeHeapSnapshot } from '../src/main/browser/heap-snapshot/heap-snapshot-summary.js'
import { HeapSnapshots, type HeapSnapshotTab } from '../src/main/browser/heap-snapshot/heap-snapshots.js'

const FIELDS = ['type', 'name', 'id', 'self_size', 'edge_count', 'detachedness']
const TYPES = ['hidden', 'array', 'string', 'object', 'code', 'closure', 'regexp', 'number', 'native', 'synthetic']

/** A snapshot in V8's format with these nodes: [type, name, self size, detachedness]. */
function rawSnapshot(nodes: Array<[string, string, number, number?]>) {
  const strings: string[] = []
  const flat: number[] = []
  nodes.forEach(([type, name, size, detached], index) => {
    let at = strings.indexOf(name)
    if (at < 0) at = strings.push(name) - 1
    flat.push(TYPES.indexOf(type), at, index * 2 + 1, size, 0, detached ?? 0)
  })
  return { snapshot: { meta: { node_fields: FIELDS, node_types: [TYPES, 'string'] }, node_count: nodes.length }, nodes: flat, edges: [], strings }
}

describe('heap snapshot summaries', () => {
  it('names classes as DevTools groups them, without URLs, attributes or long text', () => {
    expect(heapClassName('object', 'LeakyThing')).toBe('LeakyThing')
    expect(heapClassName('object', 'Window / https://app.example/private?token=1')).toBe('Window')
    expect(heapClassName('native', '<iframe srcdoc="&lt;p&gt;secret">')).toBe('<iframe>')
    expect(heapClassName('native', 'Detached <DIV class="card">')).toBe('Detached <div>')
    expect(heapClassName('native', 'system / NativeContext / https://app.example/')).toBe('system / NativeContext')
    expect(heapClassName('string', 'password=hunter2')).toBe('(string)')
    expect(heapClassName('closure', 'onSecret')).toBe('(closure)')
    expect(heapClassName('object', 'x'.repeat(500))).toHaveLength(120)
  })

  it('counts classes, detached DOM nodes and documents, and native contexts, and keeps no strings', () => {
    const summary = summarizeHeapSnapshot(rawSnapshot([
      ['object', 'LeakyThing', 16], ['object', 'LeakyThing', 16], ['array', '', 400], ['string', 'hunter2-secret', 32],
      ['native', 'system / NativeContext / https://app.example/', 1244], ['native', 'system / NativeContext', 1244],
      ['native', 'HTMLDocument', 200, 2], ['native', '<div class="secret">', 80, 2], ['native', '<div>', 80, 1]
    ]))
    expect(summary.nodeCount).toBe(9)
    expect(summary.totalSelfBytes).toBe(16 + 16 + 400 + 32 + 1244 * 2 + 200 + 80 + 80)
    expect(summary.classes).toContainEqual({ name: 'LeakyThing', count: 2, selfBytes: 32 })
    expect(summary.classes).toContainEqual({ name: '<div>', count: 2, selfBytes: 160 })
    expect(summary.classes[0]).toEqual({ name: 'system / NativeContext', count: 2, selfBytes: 2488 })
    expect(summary.nativeContexts).toBe(2)
    expect(summary.detached).toEqual({ nodes: 2, selfBytes: 280, documents: 1, byName: [{ name: 'HTMLDocument', count: 1, selfBytes: 200 }, { name: '<div>', count: 1, selfBytes: 80 }] })
    expect(JSON.stringify(summary)).not.toMatch(/hunter2|secret|app\.example/)
  })

  it('refuses what is not a V8 snapshot', () => {
    expect(() => summarizeHeapSnapshot({})).toThrow('not in V8')
    expect(() => summarizeHeapSnapshot({ snapshot: { meta: { node_fields: ['type'], node_types: [TYPES] } }, nodes: [0], strings: [] })).toThrow('not in V8')
  })
})

/** A tab whose debugger streams the given snapshot in chunks when asked for one. */
function fixture() {
  const contents = new EventEmitter() as EventEmitter & Record<string, unknown>
  const debuggerEvents = new EventEmitter() as EventEmitter & Record<string, unknown>
  const sent: string[] = []
  let next: unknown = rawSnapshot([['object', 'Thing', 10]])
  let onSnapshot: (() => void) | undefined
  debuggerEvents.sendCommand = async (method: string) => {
    sent.push(method)
    if (method === 'HeapProfiler.takeHeapSnapshot') {
      const text = JSON.stringify(next)
      for (let at = 0; at < text.length; at += 64) debuggerEvents.emit('message', {}, 'HeapProfiler.addHeapSnapshotChunk', { chunk: text.slice(at, at + 64) })
      onSnapshot?.()
    }
    return {}
  }
  Object.assign(contents, { debugger: debuggerEvents, isDestroyed: () => false })
  const tab: HeapSnapshotTab = { id: 'tab-1', url: 'https://app.example/dashboard?session=abc', navigationGeneration: 1, webContents: contents as unknown as WebContents }
  let sampling = false
  const snapshots = new HeapSnapshots<HeapSnapshotTab>({
    getTab: () => tab,
    findTab: (id) => id === tab.id ? tab : undefined,
    withDebugger: (_contents, operation) => operation(),
    allocationSampling: () => sampling
  })
  return {
    tab, sent, snapshots,
    setNext: (value: unknown) => { next = value },
    duringSnapshot: (run: () => void) => { onSnapshot = run },
    setSampling: (value: boolean) => { sampling = value },
    listeners: () => debuggerEvents.listenerCount('message')
  }
}

describe('heap snapshot controller', () => {
  it('takes snapshots through the debugger, parses them in a worker and compares the two latest', async () => {
    const { snapshots, sent, setNext, listeners } = fixture()
    setNext(rawSnapshot([['object', 'Thing', 10], ['object', 'Keep', 5]]))
    const first = await snapshots.manage({ action: 'take-heap-snapshot', label: 'before' })
    expect(sent).toEqual(['HeapProfiler.enable', 'HeapProfiler.takeHeapSnapshot', 'HeapProfiler.disable'])
    expect(listeners()).toBe(0)
    expect(first.snapshot).toMatchObject({ id: expect.stringMatching(/^heap-/), label: 'before', nodeCount: 2, url: expect.not.stringContaining('abc') })
    setNext(rawSnapshot([['object', 'Thing', 10], ['object', 'Thing', 10], ['object', 'Thing', 10], ['native', 'HTMLDocument', 200, 2], ['object', 'Fresh', 7]]))
    await snapshots.manage({ action: 'take-heap-snapshot', label: 'after' })

    const { comparison, snapshots: kept } = await snapshots.manage({ action: 'compare-heap-snapshots' })
    expect(kept.map(item => item.label)).toEqual(['before', 'after'])
    expect(comparison).toMatchObject({ baseId: first.snapshot!.id, nodeCountDelta: 3, detachedDocumentsDelta: 1, detachedNodesDelta: 1, truncated: false })
    expect(comparison!.changes.map(change => [change.name, change.countDelta, change.selfBytesDelta])).toEqual([
      ['HTMLDocument', 1, 200], ['Thing', 2, 20], ['Fresh', 1, 7], ['Keep', -1, -5]
    ])
    expect((await snapshots.manage({ action: 'compare-heap-snapshots', limit: 1 })).comparison).toMatchObject({ truncated: true, changes: [{ name: 'HTMLDocument' }] })
  })

  it('keeps the HeapProfiler domain enabled while allocation sampling uses it, and keeps the last four snapshots', async () => {
    const { snapshots, sent, setSampling } = fixture()
    setSampling(true)
    await snapshots.manage({ action: 'take-heap-snapshot' })
    expect(sent).not.toContain('HeapProfiler.disable')
    for (let count = 0; count < 4; count++) await snapshots.manage({ action: 'take-heap-snapshot' })
    const listed = await snapshots.manage({ action: 'list-heap-snapshots' })
    expect(listed.snapshots).toHaveLength(4)
    expect(listed.snapshots[0]).toMatchObject({ classes: 1 })
    expect(listed.snapshots[0]).not.toHaveProperty('classes.0')
    expect((await snapshots.manage({ action: 'clear-heap-snapshots' })).cleared).toBe(4)
    await expect(snapshots.manage({ action: 'compare-heap-snapshots' })).rejects.toThrow('Take two heap snapshots')
  })

  it('discards a snapshot of a page that navigated meanwhile, one that is not V8\'s and one of an unknown id', async () => {
    const { snapshots, tab, duringSnapshot, setNext } = fixture()
    duringSnapshot(() => { tab.navigationGeneration++ })
    await expect(snapshots.manage({ action: 'take-heap-snapshot' })).rejects.toThrow('page changed')
    duringSnapshot(() => undefined)
    setNext({ nope: true })
    await expect(snapshots.manage({ action: 'take-heap-snapshot' })).rejects.toThrow('could not be read')
    expect((await snapshots.manage({ action: 'list-heap-snapshots' })).snapshots).toEqual([])
    setNext(rawSnapshot([['object', 'Thing', 10]]))
    await snapshots.manage({ action: 'take-heap-snapshot' })
    await expect(snapshots.manage({ action: 'compare-heap-snapshots', baseSnapshotId: 'heap-999', targetSnapshotId: 'heap-1' })).rejects.toThrow('No heap snapshot heap-999')
  })

  it('checks arguments before touching the page', async () => {
    const { snapshots, sent } = fixture()
    await expect(snapshots.manage({ action: 'list-heap-snapshots', label: 'x' })).rejects.toThrow('label is only for')
    await expect(snapshots.manage({ action: 'take-heap-snapshot', baseSnapshotId: 'heap-1' })).rejects.toThrow('only for action compare')
    await expect(snapshots.manage({ action: 'take-heap-snapshot', limit: 0 })).rejects.toThrow('limit must be')
    await expect(snapshots.manage({ action: 'take-heap-snapshot', label: '   ' })).rejects.toThrow('label must be')
    expect(sent).toEqual([])
    vi.restoreAllMocks()
  })
})
