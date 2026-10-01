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
