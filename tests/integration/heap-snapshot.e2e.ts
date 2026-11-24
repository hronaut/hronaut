import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('takes heap snapshot summaries and finds a removed frame the page still holds', async ({ capabilities }) => {
  const { client, tabId, redactedFixtureUrl } = capabilities
  const call = async (args: Record<string, unknown>) => {
    const result = await client.callTool({ name: 'browser_memory', arguments: { tabId, ...args } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return { raw: text(result), report: JSON.parse(text(result)) }
  }

  const before = await call({ action: 'take-heap-snapshot', label: 'before', limit: 5 })
  expect(before.report).toMatchObject({ tabId, url: redactedFixtureUrl, action: 'take-heap-snapshot', snapshot: { label: 'before', url: redactedFixtureUrl } })
  expect(before.report.snapshot.classes).toHaveLength(5)
  expect(before.report.snapshot.nativeContexts).toBeGreaterThan(0)

  const leaked = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: `new Promise((resolve) => {
        class HeapSnapshotLeak { constructor (index) { this.secret = 'heap-snapshot-secret-' + index } }
        window.__heapLeaks = Array.from({ length: 300 }, (_, index) => new HeapSnapshotLeak(index))
        const frame = document.createElement('iframe')
        frame.srcdoc = '<p>heap-snapshot-frame-secret</p>'
        frame.onload = () => { window.__heldWindow = frame.contentWindow; window.__heldDocument = frame.contentDocument; frame.remove(); resolve(true) }
        document.body.append(frame)
      })`
    }
  }) as CallToolResult
  expect(leaked.isError, text(leaked)).not.toBe(true)

  await call({ action: 'take-heap-snapshot', label: 'after' })
  const compared = await call({ action: 'compare-heap-snapshots', limit: 200 })
  expect(compared.report.snapshots.map((item: { label: string }) => item.label)).toEqual(['before', 'after'])
  expect(compared.report.comparison.detachedDocumentsDelta).toBeGreaterThanOrEqual(1)
  expect(compared.report.comparison.changes).toContainEqual(expect.objectContaining({ name: 'HeapSnapshotLeak', countDelta: 300 }))
  expect(compared.raw).not.toMatch(/heap-snapshot-(frame-)?secret|top-level-navigation-secret/)

  expect((await call({ action: 'clear-heap-snapshots' })).report).toMatchObject({ cleared: 2, snapshots: [] })
})
