// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { reproCheckpointSchema } from '../src/shared/repro-checkpoint.js'
import { reproCheckpointScript } from '../src/main/browser/repro-checkpoint-script.js'
import { javascriptLiteral } from '../src/shared/javascript-literal.js'
import { formatReproAsPlaywright } from '../src/shared/repro-export.js'
import type { BrowserReproRecording } from '../src/shared/types.js'

const request = { context: 'c9a69713-c421-4d51-913e-0f7e74248acd', selector: 'ul > li', condition: 'count' as const, count: 0, reviewed: true as const }
const recording: BrowserReproRecording = { formatVersion: 3, tabId: 'tab', title: 'Count', active: false, stepCount: 1, truncated: false, caveats: [], steps: [{ index: 1, kind: 'expect', occurredAt: '2026-10-01T00:00:00Z', elapsedMs: 1, url: 'https://example.test', description: 'Count', target: { selector: 'ul > li', tag: 'li' }, expectation: { condition: 'count', count: 0, observedMatch: false } }] }
afterEach(() => document.body.replaceChildren())

describe('bounded count checkpoints', () => {
  it.each([0, 1, 500])('accepts explicit integer %i', count => {
    expect(reproCheckpointSchema.parse({ ...request, count })).toMatchObject({ count })
  })
  it.each([undefined, '', '0', null, -1, 0.5, 501, NaN, Infinity])('rejects missing or invalid count %j', count => {
    expect(reproCheckpointSchema.safeParse({ ...request, count }).success).toBe(false)
  })
  it.each(['#private', '.private', 'input[value="private"]', 'li, p', 'ul li', 'ul>li', 'li:first-child', '*', 'li:nth-of-type(0)', 'li:nth-of-type(1000000)', 'li:nth-of-type(01)'])('rejects noncanonical selector %s', selector => {
    expect(reproCheckpointSchema.safeParse({ ...request, selector }).success).toBe(false)
  })
  it('requires review and forbids unrelated fields', () => {
    for (const changed of [{ reviewed: false }, { text: '' }, { condition: 'visible' }]) {
      expect(reproCheckpointSchema.safeParse({ ...request, ...changed }).success).toBe(false)
    }
  })
  it('counts hidden duplicates, zero and structural positions without reading contents', () => {
    document.body.innerHTML = '<ul><li>Same</li><li hidden>Same</li><li>Same</li></ul><section><input value="private-canary"></section>'
    for (const element of document.querySelectorAll('*')) {
      Object.defineProperty(element, 'textContent', { get() { throw new Error('No text read') } })
    }
    Object.defineProperty(document.querySelector('input'), 'value', { get() { throw new Error('No value read') } })
    for (const [selector, count, observedMatch] of [['ul > li', 3, true], ['ul > li', 2, false], ['ul > li:nth-of-type(2)', 1, true], ['aside', 0, true], ['section', 1, true]] as const) {
      expect(window.eval(reproCheckpointScript({ ...request, selector, count }))).toEqual({ selector, tag: selector.split(' > ').at(-1)!.split(':')[0], observedMatch })
    }
  })
  it.each(['input', 'textarea', 'select', 'iframe', 'frame', 'article', 'article > p'])('rejects a matching excluded target %s instead of filtering', selector => {
    document.body.innerHTML = '<input><textarea></textarea><select></select><iframe></iframe><article contenteditable><p>Draft</p></article>'
    document.body.append(document.createElement('frame'))
    expect(window.eval(reproCheckpointScript({ ...request, selector }))).toEqual({ error: 'excluded-target' })
  })
  it('does not enter shadow roots or frame documents', () => {
    document.body.innerHTML = '<section></section><iframe></iframe>'
    document.querySelector('section')!.attachShadow({ mode: 'open' }).innerHTML = '<p>private</p>'
    document.querySelector('iframe')!.contentDocument!.body.innerHTML = '<p>private</p>'
    expect(window.eval(reproCheckpointScript({ ...request, selector: 'p' })).observedMatch).toBe(true)
  })
  it('rejects excess matches and traversal instead of returning a partial assertion', () => {
    document.body.innerHTML = '<ul>' + '<li></li>'.repeat(500) + '</ul>'
    expect(window.eval(reproCheckpointScript({ ...request, count: 500 })).observedMatch).toBe(true)
    document.querySelector('ul')!.append(document.createElement('li'))
    expect(window.eval(reproCheckpointScript(request))).toEqual({ error: 'count-match-limit' })
    document.body.innerHTML = '<div></div>'.repeat(2001)
    const before = document.body.innerHTML
    expect(window.eval(reproCheckpointScript(request))).toEqual({ error: 'count-node-limit' })
    expect(document.body.innerHTML).toBe(before)
  })
  it('exports a final valid count but retains the TODO after a subsequent action', () => {
    const code = formatReproAsPlaywright(recording)
    expect(code).toContain(`page.locator(${javascriptLiteral('css:light=ul > li')})).toHaveCount(0)`)
    expect(code).not.toContain('TODO:')
    expect(formatReproAsPlaywright({ ...recording, steps: [...recording.steps, { ...recording.steps[0]!, kind: 'navigate', expectation: undefined }] })).toContain('TODO: replace this line')
  })
  it.each([undefined, '', '0', null, -1, 0.5, 501, Infinity])('independently rejects imported count %j', count => {
    const changed = structuredClone(recording)
    Object.assign(changed.steps[0]!.expectation!, { count })
    const code = formatReproAsPlaywright(changed)
    expect(code).toContain('TODO: Recreate unsupported expectation')
    expect(code).not.toContain('.toHaveCount(')
    expect(code).toContain('TODO: replace this line')
  })
  it('rejects unsupported versions, selectors and extra text in imported count', () => {
    for (const mutate of [
      (value: BrowserReproRecording) => { value.formatVersion = 2 },
      (value: BrowserReproRecording) => { value.formatVersion = undefined },
      (value: BrowserReproRecording) => { value.steps[0]!.target!.selector = '[value="private"]' },
      (value: BrowserReproRecording) => { value.steps[0]!.expectation!.text = 'private' },
      (value: BrowserReproRecording) => { Object.assign(value.steps[0]!.expectation!, { observedMatch: undefined }) },
      (value: BrowserReproRecording) => { Object.assign(value.steps[0]!.expectation!, { condition: 'unknown' }) }
    ]) {
      const changed = structuredClone(recording)
      mutate(changed)
      expect(formatReproAsPlaywright(changed)).toContain('TODO: Recreate unsupported expectation')
      expect(formatReproAsPlaywright(changed)).not.toContain('.toHaveCount(')
    }
  })
})
