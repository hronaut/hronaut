// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { snapshotScript } from '../src/main/browser/page-scripts.js'

function capture(selector?: string, maxChars = 1000) {
  return window.eval(snapshotScript(maxChars, true, selector))
}
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })
function fixture() {
  document.body.innerHTML = '<section><h1>Outside</h1><button>Unrelated</button></section><section id="target"><h2>Inside</h2><button>Save</button><div><button>Nested</button></div><input value="private-value"></section>'
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 10, height: 10 } as DOMRect)
  Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent } })
}
it('returns only root and descendant semantics with explicit outside-scope omission', () => {
  fixture()
  const result = capture('#target')
  expect(result.scope).toEqual({ kind: 'component', rootTag: 'section', outsideScopeOmitted: true })
  expect(result.text).toContain('Inside')
  expect(result.text).toContain('Nested')
  expect(result.text).not.toContain('Unrelated')
  expect(result.text).not.toContain('private-value')
  expect(capture('#target > button').text).toContain('Save')
  expect(capture().text).toContain('Unrelated')
})
it.each([['#missing', 'missing-root'], ['section', 'ambiguous-root'], ['[', 'invalid-selector']])('rejects %s without a document fallback', (selector, error) => {
  fixture()
  expect(capture(selector)).toEqual({ scopeError: error })
})
it('captures a replacement as a fresh root and rejects a removed root', () => {
  fixture()
  document.querySelector('#target')!.outerHTML = '<section id="target">Replacement</section>'
  expect(capture('#target').text).toContain('Replacement')
  document.querySelector('#target')!.remove()
  expect(capture('#target')).toEqual({ scopeError: 'missing-root' })
})
it('retains character completeness limits inside the component', () => {
  fixture()
  document.querySelector('#target')!.textContent = 'x'.repeat(2000)
  expect(capture('#target')).toMatchObject({ truncated: true, returnedChars: 1000, omitted: { bodyText: true } })
})

it('does not expose hidden root text or inspect frame contents', () => {
  fixture()
  const root = document.querySelector<HTMLElement>('#target')!
  root.style.visibility = 'hidden'
  root.textContent = 'hidden-private-canary'
  expect(capture('#target')).toEqual({ scopeError: 'hidden-root' })
  root.outerHTML = '<iframe id="target"></iframe>'
  expect(capture('#target')).toEqual({ scopeError: 'unsupported-root' })
})

it.each(['<textarea id="target">private-form-canary</textarea>', '<select id="target"><option>private-form-canary</option></select>', '<div id="target" contenteditable>private-form-canary</div>'])('rejects editable roots without returning their text', (html) => {
  fixture()
  document.querySelector('#target')!.outerHTML = html
  expect(capture('#target')).toEqual({ scopeError: 'unsupported-root' })
})


it.each([undefined, '#target'])('omits editable descendant values from snapshot %s without losing public neighbors', selector => {
  fixture()
  document.querySelector('#target')!.innerHTML = '<p>Public before</p><div contenteditable="true" aria-label="Message editor"><h2>private-rich-heading</h2><button>private-rich-control</button></div><p>Public after</p>'
  const original = document.querySelector('#target')!.textContent
  const result = capture(selector)
  expect(result.text).toContain('Public before')
  expect(result.text).toContain('Public after')
  expect(result.text).toContain('Message editor')
  expect(result.text).not.toContain('private-rich-heading')
  expect(result.text).not.toContain('private-rich-control')
  expect(document.querySelector('#target')!.textContent).toBe(original)
})


it.each(['', 'true', 'plaintext-only'])('omits %s editors while preserving inline words, block text and visible overrides', mode => {
  fixture()
  document.querySelector('#target')!.innerHTML = `<span>Hel</span><b>lo</b><div contenteditable="${mode}">private-editor-canary</div><p>Public after</p><div style="display:none">hidden-canary</div><div style="visibility:hidden">hidden-parent-canary<span style="visibility:visible">Visible override</span></div>`
  const result = capture('#target')
  expect(result.text).toContain('Hello')
  expect(result.text).toContain('Public after')
  expect(result.text).toContain('Visible override')
  expect(result.text).not.toContain('private-editor-canary')
  expect(result.text).not.toContain('hidden-canary')
  expect(result.text).not.toContain('hidden-parent-canary')
})

it('preserves non-editable false regions outside editors', () => {
  fixture()
  document.querySelector('#target')!.innerHTML = '<div contenteditable="false">Public readonly content</div><div contenteditable="true">private-editor-canary</div>'
  expect(capture('#target').text).toContain('Public readonly content')
  expect(capture('#target').text).not.toContain('private-editor-canary')
})

it('reports bounded traversal omission instead of overflowing on deeply nested editor containers', () => {
  fixture()
  document.querySelector('#target')!.innerHTML = '<div>'.repeat(150) + '<div contenteditable="true">private-editor-canary</div>' + '</div>'.repeat(150) + '<p>Public sibling</p>'
  const result = capture('#target')
  expect(result).toMatchObject({ truncated: true, omitted: { characters: true } })
  expect(result.text).toContain('Public sibling')
  expect(result.text).not.toContain('private-editor-canary')
})


it('bounds wide editor-containing traversal and reports the omitted tail', () => {
  fixture()
  document.querySelector('#target')!.innerHTML = '<span></span>'.repeat(12000) + '<div contenteditable="true">private-editor-canary</div><p>late-public-sibling</p>'
  const result = capture('#target')
  expect(result).toMatchObject({ truncated: true, omitted: { characters: true } })
  expect(result.text).not.toContain('private-editor-canary')
  expect(result.text).not.toContain('late-public-sibling')
})
