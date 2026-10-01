import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { IncidentPackages } from '../src/main/incident-package.js'
import type { BrowserTabsManager } from '../src/main/browser/tabs-manager.js'

const now = Date.parse('2026-10-01T01:00:00Z')
function fixture() {
  const tab = { id: 'tab', navigationGeneration: 1, observationGeneration: 1 }
  const source = { active: false, steps: [{ occurredAt: new Date(now).toISOString(), description: '<script>fetch("https://private.test")</script> private-canary password=secret-token', index: 1 }], caveats: [], truncated: true }
  const host = {
    getState: () => ({ tabs: [tab] }),
    reproRecording: vi.fn(async () => source),
    networkHar: vi.fn(async () => ({ log: { entries: [] }, _hronaut: { truncated: false, caveats: [] } })),
    debugReport: vi.fn(() => ({ console: [], network: [], caveats: [], truncated: { console: false, network: false } }))
  }
  const service = new IncidentPackages(() => host as unknown as BrowserTabsManager, 'test', () => now)
  return { service, host, source, tab }
}
afterEach(() => vi.useRealTimers())
it('freezes reviewed bytes, omits artifacts, removes replacement originals and leaves source untouched', async () => {
  const { service, source } = fixture()
  const original = structuredClone(source)
  const draft = await service.capture(1, { tabId: 'tab', minutes: 10, kinds: ['repro', 'network'] })
  const preview = service.review(1, { draftId: draft.draftId, include: ['repro'], replacements: [{ find: 'private-canary', replacement: '[REMOVED]' }] })
  expect(preview.html).not.toContain('private-canary')
  expect(preview.html).not.toContain('secret-token')
  expect(preview.html).not.toContain('<script>')
  expect(preview.html).toContain('&lt;script&gt;')
  expect(preview.html).toContain('&quot;status&quot;: &quot;omitted&quot;')
  expect(preview.sha256).toBe(createHash('sha256').update(preview.html).digest('hex'))
  expect(source).toEqual(original)
  source.steps[0]!.description = 'new live evidence'
  expect(service.export(1, draft.draftId, preview.previewId)).toEqual(preview)
  expect(() => service.export(2, draft.draftId, preview.previewId)).toThrow('missing')
})
it('reports empty, unavailable and oversized evidence without leaking exception text', async () => {
  const { service, host, source } = fixture()
  host.networkHar.mockRejectedValueOnce(new Error('private exception token'))
  source.steps[0]!.description = 'x'.repeat(300000)
  const draft = await service.capture(1, { tabId: 'tab', minutes: 1, kinds: ['repro', 'network', 'diagnostics'] })
  expect(draft.artifacts.map(a => a.status)).toEqual(['oversize', 'unavailable', 'empty'])
  expect(JSON.stringify(draft)).not.toContain('private exception')
})
it('filters the time window and refuses expired or replaced reviews', async () => {
  const { host, source } = fixture()
  let time = now
  const service = new IncidentPackages(() => host as unknown as BrowserTabsManager, 'test', () => time)
  source.steps[0]!.occurredAt = new Date(now - 120000).toISOString()
  const draft = await service.capture(1, { tabId: 'tab', minutes: 1, kinds: ['repro'] })
  expect(draft.artifacts[0]?.status).toBe('empty')
  const request = { draftId: draft.draftId, include: ['repro'], replacements: [] }
  const first = service.review(1, request)
  service.review(1, request)
  expect(() => service.export(1, draft.draftId, first.previewId)).toThrow('changed')
  time += 600001
  expect(() => service.review(1, request)).toThrow('expired')
})
it.each(['discard', 'navigate'])('rejects a capture when %s happens during a read', async action => {
  const { service, host, source, tab } = fixture()
  let resolve!: (value: typeof source) => void
  host.reproRecording.mockImplementationOnce(() => new Promise(r => { resolve = r }))
  const pending = service.capture(1, { tabId: 'tab', minutes: 1, kinds: ['repro'] })
  if (action === 'discard') service.discard(1)
  else tab.navigationGeneration++
  resolve(source)
  await expect(pending).rejects.toThrow('context changed')
})
it('bounds stalled capture time', async () => {
  vi.useFakeTimers()
  const { service, host } = fixture()
  host.reproRecording.mockImplementationOnce(() => new Promise(() => undefined))
  const pending = expect(service.capture(1, { tabId: 'tab', minutes: 1, kinds: ['repro'] })).rejects.toThrow('time limit')
  await vi.advanceTimersByTimeAsync(30001)
  await pending
})
it('rejects invalid selection, time, replacement and artifact bounds', async () => {
  const { service } = fixture()
  await expect(service.capture(1, { tabId: 'tab', minutes: 61, kinds: ['repro'] })).rejects.toThrow()
  await expect(service.capture(1, { tabId: 'tab', minutes: 1, kinds: [] })).rejects.toThrow()
  const draft = await service.capture(1, { tabId: 'tab', minutes: 1, kinds: ['repro'] })
  expect(() => service.review(1, { draftId: draft.draftId, include: ['network'], replacements: [] })).toThrow('not captured')
  expect(() => service.review(1, { draftId: draft.draftId, include: ['repro'], replacements: [{ find: '', replacement: '' }] })).toThrow()
})

it('bounds replacement expansion before allocating an oversized result', async () => {
  const { service, source } = fixture()
  source.steps[0]!.description = 'a'.repeat(10000)
  const draft = await service.capture(1, { tabId: 'tab', minutes: 1, kinds: ['repro'] })
  expect(() => service.review(1, { draftId: draft.draftId, include: ['repro'], replacements: [{ find: 'a', replacement: 'a'.repeat(256) }] })).toThrow('size limit')
})
