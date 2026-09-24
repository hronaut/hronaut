import { describe, expect, it } from 'vitest'
import { DEFAULT_EMULATION, prepareBrowserEmulation } from '../src/main/browser/emulation-state.js'
import { performanceEnvironmentFingerprint } from '../src/main/browser/performance-environment.js'
import { resolveViewportPreset } from '../src/shared/viewport-presets.js'
import type { BrowserEmulationState } from '../src/shared/types.js'

const fingerprint = (state: BrowserEmulationState, headers: Record<string, string> = {}) =>
  performanceEnvironmentFingerprint(state, headers, { width: 800, height: 600 }, 100)

describe('performance environment fingerprint', () => {
  it('ignores the order settings were applied', () => {
    const viewport = prepareBrowserEmulation(DEFAULT_EMULATION, {}, { viewportPreset: 'phone' })!.state
    const sequential = prepareBrowserEmulation(viewport, {}, { locale: 'en-US' })!.state
    const together = prepareBrowserEmulation(DEFAULT_EMULATION, {}, { viewportPreset: 'phone', locale: 'en-US' })!.state
    expect(fingerprint(sequential)).toBe(fingerprint(together))
  })

  it('ignores nested object property ordering', () => {
    const viewport = resolveViewportPreset('phone')
    const reversed = Object.fromEntries(Object.entries(viewport).reverse()) as typeof viewport
    expect(fingerprint({ ...DEFAULT_EMULATION, viewport })).toBe(fingerprint({ ...DEFAULT_EMULATION, viewport: reversed }))
  })

  it('ignores header ordering without mutating state or exposing values', () => {
    const state = { ...DEFAULT_EMULATION, extraHttpHeaderNames: ['X-Z', 'X-A'] }
    const value = fingerprint(state, { 'X-Z': 'secret-z', 'X-A': 'secret-a' })
    expect(value).toBe(fingerprint({ ...state, extraHttpHeaderNames: ['X-A', 'X-Z'] }, { 'X-A': 'secret-a', 'X-Z': 'secret-z' }))
    expect(state.extraHttpHeaderNames).toEqual(['X-Z', 'X-A'])
    expect(value).toMatch(/^[a-f0-9]{64}$/)
  })

  it('detects actual state, private header, viewport and zoom changes', () => {
    const baseline = fingerprint(DEFAULT_EMULATION)
    expect(fingerprint({ ...DEFAULT_EMULATION, locale: 'fr-CA' })).not.toBe(baseline)
    expect(fingerprint(DEFAULT_EMULATION, { 'X-Test': 'a' })).not.toBe(fingerprint(DEFAULT_EMULATION, { 'X-Test': 'b' }))
    expect(performanceEnvironmentFingerprint(DEFAULT_EMULATION, {}, { width: 801, height: 600 }, 100)).not.toBe(baseline)
    expect(performanceEnvironmentFingerprint(DEFAULT_EMULATION, {}, { width: 800, height: 600 }, 110)).not.toBe(baseline)
  })
})
