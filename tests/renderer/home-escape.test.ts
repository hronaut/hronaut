import { expect, it } from 'vitest'
import { escapeText, renderStatus } from '../../src/renderer/src/home/dom.js'

it('keeps Home text inert in markup and quoted attributes', () => {
  const source = `<img src=x onerror=alert(1)>&' onmouseover='alert(1)`
  const escaped = escapeText(source)
  expect(escaped).toBe('&lt;img src=x onerror=alert(1)&gt;&amp;&#39; onmouseover=&#39;alert(1)')

  const host = document.createElement('div')
  host.innerHTML = `<span data-label='${escaped}'>${escaped}</span>`
  const label = host.querySelector('span')
  expect(label?.textContent).toBe(source)
  expect(label?.getAttribute('data-label')).toBe(source)
  expect(label?.hasAttribute('onmouseover')).toBe(false)
  expect(host.querySelector('img')).toBeNull()
})

it('renders Home status labels as text', () => {
  const host = document.createElement('div')
  const label = '<img src=x onerror=alert(1)>'
  renderStatus(host, 'ready', label)
  expect(host.querySelector('.dot.ready')).not.toBeNull()
  expect(host.textContent).toBe(` ${label}`)
  expect(host.querySelector('img')).toBeNull()
})
