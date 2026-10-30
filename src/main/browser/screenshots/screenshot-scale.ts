import { screen } from 'electron'
import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'
import type { BrowserTab } from '../browser-tab.js'

/**
 * The pixel ratio a screenshot of the tab is taken at: the display's scale, or the emulated device's when that is
 * higher. It refuses a tab whose emulation is not confirmed, and a ratio past 32.
 */
export function screenshotPixelRatio(browser: Browser, tab: BrowserTab): number {
  browser.requireEmulationConfirmed(tab)
  const ratio = Math.max(1, screen.getDisplayMatching(browser.window.getBounds()).scaleFactor, tab.emulation.viewport?.deviceScaleFactor ?? 1)
  if (!Number.isFinite(ratio) || ratio > 32) throw new LocalizedError('appErrors.pageTools.pageScale')
  return ratio
}
