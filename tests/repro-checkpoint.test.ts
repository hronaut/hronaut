// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { reproCheckpointSchema } from '../src/shared/repro-checkpoint.js'
import { reproCheckpointScript } from '../src/main/browser/repro-checkpoint-script.js'
import { formatReproAsPlaywright } from '../src/shared/repro-export.js'
import type { BrowserReproRecording } from '../src/shared/types.js'

const input = { context: 'c9a69713-c421-4d51-913e-0f7e74248acd', selector: '#result', condition: 'text' as const, text: 'Saved successfully', reviewed: true as const }
const recording: BrowserReproRecording = { tabId: 'tab', title: 'Fixture', active: false, stepCount: 1, truncated: false, caveats: [], steps: [{ index: 1, kind: 'expect', occurredAt: '2026-10-01T00:00:00Z', elapsedMs: 1, url: 'https://example.test', description: 'Expected result', target: { selector: 'main > p', tag: 'p' }, expectation: { condition: 'text', text: 'Saved successfully', observedMatch: false } }] }

describe('explicit Repro checkpoints', () => {
  it.each([
    { actual: 'Saved\u200b successfully', expected: 'Saved successfully', observedMatch: true },
    { actual: 'Saved suc\u00adcessfully', expected: 'Saved successfully', observedMatch: true },
    { actual: 'Saved successfully', expected: ' Saved\u200b suc\u00adcessfully ', observedMatch: true },
    { actual: 'Saved\u200b incorrectly', expected: 'Saved successfully', observedMatch: false }
  ])('matches Playwright text normalization for %j', ({ actual, expected, observedMatch }) => {
    const result = document.createElement('p')
    result.id = 'result'
    result.textContent = actual
    document.body.append(result)
    try {
      expect(window.eval(reproCheckpointScript({ ...input, text: expected })))
        .toEqual({ selector: 'p', tag: 'p', observedMatch })
    } finally { result.remove() }
  })

  it.each(['script', 'style'])('excludes %s content without changing the result element', tag => {
    document.body.innerHTML = '<div id="result">Saved <span>successfully</span><' + tag + '>' + (tag === 'style' ? '/* private-source-canary */ #result { color: green }' : 'private-source-canary') + '</' + tag + '></div>'
    const before = document.body.innerHTML
    try {
      const result = window.eval(reproCheckpointScript(input))
      expect(result.observedMatch).toBe(true)
      expect(JSON.stringify(result)).not.toContain('private-source-canary')
      expect(document.body.innerHTML).toBe(before)
      document.querySelector('span')!.textContent = 'incorrectly'
      expect(window.eval(reproCheckpointScript(input)).observedMatch).toBe(false)
    } finally { document.body.replaceChildren() }
  })
  it.each(['target', 'descendant'])('rejects text targets with an open shadow root on the %s without reading its contents', location => {
    document.body.innerHTML = '<div id="result">Saved <span>successfully</span><div></div></div>'
    const target = document.querySelector('#result')!
    const host = location === 'target' ? target : target.querySelector('div')!
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<span>private-shadow-canary</span><input value="private-form-canary">'
    const before = target.outerHTML
    Object.defineProperty(shadow, 'childNodes', { get() { throw new Error('Shadow content must not be read') } })
    Object.defineProperty(shadow, 'textContent', { get() { throw new Error('Shadow text must not be read') } })
    try {
      expect(window.eval(reproCheckpointScript(input))).toEqual({ error: 'shadow-text-target' })
      expect(target.outerHTML).toBe(before)
      expect(window.eval(reproCheckpointScript({ ...input, selector: 'span', text: 'successfully' })))
        .toEqual({ selector: 'span', tag: 'span', observedMatch: true })
    } finally { document.body.replaceChildren() }
  })

  it.each(['nodes', 'characters', 'excluded nodes'])('rejects text observation beyond the %s limit', limit => {
    const element = document.createElement('div')
    element.id = 'result'
    if (limit !== 'characters') {
      for (let i = 0; i < 2001; i++) element.append(document.createElement(limit === 'nodes' ? 'span' : 'script'))
    } else element.textContent = 'x'.repeat(64001)
    document.body.append(element)
    try { expect(window.eval(reproCheckpointScript(input))).toEqual({ error: 'text-limit' }) }
    finally { element.remove() }
  })

  it('requires review, bounded expected text and an exact recording context', () => {
    expect(reproCheckpointSchema.safeParse(input).success).toBe(true)
    for (const changed of [{ reviewed: false }, { text: 'x'.repeat(241) }, { context: '' }, { condition: 'visible' }, { unexpected: true }]) {
      expect(reproCheckpointSchema.safeParse({ ...input, ...changed }).success).toBe(false)
    }
  })
  it('returns only a structural target and match flag, never observed private text', () => {
    document.body.innerHTML = '<main><p id="result">private unrelated result</p></main>'
    try {
      const result = window.eval(reproCheckpointScript(input))
      expect(result).toEqual({ selector: 'p', tag: 'p', observedMatch: false })
      expect(JSON.stringify(result)).not.toContain('private')
      window.document.querySelector('p')!.textContent = 'Saved  successfully'
      expect(window.eval(reproCheckpointScript(input)).observedMatch).toBe(true)
    } finally { document.body.replaceChildren() }
  })
  it('rejects missing, ambiguous and editable targets', () => {
    document.body.innerHTML = '<main><p></p><p></p><input value="private"><div contenteditable="true">private</div></main>'
    try {
      for (const [selector, error] of [['#missing', 'ambiguous-target'], ['p', 'ambiguous-target'], ['input', 'excluded-target'], ['main', 'excluded-target'], ['[contenteditable]', 'excluded-target'], ['[', 'invalid-selector']]) {
        expect(window.eval(reproCheckpointScript({ ...input, selector: selector! }))).toEqual({ error })
      }
    } finally { document.body.replaceChildren() }
  })
  it('exports the intended assertion even when the observed result failed', () => {
    const code = formatReproAsPlaywright(recording)
    expect(code).toContain('await expect(page.locator("css:light=main \\u003e p")).toHaveText("Saved successfully")')
    expect(code).not.toContain('throw new Error')
    expect(code).not.toContain('observedMatch')
  })
  it('retains the failing assertion TODO for unsupported or unmarked expectations', () => {
    expect(formatReproAsPlaywright({ ...recording, steps: [] })).toContain('TODO: replace this line')
    expect(formatReproAsPlaywright({ ...recording, steps: [{ ...recording.steps[0]!, target: { selector: '', tag: 'p' } }] })).toContain('TODO: replace this line')
  })
})


