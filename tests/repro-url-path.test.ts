import { expect, it } from 'vitest'
import { reproCheckpointSchema } from '../src/shared/repro-checkpoint.js'
import { validReproUrlPath } from '../src/shared/repro-url-path.js'
import { formatReproAsPlaywright } from '../src/shared/repro-export.js'
import type { BrowserReproRecording } from '../src/shared/types.js'

it('accepts an explicit reviewed URL-path expectation without a DOM selector', () => {
  const request = { context: 'c9a69713-c421-4d51-913e-0f7e74248acd', condition: 'urlPath', path: '/orders/complete', reviewed: true }
  expect(reproCheckpointSchema.safeParse(request).success).toBe(true)
})

it.each(['/', '/orders/complete', '/%E2%9C%93', '/a%20b', '/%3F%23', '/' + 'a'.repeat(2047)])('accepts serialized pathname %s', path => {
  expect(validReproUrlPath(path)).toBe(true)
})

it.each(['', 'orders', '//other.test/path', 'https://other.test/path', '/a?token=secret', '/a#secret', '/a\\b', '/a/../b', '/a/./b', '/a\n', '/a b', '/✓', '/%q0', '/%', '/' + 'a'.repeat(2048), null, 12])('rejects noncanonical or excessive pathname %s', path => {
  expect(validReproUrlPath(path)).toBe(false)
})

it.each([{ selector: 'body' }, { text: 'private' }, { count: 1 }, { reviewed: false }])('rejects ambiguous/unreviewed requests %j', extra => {
  expect(reproCheckpointSchema.safeParse({ context: 'c9a69713-c421-4d51-913e-0f7e74248acd', condition: 'urlPath', path: '/', reviewed: true, ...extra }).success).toBe(false)
})

const recording = (): BrowserReproRecording => ({
  formatVersion: 4, tabId: 'tab', title: 'Path fixture', active: false, stepCount: 1, truncated: false, caveats: [],
  steps: [{ index: 1, kind: 'expect', occurredAt: '2026-10-10T00:00:00Z', elapsedMs: 0, url: 'https://example.test/wrong', description: 'Expected path', expectation: { condition: 'urlPath', path: '/orders/complete', observedMatch: false } }]
})

it('exports reviewed intent independently of a mismatching observation', () => {
  const code = formatReproAsPlaywright(recording())
  expect(code).toContain("await expect(page).toHaveURL(url => ['http:', 'https:'].includes(url.protocol) && url.pathname === \"/orders/complete\")")
  expect(code).not.toContain('TODO: replace this line')
  expect(code).not.toContain('/wrong')
})

it.each(['version', 'path', 'target', 'match', 'text', 'count'])('keeps malformed %s path records explicit TODOs', change => {
  const value = recording(), step = value.steps[0]!
  if (change === 'version') value.formatVersion = 3
  if (change === 'path') step.expectation!.path = '/?secret'
  if (change === 'target') step.target = { selector: 'body', tag: 'body' }
  if (change === 'match') delete (step.expectation as Partial<typeof step.expectation>)!.observedMatch
  if (change === 'text') step.expectation!.text = 'private'
  if (change === 'count') step.expectation!.count = 1
  const code = formatReproAsPlaywright(value)
  expect(code).not.toContain('toHaveURL')
  expect(code).toContain('TODO: replace this line')
})

it('requires a new final checkpoint after a subsequent action', () => {
  const value = recording()
  value.steps.push({ index: 2, kind: 'navigate', url: 'https://example.test/next', occurredAt: '', elapsedMs: 1, description: 'Navigate' })
  expect(formatReproAsPlaywright(value)).toContain('TODO: replace this line')
})

it('retains count assertions in version 4 recordings', () => {
  const value = recording()
  value.steps.push({ index: 2, kind: 'expect', occurredAt: '', elapsedMs: 1, url: 'https://example.test', description: 'Count', target: { selector: 'ul > li', tag: 'li' }, expectation: { condition: 'count', count: 0, observedMatch: false } })
  const code = formatReproAsPlaywright(value)
  expect(code).toContain('toHaveURL')
  expect(code).toContain('toHaveCount(0)')
  expect(code).not.toContain('TODO: replace this line')
})
