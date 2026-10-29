import type { BrowserPerformanceEnvironment } from '../../../shared/types.js'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'
import { performanceEnvironmentFingerprint } from '../performance-environment.js'

/**
 * The tab's performance environment as a report shows it: its network and
 * CPU emulation, viewport, zoom, font size and which overrides are set. The
 * tab's emulation must be confirmed.
 */
export function performanceEnvironment(browser: Browser, tab: BrowserTab): BrowserPerformanceEnvironment {
  browser.requireEmulationConfirmed(tab)
  const bounds = tab.view.getBounds()
  const viewport = tab.emulation.viewport
  return {
    network: tab.emulation.network,
    cacheDisabled: tab.emulation.cacheDisabled,
    bypassServiceWorker: tab.emulation.bypassServiceWorker,
    dataSaver: tab.emulation.dataSaver,
    cpuThrottlingRate: tab.emulation.cpuThrottlingRate,
    animationPlaybackRate: tab.emulation.animationPlaybackRate ?? 1,
    viewport: viewport
      ? {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: viewport.deviceScaleFactor,
          mobile: viewport.mobile,
          touch: viewport.touch
        }
      : {
          width: bounds.width,
          height: bounds.height,
          deviceScaleFactor: 1,
          mobile: false,
          touch: false
        },
    zoomPercent: Math.round(tab.webContents.getZoomFactor() * 100),
    ...(tab.zoomIsolated ? { zoomIsolated: true } : {}),
    ...(tab.defaultFontSize ? { defaultFontSize: tab.defaultFontSize } : {}),
    userAgentOverridden: tab.emulation.userAgent !== undefined,
    localeOverridden: tab.emulation.locale !== undefined,
    timezoneOverridden: tab.emulation.timezoneId !== undefined,
    extraHttpHeaders: Boolean(Object.keys(tab.emulationExtraHttpHeaders).length)
  }
}

/**
 * A fingerprint of the tab's performance environment, which changes with any
 * emulation, header, view size, zoom or font size change. The tab's emulation
 * must be confirmed.
 */
export function tabPerformanceEnvironmentFingerprint(browser: Browser, tab: BrowserTab): string {
  browser.requireEmulationConfirmed(tab)
  const bounds = tab.view.getBounds()
  return performanceEnvironmentFingerprint(
    tab.emulation,
    tab.emulationExtraHttpHeaders,
    bounds,
    Math.round(tab.webContents.getZoomFactor() * 100),
    tab.zoomIsolated,
    tab.defaultFontSize
  )
}