it.each(['checkbox', 'radio'])('records only the explicit %s checked state, not its value', type => {
  document.body.innerHTML = `<input type="${type}" value="private-value-canary" checked>`
  try {
    Object.defineProperty(document.querySelector('input')!, 'value', { get() { throw new Error('Form value must not be read') } })
    const request = { ...input, selector: 'input', condition: 'checked' as const, text: undefined }
    expect(reproCheckpointSchema.safeParse(request).success).toBe(true)
    expect(window.eval(reproCheckpointScript(request))).toEqual({ selector: 'input', tag: 'input', observedMatch: true })
    expect(window.eval(reproCheckpointScript({ ...request, condition: 'unchecked' }))).toEqual({ selector: 'input', tag: 'input', observedMatch: false })
    document.querySelector('input')!.checked = false
    expect(window.eval(reproCheckpointScript({ ...request, condition: 'unchecked' })).observedMatch).toBe(true)
    expect(window.eval(reproCheckpointScript({ ...input, selector: 'input' }))).toEqual({ error: 'excluded-target' })
    expect(reproCheckpointSchema.safeParse({ ...request, text: 'private-value-canary' }).success).toBe(false)
  } finally { document.body.replaceChildren() }
})

it.each(['<input>', '<textarea></textarea>', '<div role="checkbox" aria-checked="true"></div>', '<div contenteditable><input type="checkbox"></div>'])('rejects unsupported checked-state targets: %s', html => {
  document.body.innerHTML = html
  try {
    expect(window.eval(reproCheckpointScript({ ...input, selector: html.includes('input') ? 'input' : html.includes('textarea') ? 'textarea' : 'div', condition: 'checked', text: undefined }))).toEqual({ error: 'unsupported-checked-target' })
  } finally { document.body.replaceChildren() }
})

