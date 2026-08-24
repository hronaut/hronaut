/// <reference lib="dom" />
// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { playwrightLocatorScript } from '../src/main/browser/page-scripts.js'
import { normalizeBrowserGeneratedLocator } from '../src/shared/playwright-locator.js'

describe('Playwright locator generation', () => {
  it('prefers a bounded unique semantic locator and safely quotes page-authored text', () => {
    const result = normalizeBrowserGeneratedLocator('tab-1', {
      selector: '#save',
      candidates: [
        { strategy: 'role', role: 'button', value: 'Save "profile"' },
        { strategy: 'test-id', value: 'save-profile' }
      ]
    })

    expect(result).toMatchObject({
      tabId: 'tab-1',
      strategy: 'role',
      locator: 'page.getByRole("button", { name: "Save \\"profile\\"", exact: true })',
      selector: '#save'
    })
  })

  it('falls back to the inspected unique CSS selector', () => {
    const result = normalizeBrowserGeneratedLocator('tab-1', {
      selector: 'main > button:nth-of-type(2)',
      candidates: [{ strategy: 'unknown', value: 'ignored' }]
    })

    expect(result).toMatchObject({
      strategy: 'css',
      locator: 'page.locator("main > button:nth-of-type(2)")'
    })
    expect(result.caveats[0]).toContain('DOM changes')
  })

  it('rejects locator output without a usable selector', () => {
    expect(() => normalizeBrowserGeneratedLocator('tab-1', {
      selector: '\u0000\u0001',
      candidates: []
    })).toThrow(/usable selector/)
  })

  it('generates a unique role locator in the page without reading form values', () => {
    document.body.innerHTML = `
      <button id="save-profile">Save profile</button>
      <label>Email <input id="email" value="form-value-secret"></label>
    `
    const originalCss = globalThis.CSS
    Object.defineProperty(globalThis, 'CSS', {
      configurable: true,
      value: { ...originalCss, escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&') }
    })
    try {
      const raw = globalThis.eval(playwrightLocatorScript({ selector: '#save-profile' }))
      const result = normalizeBrowserGeneratedLocator('tab-1', raw)

      expect(result).toMatchObject({
        strategy: 'role',
        locator: 'page.getByRole("button", { name: "Save profile", exact: true })'
      })
      expect(JSON.stringify(raw)).not.toContain('form-value-secret')
    } finally {
      Object.defineProperty(globalThis, 'CSS', { configurable: true, value: originalCss })
      document.body.innerHTML = ''
    }
  })

  it('uses a unique explicit test contract when a semantic name is duplicated', () => {
    document.body.innerHTML = `
      <button>Save</button>
      <button data-testid="save-secondary">Save</button>
    `
    const originalCss = globalThis.CSS
    Object.defineProperty(globalThis, 'CSS', {
      configurable: true,
      value: { ...originalCss, escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&') }
    })
    try {
      const raw = globalThis.eval(playwrightLocatorScript({ selector: '[data-testid="save-secondary"]' }))
      expect(normalizeBrowserGeneratedLocator('tab-1', raw)).toMatchObject({
        strategy: 'test-id',
        locator: 'page.getByTestId("save-secondary")'
      })
    } finally {
      Object.defineProperty(globalThis, 'CSS', { configurable: true, value: originalCss })
      document.body.innerHTML = ''
    }
  })

  it('does not emit a truncated test ID that can no longer match', () => {
    const longTestId = 't'.repeat(501)
    document.body.innerHTML = `<button data-testid="${longTestId}"></button>`
    const originalCss = globalThis.CSS
    Object.defineProperty(globalThis, 'CSS', {
      configurable: true,
      value: { ...originalCss, escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&') }
    })
    try {
      const raw = globalThis.eval(playwrightLocatorScript({ selector: 'button' }))
      const result = normalizeBrowserGeneratedLocator('tab-1', raw)

      expect(result.strategy).toBe('css')
      expect(result.locator).not.toContain('getByTestId')
    } finally {
      Object.defineProperty(globalThis, 'CSS', { configurable: true, value: originalCss })
      document.body.innerHTML = ''
    }
  })
})
