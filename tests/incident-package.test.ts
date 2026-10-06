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

it('bounds aggregate expansion across many individually small strings', async () => {
  const { service, source } = fixture()
  source.steps = Array.from({ length: 100 }, (_, index) => ({ occurredAt: new Date(now).toISOString(), index, description: 'a'.repeat(100) }))
  const draft = await service.capture(1, { tabId: 'tab', minutes: 1, kinds: ['repro'] })
  expect(() => service.review(1, { draftId: draft.draftId, include: ['repro'], replacements: [{ find: 'a', replacement: 'b'.repeat(256) }] })).toThrow('size limit')
})


it('rejects replacement key collisions without losing evidence or retaining an older export approval', async () => {
  const { service, source } = fixture()
  const original = structuredClone(source)
  const draft = await service.capture(1, { tabId: 'tab', minutes: 1, kinds: ['repro'] })
  const request = { draftId: draft.draftId, include: ['repro'], replacements: [] }
  const previous = service.review(1, request)
  expect(() => service.review(1, { ...request, replacements: [{ find: 'description', replacement: 'index' }] })).toThrow('merge fields')
  expect(() => service.export(1, draft.draftId, previous.previewId)).toThrow('changed')
  expect(source).toEqual(original)
  const corrected = service.review(1, { ...request, replacements: [{ find: 'private-canary', replacement: '[REMOVED]' }] })
  expect(corrected.html).toContain('&quot;description&quot;')
  expect(corrected.html).toContain('&quot;index&quot;')
  expect(corrected.html).not.toContain('private-canary')
})

it('omits exact fields recursively before replacement without retaining names or source values', async () => {
  const { service, source } = fixture()
  const original = structuredClone(source)
  const draft = await service.capture(1, { tabId: 'tab', minutes: 1, kinds: ['repro'] })
  const preview = service.review(1, { draftId: draft.draftId, include: ['repro'], omitFields: ['description'], replacements: [] })
  expect(preview.html).not.toContain('private-canary')
  expect(preview.html).not.toContain('description')
  expect(preview.html).toContain('exact-field-omission')
  expect(preview.html).toContain('&quot;occurrences&quot;: 1')
  expect(preview.html).toContain('&quot;index&quot;: 1')
  expect(source).toEqual(original)
  expect(service.export(1, draft.draftId, preview.previewId)).toEqual(preview)
})

it('preserves array positions and case-sensitive unmatched fields while omitting nested containers', async () => {
  const { service, source } = fixture()
  const draft = await service.capture(1, { tabId: 'tab', minutes: 1, kinds: ['repro'] })
  const unmatched = service.review(1, { draftId: draft.draftId, include: ['repro'], omitFields: ['Description', '0'], replacements: [] })
  expect(unmatched.html).toContain('private-canary')
  const omitted = service.review(1, { draftId: draft.draftId, include: ['repro'], omitFields: ['steps'], replacements: [{ find: 'private-canary', replacement: 'must-not-reappear' }] })
  expect(omitted.html).not.toContain('private-canary')
  expect(omitted.html).not.toContain('must-not-reappear')
  expect(source.steps).toHaveLength(1)
})

it('bounds exact field omissions and rejects empty or duplicate names', async () => {
  const { service } = fixture()
  const draft = await service.capture(1, { tabId: 'tab', minutes: 1, kinds: ['repro'] })
  for (const omitFields of [[''], ['description', 'description'], ['a'.repeat(257)], Array.from({ length: 11 }, (_, i) => String(i))]) {
    expect(() => service.review(1, { draftId: draft.draftId, include: ['repro'], omitFields, replacements: [] })).toThrow()
  }
})

it('treats prototype-like names as literal own fields without changing object prototypes', async () => {
  const { service, source } = fixture()
  Object.defineProperty(source.steps[0], '__proto__', { value: { secret: 'prototype-canary' }, enumerable: true })
  const draft = await service.capture(1, { tabId: 'tab', minutes: 1, kinds: ['repro'] })
  const preview = service.review(1, { draftId: draft.draftId, include: ['repro'], omitFields: ['__proto__'], replacements: [] })
  expect(preview.html).not.toContain('prototype-canary')
  expect(preview.html).not.toContain('__proto__')
  expect(Object.getPrototypeOf(source.steps[0])).toBe(Object.prototype)
  expect(Object.hasOwn(source.steps[0]!, '__proto__')).toBe(true)
})

