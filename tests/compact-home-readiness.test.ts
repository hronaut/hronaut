// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { compactHomeControlPositions } from './integration/compact-home-readiness.js'

const expected = { width: 760, leftInset: 0, rightInset: 113 }

function geometry(areaWidth: number, rightInset: number, shift = 0): void {
  vi.stubGlobal('innerWidth', 760)
  document.documentElement.style.setProperty('--titlebar-area-width-runtime', `${areaWidth}px`)
  document.documentElement.style.setProperty('--titlebar-controls-left-runtime', '0px')
  document.documentElement.style.setProperty('--titlebar-controls-right-runtime', `${rightInset}px`)
  document.body.innerHTML = '<div class="topbar-actions"></div>'
  for (const [index, label] of ['Search tabs', 'Downloads', 'Browsing history', 'Settings'].entries()) {
    const button = document.createElement('button')
    button.setAttribute('aria-label', label)
    button.getBoundingClientRect = () => ({ x: [283, 315, 347, 607][index]! + shift, y: 47 }) as DOMRect
    document.querySelector('.topbar-actions')!.append(button)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('style')
  document.body.innerHTML = ''
})

test('does not capture the compact Home baseline while resized title-bar padding is transient', () => {
  // Both states occurred in the original trace after innerWidth became 760.
  geometry(760, 560, -241)
  expect(compactHomeControlPositions(expected)).toBeUndefined()
  geometry(200, 560, -241)
  expect(compactHomeControlPositions(expected)).toBeUndefined()
  geometry(647, 113)
  expect(compactHomeControlPositions(expected)?.['Search tabs']).toEqual({ x: 283, y: 47 })
})

test('does not hide a persistent controls shift after capturing a ready Home baseline', () => {
  geometry(647, 113)
  const baseline = compactHomeControlPositions(expected)
  expect(baseline).toBeDefined()
  geometry(647, 113, 241)
  const website = compactHomeControlPositions(expected)
  expect(website).toBeDefined()
  // The integration test retains this strict assertion after opening the tab.
  expect(() => expect(website).toEqual(baseline)).toThrow()
})
