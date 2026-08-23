import { describe, expect, it } from 'vitest'
import {
  browserEnvironmentFromEmulation,
  browserEnvironmentOverrideCount,
  DEFAULT_BROWSER_ENVIRONMENT,
  isBrowserEnvironmentSettings
} from '../src/shared/browser-environment.js'

describe('browser environment settings', () => {
  it('extracts only human-managed environment fields from full emulation state', () => {
    const environment = browserEnvironmentFromEmulation({
      network: 'slow-4g',
      cacheDisabled: true,
      bypassServiceWorker: true,
      dataSaver: 'enabled',
      cpuThrottlingRate: 4,
      animationPlaybackRate: 0.25,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      mediaType: 'print',
      forcedColors: 'active',
      contrast: 'more',
      reducedTransparency: 'reduce',
      visionDeficiency: 'deuteranopia',
      userAgent: 'Test Browser',
      locale: 'fr-CA',
      timezoneId: 'America/Toronto',
      javaScriptDisabled: true,
      renderingDebug: {
        paintFlashing: true,
        layoutShiftRegions: true,
        layerBorders: true,
        fpsCounter: true,
        scrollBottlenecks: true
      },
      viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true, orientation: 'portrait' },
      geolocation: { latitude: 50.45, longitude: 30.52, accuracy: 25 },
      extraHttpHeaderNames: ['X-Test']
    })
    expect(environment).toEqual({
      network: 'slow-4g',
      cacheDisabled: true,
      bypassServiceWorker: true,
      dataSaver: 'enabled',
      cpuThrottlingRate: 4,
      animationPlaybackRate: 0.25,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      mediaType: 'print',
      forcedColors: 'active',
      contrast: 'more',
      reducedTransparency: 'reduce',
      visionDeficiency: 'deuteranopia',
      userAgent: 'Test Browser',
      locale: 'fr-CA',
      timezoneId: 'America/Toronto',
      javaScriptDisabled: true,
      geolocation: { latitude: 50.45, longitude: 30.52, accuracy: 25 },
      renderingDebug: {
        paintFlashing: true,
        layoutShiftRegions: true,
        layerBorders: true,
        fpsCounter: true,
        scrollBottlenecks: true
      }
    })
    expect(browserEnvironmentOverrideCount(environment)).toBe(23)
  })

  it('returns independent defaults and counts no overrides', () => {
    const environment = browserEnvironmentFromEmulation()
    expect(environment).toEqual(DEFAULT_BROWSER_ENVIRONMENT)
    expect(environment).not.toBe(DEFAULT_BROWSER_ENVIRONMENT)
    expect(browserEnvironmentOverrideCount(environment)).toBe(0)
  })

  it('validates bounded trusted-shell input', () => {
    expect(isBrowserEnvironmentSettings({ ...DEFAULT_BROWSER_ENVIRONMENT, network: 'offline' })).toBe(true)
    expect(isBrowserEnvironmentSettings({ ...DEFAULT_BROWSER_ENVIRONMENT, cacheDisabled: 'yes' })).toBe(false)
    expect(isBrowserEnvironmentSettings({ ...DEFAULT_BROWSER_ENVIRONMENT, bypassServiceWorker: 1 })).toBe(false)
    expect(isBrowserEnvironmentSettings({ ...DEFAULT_BROWSER_ENVIRONMENT, dataSaver: 'sometimes' })).toBe(false)
    expect(isBrowserEnvironmentSettings({ ...DEFAULT_BROWSER_ENVIRONMENT, cpuThrottlingRate: 21 })).toBe(false)
    expect(isBrowserEnvironmentSettings({ ...DEFAULT_BROWSER_ENVIRONMENT, animationPlaybackRate: 0.5 })).toBe(false)
    expect(isBrowserEnvironmentSettings({ ...DEFAULT_BROWSER_ENVIRONMENT, userAgent: 'bad\nagent' })).toBe(false)
    expect(isBrowserEnvironmentSettings({ ...DEFAULT_BROWSER_ENVIRONMENT, mediaType: 'speech' })).toBe(false)
    expect(isBrowserEnvironmentSettings({ ...DEFAULT_BROWSER_ENVIRONMENT, visionDeficiency: 'unknown' })).toBe(false)
    expect(isBrowserEnvironmentSettings({ ...DEFAULT_BROWSER_ENVIRONMENT, locale: 'fr-CA', timezoneId: 'America/Toronto' })).toBe(true)
    expect(isBrowserEnvironmentSettings({ ...DEFAULT_BROWSER_ENVIRONMENT, locale: 'not_a_locale' })).toBe(false)
    expect(isBrowserEnvironmentSettings({ ...DEFAULT_BROWSER_ENVIRONMENT, timezoneId: 'Mars/Olympus' })).toBe(false)
    expect(isBrowserEnvironmentSettings({ ...DEFAULT_BROWSER_ENVIRONMENT, javaScriptDisabled: 'yes' })).toBe(false)
    expect(isBrowserEnvironmentSettings({ ...DEFAULT_BROWSER_ENVIRONMENT, renderingDebug: { paintFlashing: true } })).toBe(false)
    expect(isBrowserEnvironmentSettings({
      ...DEFAULT_BROWSER_ENVIRONMENT,
      geolocation: { latitude: 91, longitude: 30, accuracy: 10 }
    })).toBe(false)
  })
})
