import { isMemorySaverTimeoutMinutes, memorySaverCutoff, type MemorySaverTimeoutMinutes } from '../../../shared/memory-saver.js'
import type { BrowserState } from '../../../shared/types.js'
import type { Browser } from '../browser.js'
import { putTabToSleep } from './tab-sleep.js'
import { findTab } from '../browser-core.js'
import { browserState } from '../browser-state/browser-state.js'

/**
 * Turns Memory Saver on or off and sets its timeout. A change ends any sweep
 * started before it. Turning Memory Saver off leaves the sleeping tabs asleep,
 * as Chrome does, until each is shown or used: waking them all at once, such as
 * the tabs restored asleep, would load every page together.
 */
export function setMemorySaverSettings(browser: Browser, enabled: boolean, timeoutMinutes: MemorySaverTimeoutMinutes): void {
  if (!isMemorySaverTimeoutMinutes(timeoutMinutes)) throw new TypeError('Unsupported Memory Saver timeout')
  if (browser.memorySaverEnabled !== enabled || browser.memorySaverTimeoutMinutes !== timeoutMinutes) {
    browser.memorySaverSettingsGeneration += 1
  }
  browser.memorySaverEnabled = enabled
  browser.memorySaverTimeoutMinutes = timeoutMinutes
}

/** Puts every tab that may sleep to sleep now, whatever its last activity, after any sweep already running. */
export async function sleepInactiveTabs(browser: Browser): Promise<BrowserState> {
  await sweepMemorySaver(browser, true)
  return browserState(browser)
}

/**
 * Runs a sleep sweep after any sweep already running. Unless force is set,
 * only tabs inactive for longer than the timeout go to sleep.
 */
export async function sweepMemorySaver(browser: Browser, force: boolean): Promise<void> {
  return browser.memorySaverSweeps.run(() => runMemorySaverSweep(browser, force))
}

/**
 * Puts each awake tab to sleep in turn while Memory Saver stays on, its
 * settings unchanged and the tab manager alive.
 */
async function runMemorySaverSweep(browser: Browser, force: boolean): Promise<void> {
  if (!browser.memorySaverEnabled) return
  const generation = browser.memorySaverSettingsGeneration
  const isCurrent = () => !browser.destroyed && browser.memorySaverEnabled && generation === browser.memorySaverSettingsGeneration
  const cutoff = memorySaverCutoff(Date.now(), browser.memorySaverTimeoutMinutes)
  // A copy, since a page can open a tab beside another while one goes to sleep, which puts the tabs in a new order.
  for (const tab of [...browser.tabs.values()]) {
    if (!isCurrent()) return
    if (findTab(browser, tab.id) !== tab || tab.sleeping || (!force && tab.lastActiveAt > cutoff)) continue
    await putTabToSleep(browser, tab, false, isCurrent)
  }
}
