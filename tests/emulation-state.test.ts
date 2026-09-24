import { describe, expect, it } from 'vitest'
import { DEFAULT_EMULATION, cloneEmulationState, hasEmulationOverrides, prepareBrowserEmulation } from '../src/main/browser/emulation-state.js'
import { resolveViewportPreset } from '../src/shared/viewport-presets.js'
import type { BrowserEmulationOptions, BrowserEmulationState } from '../src/shared/types.js'

const prepare = (options: BrowserEmulationOptions) => prepareBrowserEmulation({ ...DEFAULT_EMULATION }, {}, options)

describe('emulation configuration', () => {
  it('distinguishes a read from explicit false and reset changes', () => {
    expect(prepare({})).toBeNull()
    expect(prepare({ cacheDisabled: false })).toEqual({ state: DEFAULT_EMULATION, headers: {} })
    expect(prepare({ reset: true })).toEqual({ state: DEFAULT_EMULATION, headers: {} })
    expect(() => prepare({ reset: true, cacheDisabled: false })).toThrow('reset cannot be combined')
  })

  it('resets every override and private header value', () => {
    const current = { ...DEFAULT_EMULATION, viewport: resolveViewportPreset('phone'), locale: 'en-US', extraHttpHeaderNames: ['X-Test'] }
    expect(prepareBrowserEmulation(current, { 'X-Test': 'private' }, { reset: true })).toEqual({ state: DEFAULT_EMULATION, headers: {} })
    expect(current.locale).toBe('en-US')
  })

  it('copies mutable state before exposing it to callers', () => {
    const state: BrowserEmulationState = {
      ...DEFAULT_EMULATION, viewport: resolveViewportPreset('phone'),
      geolocation: { latitude: 1, longitude: 2, accuracy: 3 },
      extraHttpHeaderNames: ['X-Test'], renderingDebug: { paintFlashing: true, layoutShiftRegions: false, layerBorders: false, fpsCounter: false, scrollBottlenecks: false }
    }
    const copy = cloneEmulationState(state)
    copy.viewport!.width = 900
    copy.geolocation!.latitude = 50
    copy.extraHttpHeaderNames!.push('Other')
    copy.renderingDebug!.paintFlashing = false
    expect(state.viewport!.width).toBe(390)
    expect(state.geolocation!.latitude).toBe(1)
    expect(state.extraHttpHeaderNames).toEqual(['X-Test'])
    expect(state.renderingDebug!.paintFlashing).toBe(true)
  })

  it('clears nullable overrides while retaining unrelated settings', () => {
    const current = { ...DEFAULT_EMULATION, network: 'offline' as const, viewport: resolveViewportPreset('phone'), locale: 'en-US', userAgent: 'test', timezoneId: 'UTC' }
    const result = prepareBrowserEmulation(current, {}, { viewport: null, locale: '', userAgent: '', timezoneId: '' })!
    expect(result.state).toMatchObject({ network: 'offline', viewport: undefined, locale: undefined, userAgent: undefined, timezoneId: undefined })
    expect(current.viewport.width).toBe(390)
  })

  it('resolves presets and rejects conflicting viewport options', () => {
    expect(prepare({ viewportPreset: 'phone', viewportOrientation: 'landscape' })!.state.viewport).toEqual(resolveViewportPreset('phone', 'landscape'))
    expect(() => prepare({ viewport: null, viewportPreset: 'phone' })).toThrow('cannot be combined')
    expect(() => prepare({ viewportOrientation: 'landscape' })).toThrow('requires viewportPreset')
  })

  it.each([NaN, Infinity, 199, 3841, 200.5])('rejects invalid viewport width %s', (width) => {
    expect(() => prepare({ viewport: { ...resolveViewportPreset('phone'), width } })).toThrow('viewport width')
  })

  it('accepts viewport and geographic boundary values', () => {
    expect(prepare({ viewport: { ...resolveViewportPreset('phone'), width: 200, height: 3840, deviceScaleFactor: 0.5 }, geolocation: { latitude: -90, longitude: 180, accuracy: 100_000 } })).not.toBeNull()
    expect(() => prepare({ geolocation: { latitude: NaN, longitude: 0, accuracy: 0 } })).toThrow('latitude')
    expect(() => prepare({ geolocation: { latitude: 0, longitude: Infinity, accuracy: 0 } })).toThrow('longitude')
    expect(() => prepare({ geolocation: { latitude: 0, longitude: 0, accuracy: -1 } })).toThrow('accuracy')
  })

  it('validates header bytes, count and line breaks while keeping values out of public state', () => {
    const headers = { 'X-Test': 'private value' }
    const result = prepare({ extraHttpHeaders: headers })!
    expect(result.state.extraHttpHeaderNames).toEqual(['X-Test'])
    expect(JSON.stringify(result.state)).not.toContain('private value')
    result.headers['X-Test'] = 'changed'
    expect(headers['X-Test']).toBe('private value')
    expect(() => prepare({ extraHttpHeaders: { 'X-Test': 'bad\r\nvalue' } })).toThrow('Invalid extra HTTP header')
    expect(() => prepare({ extraHttpHeaders: { 'X-Test': 'x'.repeat(65536) } })).toThrow('64 KB')
    expect(() => prepare({ extraHttpHeaders: Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`X-${index}`, 'v'])) })).toThrow('50 headers')
  })

  it('removes empty headers and disabled rendering overlays', () => {
    const result = prepare({ extraHttpHeaders: {}, renderingDebug: { paintFlashing: false } })!
    expect(result.state).not.toHaveProperty('extraHttpHeaderNames')
    expect(result.state).not.toHaveProperty('renderingDebug')
    expect(hasEmulationOverrides(result.state)).toBe(false)
    expect(hasEmulationOverrides(prepare({ renderingDebug: { paintFlashing: true } })!.state)).toBe(true)
  })

  it.each(['toString', 'constructor', '__proto__'])('rejects inherited rendering overlay name %s', (name) => {
    const renderingDebug = JSON.parse(`{"${name}":true}`) as NonNullable<BrowserEmulationOptions['renderingDebug']>
    expect(() => prepare({ renderingDebug })).toThrow(`Invalid rendering debug overlay: ${name}`)
  })
})
