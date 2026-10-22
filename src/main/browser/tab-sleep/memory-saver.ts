import { isMemorySaverTimeoutMinutes, memorySaverCutoff, type MemorySaverTimeoutMinutes } from '../../../shared/memory-saver.js'
import type { BrowserState } from '../../../shared/types.js'
import type { MemorySaverAccess, MemorySaverTab } from './memory-saver-access.js'

/**
 * Turns Memory Saver on or off and sets its timeout. A change ends any sweep
 * started before it; turning Memory Saver off wakes every sleeping tab.
 */
export function setMemorySaverSettings<Tab extends MemorySaverTab>(access: MemorySaverAccess<Tab>, enabled: boolean, timeoutMinutes: MemorySaverTimeoutMinutes): void {
  if (!isMemorySaverTimeoutMinutes(timeoutMinutes)) throw new TypeError('Unsupported Memory Saver timeout')
  if (access.memorySaverEnabled() !== enabled || access.memorySaverTimeoutMinutes() !== timeoutMinutes) {
    access.setMemorySaverSettingsGeneration(access.memorySaverSettingsGeneration() + 1)
  }
  access.setMemorySaverEnabled(enabled)
  access.setMemorySaverTimeoutMinutes(timeoutMinutes)
  if (!enabled) {
    for (const tab of access.tabs()) {
      if (tab.sleeping) void access.wakeTab(tab.id).catch((error) => console.error('[browser] Could not wake tab after disabling Memory Saver:', error))
    }
  }
}

/** Puts every tab that may sleep to sleep now, whatever its last activity, after any sweep already running. */
export async function sleepInactiveTabs<Tab extends MemorySaverTab>(access: MemorySaverAccess<Tab>): Promise<BrowserState> {
  await sweepMemorySaver(access, true)
  return access.getState()
}

/**
 * Runs a sleep sweep after any sweep already running. Unless force is set,
 * only tabs inactive for longer than the timeout go to sleep.
 */
export async function sweepMemorySaver<Tab extends MemorySaverTab>(access: MemorySaverAccess<Tab>, force: boolean): Promise<void> {
  return access.memorySaverSweeps().run(() => runMemorySaverSweep(access, force))
}

/**
 * Puts each awake tab to sleep in turn while Memory Saver stays on, its
 * settings unchanged and the tab manager alive.
 */
async function runMemorySaverSweep<Tab extends MemorySaverTab>(access: MemorySaverAccess<Tab>, force: boolean): Promise<void> {
  if (!access.memorySaverEnabled()) return
  const generation = access.memorySaverSettingsGeneration()
  const isCurrent = () => !access.isDestroyed() && access.memorySaverEnabled() && generation === access.memorySaverSettingsGeneration()
  const cutoff = memorySaverCutoff(Date.now(), access.memorySaverTimeoutMinutes())
  // A copy, since a page can open a tab beside another while one goes to sleep, which puts the tabs in a new order.
  for (const tab of [...access.tabs()]) {
    if (!isCurrent()) return
    if (access.findTab(tab.id) !== tab || tab.sleeping || (!force && tab.lastActiveAt > cutoff)) continue
    await access.putTabToSleep(tab, false, isCurrent)
  }
}