it('applies multiple literal replacements in order without modifying source evidence', async () => {
  const { service, source } = fixture()
  source.steps[0]!.description = 'private-first private-second'
  const original = structuredClone(source)
  const draft = await service.capture(1, { tabId: 'tab', minutes: 1, kinds: ['repro'] })
  const replacements = [
    { find: 'private-first', replacement: 'intermediate-marker' },
    { find: 'intermediate-marker', replacement: '' },
    { find: 'private-second', replacement: '[REMOVED]' }
  ]
  const preview = service.review(1, { draftId: draft.draftId, include: ['repro'], replacements })
  expect(preview.html).not.toContain('private-first')
  expect(preview.html).not.toContain('private-second')
  expect(preview.html).not.toContain('intermediate-marker')
  expect(preview.html).toContain('[REMOVED]')
  expect(source).toEqual(original)
  expect(() => service.review(1, { draftId: draft.draftId, include: ['repro'], replacements: Array.from({ length: 11 }, () => ({ find: 'x', replacement: '' })) })).toThrow()
})

it('scopes paths before global omissions and replacements without retaining paths in the manifest', async () => {
  const { service, source } = fixture()
  source.steps.push({ occurredAt: new Date(now).toISOString(), description: 'sibling-kept', index: 2 })
  const original = structuredClone(source)
  const draft = await service.capture(1, { tabId: 'tab', minutes: 1, kinds: ['repro'] })
  const preview = service.review(1, { draftId: draft.draftId, include: ['repro'], omitPaths: [{ artifact: 'repro', path: ['steps', 0, 'description'] }], omitFields: ['index'], replacements: [{ find: 'sibling-kept', replacement: 'sibling-reviewed' }] })
  expect(preview.html).not.toContain('private-canary')
  expect(preview.html).toContain('sibling-reviewed')
  const manifest = preview.html.split('<h2>Manifest</h2><pre>')[1]!.split('</pre>')[0]!
  expect(manifest).toContain('exact-path-omission')
  expect(manifest).not.toMatch(/description|steps|private-canary/)
  expect(preview.html).not.toContain('&quot;index&quot;')
  expect(source).toEqual(original)
  expect(service.export(1, draft.draftId, preview.previewId)).toEqual(preview)
})
it.each([
  { omitPaths: [{ artifact: 'repro', path: ['steps', 0, 'missing-private-token'] }] },
  { omitPaths: [{ artifact: 'network', path: ['entries'] }] },
  { omitPaths: [{ artifact: 'repro', path: [] }] },
  { 'private-unrecognized-key': true }, { draftId: 'private-invalid-id' }
])('invalid review retires the previous preview and keeps errors bounded: %#', invalid => {
  return (async () => {
    const { service } = fixture()
    const draft = await service.capture(1, { tabId: 'tab', minutes: 1, kinds: ['repro'] })
    const request = { draftId: draft.draftId, include: ['repro'], replacements: [] }
    const preview = service.review(1, request)
    expect(() => service.review(1, { ...request, ...invalid })).toThrow()
    try { service.review(1, { ...request, ...invalid }) } catch (error) { expect(String(error)).not.toMatch(/private-/) }
    expect(() => service.export(1, draft.draftId, preview.previewId)).toThrow('changed')
    expect(service.review(1, request).sha256).toBe(preview.sha256)
  })()
})
it('does not let a stale draft edit invalidate a newer preview or another owner', async () => {
  const { service } = fixture()
  const old = await service.capture(1, { tabId: 'tab', minutes: 1, kinds: ['repro'] })
  const current = await service.capture(1, { tabId: 'tab', minutes: 1, kinds: ['repro'] })
  const preview = service.review(1, { draftId: current.draftId, include: ['repro'], replacements: [] })
  service.invalidatePreview(1, old.draftId)
  service.invalidatePreview(2, current.draftId)
  expect(service.export(1, current.draftId, preview.previewId)).toEqual(preview)
  service.invalidatePreview(1, current.draftId)
  expect(() => service.export(1, current.draftId, preview.previewId)).toThrow('changed')
})