it('exports checked and unchecked assertions without form values', () => {
  const steps = (['checked', 'unchecked'] as const).map((condition, index) => ({ ...recording.steps[0]!, index: index + 1, target: { selector: 'input', tag: 'input' }, expectation: { condition, observedMatch: false } }))
  const code = formatReproAsPlaywright({ ...recording, steps })
  expect(code).toContain('.toBeChecked()')
  expect(code).toContain('.not.toBeChecked()')
  expect(code.match(/toHaveJSProperty\('indeterminate', false\)/g)).toHaveLength(2)
  expect(code).not.toContain('TODO: replace this line')
})


it('rejects mixed checkbox state instead of presenting it as binary', () => {
  document.body.innerHTML = '<input type="checkbox">'
  try {
    document.querySelector('input')!.indeterminate = true
    expect(window.eval(reproCheckpointScript({ ...input, selector: 'input', condition: 'checked', text: undefined }))).toEqual({ error: 'unsupported-checked-target' })
  } finally { document.body.replaceChildren() }
})

it('honors native rendering suppression even when an element has a layout box', () => {
  document.body.innerHTML = '<p id="result">Public text</p>'
  const element = document.querySelector('p')!
  Object.defineProperty(element, 'getBoundingClientRect', { value: () => ({ width: 100, height: 30 }) })
  Object.defineProperty(element, 'checkVisibility', { value: () => false })
  try {
    expect(window.eval(reproCheckpointScript({ ...input, condition: 'visible', text: undefined })).observedMatch).toBe(false)
    expect(window.eval(reproCheckpointScript({ ...input, condition: 'hidden', text: undefined })).observedMatch).toBe(true)
  } finally { document.body.replaceChildren() }
})

it('observes visible descendants of a display-contents target without returning their text', () => {
  document.body.innerHTML = '<div id="result" style="display:contents"><p>Public child</p></div>'
  Object.defineProperty(document.querySelector('p')!, 'getBoundingClientRect', { value: () => ({ width: 100, height: 30 }) })
  try {
    expect(window.eval(reproCheckpointScript({ ...input, condition: 'visible', text: undefined }))).toEqual({ selector: 'div', tag: 'div', observedMatch: true })
    document.querySelector('p')!.style.visibility = 'hidden'
    expect(window.eval(reproCheckpointScript({ ...input, condition: 'visible', text: undefined })).observedMatch).toBe(false)
  } finally { document.body.replaceChildren() }
})

it('rejects an incomplete display-contents walk instead of asserting hidden', () => {
  document.body.innerHTML = '<div id="result" style="display:contents"></div>'
  const target = document.querySelector('div')!
  for (let index = 0; index < 1001; index++) target.append(document.createComment(''))
  try {
    expect(window.eval(reproCheckpointScript({ ...input, condition: 'hidden', text: undefined }))).toEqual({ error: 'visibility-limit' })
    // Text expectations do not need a visibility traversal.
    expect(window.eval(reproCheckpointScript({ ...input, text: '' })).observedMatch).toBe(true)
  } finally { document.body.replaceChildren() }
})

it('bounds display-contents nesting before observing a deep descendant', () => {
  document.body.innerHTML = '<div id="result" style="display:contents"></div>'
  let parent = document.querySelector('div')!
  for (let depth = 0; depth < 102; depth++) {
    const child = document.createElement('div'); child.style.display = 'contents'
    parent.append(child); parent = child
  }
  try {
    expect(window.eval(reproCheckpointScript({ ...input, condition: 'hidden', text: undefined }))).toEqual({ error: 'visibility-limit' })
  } finally { document.body.replaceChildren() }
})
