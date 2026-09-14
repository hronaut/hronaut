export { BROWSER_SNAPSHOT_FORMAT_VERSION } from './snapshot.js'

export type BrowserSnapshotDeltaChangeKind = 'added' | 'removed' | 'updated'

export interface BrowserSnapshotDeltaChange {
  kind: BrowserSnapshotDeltaChangeKind
  key: string
  before?: string
  after?: string
}

export interface BrowserSnapshotDeltaCounts {
  added: number
  removed: number
  updated: number
}

export type BrowserSnapshotDeltaInvalidationReason =
  | 'baseline-not-found'
  | 'tab-changed'
  | 'workspace-changed'
  | 'navigation'
  | 'workspace-control'
  | 'human-input'
  | 'snapshot-format'

export interface BrowserSnapshotDeltaContext {
  tabId: string
  workspaceId: string | null
  navigationGeneration: number
  observationGeneration: number
  humanInteractionGeneration: number
  snapshotFormatVersion: number
}

export function snapshotDeltaInvalidationReason(
  baseline: BrowserSnapshotDeltaContext,
  current: BrowserSnapshotDeltaContext
): BrowserSnapshotDeltaInvalidationReason | undefined {
  if (baseline.snapshotFormatVersion !== current.snapshotFormatVersion) return 'snapshot-format'
  if (baseline.tabId !== current.tabId) return 'tab-changed'
  if (baseline.workspaceId !== current.workspaceId) return 'workspace-changed'
  if (baseline.observationGeneration !== current.observationGeneration) return 'workspace-control'
  if (baseline.navigationGeneration !== current.navigationGeneration) return 'navigation'
  if (baseline.humanInteractionGeneration !== current.humanInteractionGeneration) return 'human-input'
  return undefined
}

interface SnapshotNode {
  key: string
  value: string
}

function snapshotNodes(text: string): SnapshotNode[] {
  const occurrences = new Map<string, number>()
  return text.split('\n').map((value, index) => {
    let family = `line:${index + 1}`
    if (value.startsWith('URL: ')) family = 'url'
    else if (value.startsWith('TITLE: ')) family = 'title'
    else if (/^h[1-3]: /u.test(value)) family = value.slice(0, 2)
    else if (value.startsWith('TEXT: ')) family = 'text'
    else {
      const control = /^\[([^\]]+)\]/u.exec(value)
      if (control?.[1]) family = `control:${control[1]}`
    }
    if (family === 'url' || family === 'title' || family === 'text' || family.startsWith('control:')) {
      return { key: family, value }
    }
    const occurrence = (occurrences.get(family) ?? 0) + 1
    occurrences.set(family, occurrence)
    return { key: `${family}:${occurrence}`, value }
  })
}

function compactValue(value: string, other?: string, maximum = 360): string {
  if (value.length <= maximum) return value
  if (other === undefined) {
    const side = Math.floor((maximum - 1) / 2)
    return `${value.slice(0, side)}…${value.slice(value.length - side)}`
  }
  let prefix = 0
  const prefixLimit = Math.min(value.length, other.length)
  while (prefix < prefixLimit && value[prefix] === other[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < value.length - prefix
    && suffix < other.length - prefix
    && value[value.length - suffix - 1] === other[other.length - suffix - 1]
  ) suffix += 1
  const changedEnd = Math.max(prefix, value.length - suffix)
  const start = Math.max(0, prefix - Math.floor(maximum / 3))
  const end = Math.min(value.length, Math.max(changedEnd, prefix + 1) + Math.floor(maximum / 3))
  const excerpt = `${start > 0 ? '…' : ''}${value.slice(start, end)}${end < value.length ? '…' : ''}`
  return excerpt.length <= maximum ? excerpt : compactValue(excerpt, undefined, maximum)
}

export function snapshotDeltaChanges(before: string, after: string): BrowserSnapshotDeltaChange[] {
  const previous = snapshotNodes(before)
  const current = snapshotNodes(after)
  const previousByKey = new Map(previous.map((node) => [node.key, node.value]))
  const currentByKey = new Map(current.map((node) => [node.key, node.value]))
  const changes: BrowserSnapshotDeltaChange[] = []

  for (const node of current) {
    const previousValue = previousByKey.get(node.key)
    if (previousValue === undefined) {
      changes.push({ kind: 'added', key: node.key, after: compactValue(node.value) })
    } else if (previousValue !== node.value) {
      changes.push({
        kind: 'updated',
        key: node.key,
        before: compactValue(previousValue, node.value),
        after: compactValue(node.value, previousValue)
      })
    }
  }
  for (const node of previous) {
    if (!currentByKey.has(node.key)) {
      changes.push({ kind: 'removed', key: node.key, before: compactValue(node.value) })
    }
  }
  return changes
}

function deltaCounts(changes: BrowserSnapshotDeltaChange[]): BrowserSnapshotDeltaCounts {
  return changes.reduce<BrowserSnapshotDeltaCounts>((counts, change) => {
    counts[change.kind] += 1
    return counts
  }, { added: 0, removed: 0, updated: 0 })
}

export function boundedSnapshotDelta(
  before: string,
  after: string,
  maxOutputChars: number,
  metadata: Record<string, unknown> = {}
): Record<string, unknown> & {
  status: 'unchanged' | 'changed'
  changeCounts: BrowserSnapshotDeltaCounts
  returnedChanges: number
  maxOutputChars: number
  truncated: boolean
  changes: BrowserSnapshotDeltaChange[]
} {
  const allChanges = snapshotDeltaChanges(before, after)
  const base = {
    ...metadata,
    status: allChanges.length ? 'changed' as const : 'unchanged' as const,
    changeCounts: deltaCounts(allChanges),
    returnedChanges: 0,
    maxOutputChars,
    truncated: allChanges.length > 0,
    changes: [] as BrowserSnapshotDeltaChange[]
  }
  if (JSON.stringify(base).length > maxOutputChars) {
    throw new RangeError('Snapshot delta metadata exceeds maxOutputChars')
  }

  for (const change of allChanges) {
    const candidate = {
      ...base,
      returnedChanges: base.changes.length + 1,
      truncated: base.changes.length + 1 < allChanges.length,
      changes: [...base.changes, change]
    }
    if (JSON.stringify(candidate).length > maxOutputChars) break
    base.returnedChanges = candidate.returnedChanges
    base.truncated = candidate.truncated
    base.changes = candidate.changes
  }
  return base
}
