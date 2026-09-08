import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { snapshotScript } from '../src/main/browser/page-scripts.js'

const capture = (body: string, limit = 1000) => runInNewContext(snapshotScript(limit, true), {
  URL,
  location: { href: 'https://example.test/?token=private-canary#private-fragment' },
  document: { title: 'Snapshot', body: { innerText: body }, querySelectorAll: () => [] }
})

it('reports an under-limit snapshot without exposing redacted URL values', () => {
  const result = capture('Small page')
  expect(result).toMatchObject({ truncated: false, maxChars: 1000, returnedChars: expect.any(Number) })
  expect(result.returnedChars).toBe(result.text.length)
  expect(result.text).toContain('Small page')
  expect(JSON.stringify(result)).not.toContain('private-canary')
  expect(JSON.stringify(result)).not.toContain('private-fragment')
})

it('reports omitted body text without returning it beyond the budget', () => {
  const result = capture('x'.repeat(1500) + 'omitted-tail-canary')
  expect(result).toMatchObject({ truncated: true, maxChars: 1000, returnedChars: 1000 })
  expect(result.text).toHaveLength(1000)
  expect(JSON.stringify(result)).not.toContain('omitted-tail-canary')
})

it('distinguishes exactly filling the budget from omitting one more character', () => {
  const remaining = 1000 - capture('').returnedChars - '\nTEXT: '.length
  expect(capture('x'.repeat(remaining))).toMatchObject({ truncated: false, returnedChars: 1000 })
  expect(capture('x'.repeat(remaining + 1))).toMatchObject({ truncated: true, returnedChars: 1000 })
})

it.each(['headings', 'controls'])('reports the %s cap even below the character limit', (kind) => {
  const elements = Array.from({ length: kind === 'headings' ? 81 : 501 }, () => ({
    tagName: kind === 'headings' ? 'H1' : 'BUTTON', innerText: 'x',
    getBoundingClientRect: () => ({ width: 1, height: 1 }),
    getAttribute: () => null, setAttribute: () => undefined
  }))
  const result = runInNewContext(snapshotScript(100000, true), {
    URL, location: { href: 'https://example.test/' }, HTMLAnchorElement: class {},
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    document: { title: 'Caps', body: { innerText: '' }, querySelectorAll: (selector: string) =>
      selector === '[data-hronaut-ref]' ? [] : (selector === 'h1,h2,h3') === (kind === 'headings') ? elements : [] }
  })
  expect(result.returnedChars).toBeLessThan(100000)
  expect(result).toMatchObject({ truncated: true, omitted: { [kind]: true, characters: false } })
})
