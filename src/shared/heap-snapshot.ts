/** Bounds of the heap snapshots browser_memory takes, keeps and compares. */
export const HEAP_SNAPSHOT_LIMITS = {
  /** A snapshot larger than this, as Chromium streams it, is dropped rather than parsed. */
  maxSnapshotBytes: 384 * 1024 * 1024,
  /** Summaries kept per tab; taking another drops the oldest. */
  maxSnapshotsPerTab: 4,
  /** Classes a summary keeps, largest self size first; the rest are counted together. */
  maxClasses: 5000,
  defaultLimit: 30,
  maxLimit: 200,
  maxLabelChars: 80,
  maxClassNameChars: 120
} as const

/** One class of objects in a snapshot: how many there are and the bytes they hold themselves (not what they retain). */
export interface HeapSnapshotClass {
  name: string
  count: number
  selfBytes: number
}

/**
 * What Hronaut keeps of a heap snapshot: per-class counts and self sizes, DOM nodes no longer in a document that the
 * heap still holds, and the number of JavaScript contexts (a page, frame or worker each have one). Never object values,
 * strings, source code or the graph itself.
 */
export interface HeapSnapshotSummary {
  id: string
  label?: string
  takenAt: string
  url: string
  nodeCount: number
  totalSelfBytes: number
  classes: HeapSnapshotClass[]
  /** Classes beyond maxClasses, counted together. */
  otherClasses: { classes: number; count: number; selfBytes: number }
  detached: {
    /** DOM nodes Chromium marks as detached from every document but still held by the heap. */
    nodes: number
    selfBytes: number
    /** Documents among them: a removed frame's or a replaced document whose window something still holds. */
    documents: number
    byName: HeapSnapshotClass[]
  }
  /** V8 native contexts: one per page, frame and realm; more after closing frames points at retained windows. */
  nativeContexts: number
}

export interface HeapSnapshotClassChange {
  name: string
  baseCount: number
  targetCount: number
  countDelta: number
  baseSelfBytes: number
  targetSelfBytes: number
  selfBytesDelta: number
}

export interface HeapSnapshotComparison {
  baseId: string
  targetId: string
  totalSelfBytesDelta: number
  nodeCountDelta: number
  nativeContextsDelta: number
  detachedNodesDelta: number
  detachedDocumentsDelta: number
  /** Classes whose count or size changed, largest self-size growth first. */
  changes: HeapSnapshotClassChange[]
  truncated: boolean
}

/** A class name as a summary may show it: native DOM wrappers by tag only, system names by kind, no URLs or long text. */
export function heapClassName(type: string, name: string): string {
  if (type !== 'object' && type !== 'native') return `(${type})`
  let normalized = name.replace(/\p{Cc}/gu, ' ').trim()
  const element = /^(Detached )?<([A-Za-z][\w:-]*)/.exec(normalized)
  if (element) return `${element[1] ?? ''}<${element[2]!.toLowerCase()}>`
  if (normalized.startsWith('system / ')) return normalized.split(' / ').slice(0, 2).join(' / ')
  const slash = normalized.indexOf(' / ')
  // Names such as "Window / https://app.example/path" carry the document's URL.
  if (slash > 0) normalized = normalized.slice(0, slash)
  if (normalized === '') return '(anonymous)'
  return normalized.slice(0, HEAP_SNAPSHOT_LIMITS.maxClassNameChars)
}
