import { describe, expect, it } from 'vitest'
import { DEFAULT_EMULATION, EmulationInputError, cloneEmulationState, hasEmulationOverrides, prepareBrowserEmulation } from '../src/main/browser/emulation-state.js'
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

  it('recovery preserves every committed setting and private header without sharing mutable values', () => {
    const current = { ...DEFAULT_EMULATION, viewport: resolveViewportPreset('phone'), locale: 'en-US', extraHttpHeaderNames: ['X-Test'] }
    const headers = { 'X-Test': 'private' }
    const recovered = prepareBrowserEmulation(current, headers, { recover: true })!
    expect(recovered).toEqual({ state: current, headers })
    recovered.state.viewport!.width = 777
    recovered.headers['X-Test'] = 'changed'
    expect(current.viewport.width).not.toBe(777)
    expect(headers['X-Test']).toBe('private')
    for (const overrides of [{ reset: true }, { reset: false }, { colorScheme: 'auto' as const }, { viewport: null }, { extraHttpHeaders: {} }, { network: 'none' as const }]) {
      expect(() => prepare({ recover: true, ...overrides })).toThrow('recover cannot be combined')
    }
    expect(prepare({ recover: false })).toBeNull()
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

  it.each([
    [{ viewport: null, viewportPreset: 'phone' }, 'VIEWPORT_CONFLICT'],
    [{ viewportOrientation: 'landscape' }, 'ORIENTATION_REQUIRES_PRESET'],
    [{ recover: true, extraHttpHeaders: { 'X-Private': 'never-public' } }, 'RECOVERY_CONFLICT'],
    [{ reset: true, userAgent: 'never-public' }, 'RESET_CONFLICT']
  ] as const)('provides bounded combination-error provenance for %j', (options, reason) => {
    let caught: unknown
    try { prepare(options) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(EmulationInputError)
    expect(caught).toMatchObject({ reason })
    expect(String(caught)).not.toContain('never-public')
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

  it.each([NaN, Infinity, -Infinity, 0.99, 20.01])('rejects CPU throttle rate %s', (cpuThrottlingRate) => {
    expect(() => prepare({ cpuThrottlingRate })).toThrow('cpuThrottlingRate')
  })

  it('accepts the CPU throttle bounds and supported animation rates', () => {
    expect(prepare({ cpuThrottlingRate: 1 })!.state.cpuThrottlingRate).toBe(1)
    expect(prepare({ cpuThrottlingRate: 20 })!.state.cpuThrottlingRate).toBe(20)
    for (const animationPlaybackRate of [0, 0.1, 0.25, 1] as const) {
      expect(prepare({ animationPlaybackRate })!.state.animationPlaybackRate).toBe(animationPlaybackRate)
    }
    expect(() => prepare({ animationPlaybackRate: 0.5 as BrowserEmulationOptions['animationPlaybackRate'] })).toThrow('animationPlaybackRate')
  })

  it.each(['agent\0suffix', 'agent\nsuffix', 'agent\x7fsuffix'])('rejects control characters in user agent %j', (userAgent) => {
    expect(() => prepare({ userAgent })).toThrow('control characters')
  })

  it('normalizes valid locale and timezone identifiers and rejects invalid ones', () => {
    const result = prepare({ locale: 'EN-us', timezoneId: 'utc' })!
    expect(result.state.locale).toBe('en-US')
    expect(result.state.timezoneId).toBe('UTC')
    expect(() => prepare({ locale: 'en_US' })).toThrow('BCP 47')
    expect(() => prepare({ timezoneId: 'Not/A-Timezone' })).toThrow('IANA time zone')
  })

  it.each([
    [{ height: NaN }, 'viewport height'],
    [{ height: 199 }, 'viewport height'],
    [{ height: 3841 }, 'viewport height'],
    [{ deviceScaleFactor: Infinity }, 'deviceScaleFactor'],
    [{ deviceScaleFactor: 0.49 }, 'deviceScaleFactor'],
    [{ deviceScaleFactor: 5.01 }, 'deviceScaleFactor'],
    [{ mobile: 1 }, 'mobile and touch'],
    [{ touch: 'true' }, 'mobile and touch'],
    [{ orientation: 'diagonal' }, 'orientation']
  ] as const)('rejects malformed viewport fields %j', (override, message) => {
    const viewport = { ...resolveViewportPreset('phone'), ...override } as ReturnType<typeof resolveViewportPreset>
    expect(() => prepare({ viewport })).toThrow(message)
  })

  it('merges overlay changes, then clears them and geolocation explicitly', () => {
    const current = prepare({ renderingDebug: { paintFlashing: true, fpsCounter: true }, geolocation: { latitude: 1, longitude: 2, accuracy: 3 } })!.state
    const merged = prepareBrowserEmulation(current, {}, { renderingDebug: { paintFlashing: false } })!.state
    expect(merged.renderingDebug).toMatchObject({ paintFlashing: false, fpsCounter: true })
    expect(current.renderingDebug!.paintFlashing).toBe(true)
    const cleared = prepareBrowserEmulation(merged, {}, { renderingDebug: null, geolocation: null })!.state
    expect(cleared.renderingDebug).toBeUndefined()
    expect(cleared.geolocation).toBeUndefined()
    expect(hasEmulationOverrides(cleared)).toBe(false)
  })

  it('replaces safe-area insets as a whole, clears them with null, and copies them', () => {
    const current = prepare({ safeAreaInsets: { top: 47, bottom: 34, bottomMax: 40 } })!.state
    expect(current.safeAreaInsets).toEqual({ top: 47, bottom: 34, bottomMax: 40 })
    expect(hasEmulationOverrides(current)).toBe(true)
    const copy = cloneEmulationState(current)
    copy.safeAreaInsets!.top = 1
    expect(current.safeAreaInsets!.top).toBe(47)
    const replaced = prepareBrowserEmulation(current, {}, { safeAreaInsets: { left: 12 } })!.state
    expect(replaced.safeAreaInsets).toEqual({ left: 12 })
    const cleared = prepareBrowserEmulation(replaced, {}, { safeAreaInsets: null })!.state
    expect(cleared.safeAreaInsets).toBeUndefined()
    expect(hasEmulationOverrides(cleared)).toBe(false)
    expect(prepareBrowserEmulation(current, {}, { reset: true })!.state.safeAreaInsets).toBeUndefined()
  })

  it.each([
    [{ top: -1 }, 'safeAreaInsets.top'],
    [{ rightMax: 1001 }, 'safeAreaInsets.rightMax'],
    [{ bottom: 1.5 }, 'safeAreaInsets.bottom'],
    [{ left: Number.NaN }, 'safeAreaInsets.left'],
    [{ notch: 10 }, 'Invalid safe-area inset: notch']
  ])('rejects malformed safe-area insets %j', (insets, message) => {
    expect(() => prepare({ safeAreaInsets: insets as BrowserEmulationOptions['safeAreaInsets'] })).toThrow(message)
  })

  it('sets, replaces and clears the OS text scale within 0.85 to 2', () => {
    const current = prepare({ osTextScale: 2 })!.state
    expect(current.osTextScale).toBe(2)
    expect(hasEmulationOverrides(current)).toBe(true)
    expect(prepareBrowserEmulation(current, {}, { colorScheme: 'dark' })!.state.osTextScale).toBe(2)
    expect(prepareBrowserEmulation(current, {}, { osTextScale: 0.85 })!.state.osTextScale).toBe(0.85)
    const cleared = prepareBrowserEmulation(current, {}, { osTextScale: null })!.state
    expect(cleared.osTextScale).toBeUndefined()
    expect(hasEmulationOverrides(cleared)).toBe(false)
    expect(prepareBrowserEmulation(current, {}, { reset: true })!.state.osTextScale).toBeUndefined()
    for (const osTextScale of [0.84, 2.01, Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      expect(() => prepare({ osTextScale })).toThrow('osTextScale must be between 0.85 and 2')
    }
  })

  it('enforces the header limit in bytes including names', () => {
    const exact = 'x'.repeat(65536 - 'X-Test'.length)
    expect(prepare({ extraHttpHeaders: { 'X-Test': exact } })!.headers['X-Test']).toBe(exact)
    expect(() => prepare({ extraHttpHeaders: { 'X-Test': exact + 'x' } })).toThrow('64 KB')
    expect(() => prepare({ extraHttpHeaders: { 'X-Test': 'é'.repeat(32768) } })).toThrow('64 KB')
  })

  it('preserves a prototype-named HTTP header as ordinary data', () => {
    const headers = JSON.parse('{"__proto__":"header value"}') as Record<string, string>
    const result = prepare({ extraHttpHeaders: headers })!
    expect(Object.hasOwn(result.headers, '__proto__')).toBe(true)
    expect(result.headers['__proto__']).toBe('header value')
    expect(result.state.extraHttpHeaderNames).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(result.headers)).toBe(Object.prototype)
  })
})
