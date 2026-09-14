import { describe, expect, it } from 'vitest'
import {
  BROWSER_SNAPSHOT_FORMAT_VERSION,
  boundedSnapshotDelta,
  snapshotDeltaChanges,
  snapshotDeltaInvalidationReason
} from '../src/shared/snapshot-delta.js'

describe('bounded semantic snapshot deltas', () => {
  it('returns unchanged without repeating the snapshot', () => {
    const snapshot = 'URL: https://example.test/\nTITLE: Inbox\nh1: Messages\n[e1] button "Compose"\nTEXT: Messages Compose'
    const result = boundedSnapshotDelta(snapshot, snapshot, 1_000, { baselineId: 'baseline-1' })

    expect(result).toMatchObject({
      status: 'unchanged',
      baselineId: 'baseline-1',
      changeCounts: { added: 0, removed: 0, updated: 0 },
      returnedChanges: 0,
      truncated: false,
      changes: []
    })
    expect(JSON.stringify(result)).not.toContain('Messages Compose')
  })

  it('distinguishes deterministic additions, removals, and updates', () => {
    const changes = snapshotDeltaChanges(
      'URL: https://example.test/one\nTITLE: Before\nh1: Kept\nh2: Removed\n[e1] button "Save"\nTEXT: alpha old omega',
      'URL: https://example.test/one\nTITLE: After\nh1: Kept\nh3: Added\n[e1] button "Saved"\nTEXT: alpha new omega'
    )

    expect(changes).toEqual([
      { kind: 'updated', key: 'title', before: 'TITLE: Before', after: 'TITLE: After' },
      { kind: 'added', key: 'h3:1', after: 'h3: Added' },
      { kind: 'updated', key: 'control:e1', before: '[e1] button "Save"', after: '[e1] button "Saved"' },
      { kind: 'updated', key: 'text', before: 'TEXT: alpha old omega', after: 'TEXT: alpha new omega' },
      { kind: 'removed', key: 'h2:1', before: 'h2: Removed' }
    ])
  })

  it('bounds large changes and reports the complete counts honestly', () => {
    const before = `URL: https://example.test/\nTITLE: Before\nTEXT: ${'a'.repeat(8_000)}`
    const after = `URL: https://example.test/\nTITLE: After\n${Array.from({ length: 80 }, (_, index) => `h1: Added ${index}`).join('\n')}\nTEXT: ${'b'.repeat(8_000)}`
    const result = boundedSnapshotDelta(before, after, 1_000)

    expect(result.status).toBe('changed')
    expect(result.changeCounts).toEqual({ added: 80, removed: 0, updated: 2 })
    expect(result.returnedChanges).toBeLessThan(82)
    expect(result.truncated).toBe(true)
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1_000)
    expect(JSON.stringify(result)).not.toContain('a'.repeat(1_000))
  })

  it('gives stable reasons for stale browser context', () => {
    const baseline = {
      tabId: 'tab-1', workspaceId: 'workspace-1', navigationGeneration: 2, observationGeneration: 3,
      humanInteractionGeneration: 4,
      snapshotFormatVersion: BROWSER_SNAPSHOT_FORMAT_VERSION
    }

    expect(snapshotDeltaInvalidationReason(baseline, baseline)).toBeUndefined()
    expect(snapshotDeltaInvalidationReason(baseline, { ...baseline, tabId: 'tab-2' })).toBe('tab-changed')
    expect(snapshotDeltaInvalidationReason(baseline, { ...baseline, workspaceId: 'workspace-2' })).toBe('workspace-changed')
    expect(snapshotDeltaInvalidationReason(baseline, { ...baseline, navigationGeneration: 3 })).toBe('navigation')
    expect(snapshotDeltaInvalidationReason(baseline, { ...baseline, observationGeneration: 4 })).toBe('workspace-control')
    expect(snapshotDeltaInvalidationReason(baseline, { ...baseline, humanInteractionGeneration: 5 })).toBe('human-input')
    expect(snapshotDeltaInvalidationReason(baseline, { ...baseline, snapshotFormatVersion: 2 })).toBe('snapshot-format')
  })
})
