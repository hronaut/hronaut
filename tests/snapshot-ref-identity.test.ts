// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { snapshotScript } from '../src/main/browser/page-scripts.js'
import { snapshotDeltaChanges } from '../src/shared/snapshot-delta.js'

const capture = (selector?: string): string => window.eval(snapshotScript(100_000, true, selector)).text
const controls = (text: string): string[] => text.split('\n').filter(line => line.startsWith('['))

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 10, height: 10 } as DOMRect)
  Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent } })
})
afterEach(() => {
  document.body.innerHTML = ''
  delete (globalThis as { __hronautSnapshotIdentity?: unknown }).__hronautSnapshotIdentity
  vi.restoreAllMocks()
})

it('keeps surviving control refs when an earlier control is inserted', () => {
  document.body.innerHTML = `<main>${Array.from({ length: 100 }, (_, index) => `<button>Action ${index}</button>`).join('')}</main>`
  const before = capture()
  document.querySelector('main')!.prepend(Object.assign(document.createElement('button'), { textContent: 'Help' }))
  const after = capture()
  const changes = snapshotDeltaChanges(before, after).filter(change => change.key.startsWith('control:'))
  // Positional numbering previously reported 100 updates plus one addition.
  expect(changes).toEqual([{ kind: 'added', key: 'control:e101', after: '[e101] button "Help"' }])
  expect(controls(after)[0]).toBe('[e101] button "Help"')
})

it('does not relabel later controls when an earlier control is removed', () => {
  document.body.innerHTML = '<button>First</button><button>Save</button><button>Cancel</button>'
  const before = capture()
  document.querySelector('button')!.remove()
  expect(snapshotDeltaChanges(before, capture()).filter(change => change.key.startsWith('control:')))
    .toEqual([{ kind: 'removed', key: 'control:e1', before: '[e1] button "First"' }])
})

it('still reports surviving control label and state updates', () => {
  document.body.innerHTML = '<button>Save</button><input type="checkbox" aria-label="Remember">'
  const before = capture()
  document.querySelector('button')!.textContent = 'Saved'
  ;(document.querySelector('input') as HTMLInputElement).checked = true
  expect(snapshotDeltaChanges(before, capture()).filter(change => change.key.startsWith('control:'))).toEqual([
    { kind: 'updated', key: 'control:e1', before: '[e1] button "Save"', after: '[e1] button "Saved"' },
    { kind: 'updated', key: 'control:e2', before: '[e2] input "Remember"', after: '[e2] input "Remember" checked' }
  ])
})

it('does not carry identity to replacement or cloned nodes with identical text', () => {
  document.body.innerHTML = '<div id="list"><button>Same</button><button>Same</button></div>'
  const before = capture()
  const [first, second] = document.querySelectorAll('button')
  first!.replaceWith(first!.cloneNode(true))
  second!.after(second!.cloneNode(true))
  const after = capture()
  expect(controls(after)).toEqual(['[e3] button "Same"', '[e2] button "Same"', '[e4] button "Same"'])
  expect(snapshotDeltaChanges(before, after).filter(change => change.key.startsWith('control:')).map(({ kind, key }) => [kind, key]))
    .toEqual([['added', 'control:e3'], ['added', 'control:e4'], ['removed', 'control:e1']])
  // Published handles are reassigned, never read back as identity.
  expect([...document.querySelectorAll('[data-hronaut-ref]')].map(element => element.getAttribute('data-hronaut-ref')))
    .toEqual(['e3', 'e2', 'e4'])
})

it('keeps whole-page identities stable across interleaved component captures', () => {
  document.body.innerHTML = '<section><button>Outside</button></section><form id="scope"><button type="button">Inside</button></form>'
  const whole = capture()
  expect(controls(capture('#scope'))).toEqual(['[e2] button "Inside"'])
  expect(document.querySelector('section button')!.hasAttribute('data-hronaut-ref')).toBe(false)
  expect(capture()).toBe(whole)
})

it('restarts numbering explicitly when the per-document identity limit is reached', () => {
  document.body.innerHTML = '<button>Save</button>'
  capture()
  ;(globalThis as unknown as { __hronautSnapshotIdentity: { next: number } }).__hronautSnapshotIdentity.next = 999_999
  expect(controls(capture())).toEqual(['[e1] button "Save"'])
})
