import { HEAP_SNAPSHOT_LIMITS, heapClassName, type HeapSnapshotClass, type HeapSnapshotSummary } from '../../../shared/heap-snapshot.ts'

// Runs in the heap snapshot worker as well as under test, so it imports by file name and uses no Electron module.

/** The parts of V8's .heapsnapshot format a summary reads. */
interface RawHeapSnapshot {
  snapshot: { meta: { node_fields: string[]; node_types: unknown[] } }
  nodes: number[]
  strings: string[]
}

export type HeapSnapshotCounts = Omit<HeapSnapshotSummary, 'id' | 'label' | 'takenAt' | 'url'>

/** Chromium's detachedness value for a DOM node no document holds. */
const DETACHED = 2

function largestFirst(classes: Map<string, { count: number; selfBytes: number }>): HeapSnapshotClass[] {
  return [...classes].map(([name, { count, selfBytes }]) => ({ name, count, selfBytes }))
    .sort((a, b) => b.selfBytes - a.selfBytes || b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * Per-class counts and self sizes of a parsed snapshot, as DevTools' Summary view groups them (objects and native
 * objects by constructor, everything else by kind), with detached DOM nodes and native contexts counted. Throws on a
 * snapshot that is not in V8's format.
 */
export function summarizeHeapSnapshot(raw: unknown): HeapSnapshotCounts {
  const snapshot = raw as RawHeapSnapshot
  const fields = snapshot?.snapshot?.meta?.node_fields
  const types = snapshot?.snapshot?.meta?.node_types?.[0]
  if (!Array.isArray(fields) || !Array.isArray(types) || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.strings)) {
    throw new Error('The heap snapshot is not in V8\'s format')
  }
  const width = fields.length
  const typeAt = fields.indexOf('type')
  const nameAt = fields.indexOf('name')
  const sizeAt = fields.indexOf('self_size')
  const detachedAt = fields.indexOf('detachedness')
  if (width === 0 || typeAt < 0 || nameAt < 0 || sizeAt < 0 || snapshot.nodes.length % width !== 0) {
    throw new Error('The heap snapshot is not in V8\'s format')
  }
  const classes = new Map<string, { count: number; selfBytes: number }>()
  const detachedClasses = new Map<string, { count: number; selfBytes: number }>()
  const nameCache = new Map<number, string>()
  let totalSelfBytes = 0
  let nativeContexts = 0
  let detachedNodes = 0
  let detachedBytes = 0
  let detachedDocuments = 0
  const { nodes, strings } = snapshot
  for (let index = 0; index < nodes.length; index += width) {
    const type = String(types[nodes[index + typeAt]!] ?? 'unknown')
    const nameIndex = nodes[index + nameAt]!
    const selfBytes = Math.max(0, nodes[index + sizeAt]!)
    totalSelfBytes += selfBytes
    const rawName = strings[nameIndex] ?? ''
    const key = type === 'object' || type === 'native' ? (nameCache.get(nameIndex) ?? heapClassName(type, rawName)) : `(${type})`
    if (type === 'object' || type === 'native') nameCache.set(nameIndex, key)
    if (type === 'native' && rawName.startsWith('system / NativeContext')) nativeContexts++
    const entry = classes.get(key)
    if (entry) { entry.count++; entry.selfBytes += selfBytes } else classes.set(key, { count: 1, selfBytes })
    if (detachedAt >= 0 && nodes[index + detachedAt] === DETACHED && type === 'native') {
      detachedNodes++
      detachedBytes += selfBytes
      if (key === 'HTMLDocument' || key === 'Document' || key === 'XMLDocument') detachedDocuments++
      const detached = detachedClasses.get(key)
      if (detached) { detached.count++; detached.selfBytes += selfBytes } else detachedClasses.set(key, { count: 1, selfBytes })
    }
  }
  const sorted = largestFirst(classes)
  const kept = sorted.slice(0, HEAP_SNAPSHOT_LIMITS.maxClasses)
  const rest = sorted.slice(HEAP_SNAPSHOT_LIMITS.maxClasses)
  return {
    nodeCount: nodes.length / width,
    totalSelfBytes,
    classes: kept,
    otherClasses: { classes: rest.length, count: rest.reduce((sum, item) => sum + item.count, 0), selfBytes: rest.reduce((sum, item) => sum + item.selfBytes, 0) },
    detached: { nodes: detachedNodes, selfBytes: detachedBytes, documents: detachedDocuments, byName: largestFirst(detachedClasses).slice(0, 50) },
    nativeContexts
  }
}
