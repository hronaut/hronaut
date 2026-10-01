import type { BrowserState } from '../../src/shared/types.js'
import { test, expect } from './capability-fixtures.js'

test('global unlock preserves successful frozen-page behavior without thawing it', async ({ appWindow, electronApp }) => {
  const url = 'data:text/html,' + encodeURIComponent('<title>Frozen unlock fixture</title><button>Action</button>')
  const tabId = await appWindow.evaluate(`window.hronaut.newTab({url:${JSON.stringify(url)},active:true}).then(state=>state.activeTabId)`) as string
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state=>state.tabs.find(tab=>tab.active)?.title)')).toBe('Frozen unlock fixture')
  await appWindow.evaluate('window.hronaut.setAllHumanInteractionLocked(true)')
  await appWindow.evaluate(`window.hronaut.setTabPageLifecycle(${JSON.stringify(tabId)},'frozen')`)
  try {
    await appWindow.getByRole('button', { name: /Allow human page input/ }).click()
    await expect(appWindow.getByRole('button', { name: /Waiting.*Allow human page input/ })).toHaveCount(0, { timeout: 5000 })
    const state = await appWindow.evaluate('window.hronaut.getState()') as BrowserState
    expect(state.allHumanInteractionLocked).toBe(false)
    expect(state.tabs.find((tab: { id: string }) => tab.id === tabId)?.pageLifecycleState).toBe('frozen')
  } finally {
    // Release Chromium directly even on the old implementation, where its
    // queued Runtime.evaluate prevents the ordinary resume command from running.
    await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(page=>page.getURL() === url)
      await page?.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' })
    }, url)
  }
  await appWindow.evaluate(`window.hronaut.setTabPageLifecycle(${JSON.stringify(tabId)},'active')`)
  await appWindow.getByRole('button', { name: /Block human page input/ }).click()
  await appWindow.getByRole('button', { name: /Allow human page input/ }).click()
  await expect.poll(()=>appWindow.evaluate('window.hronaut.getState().then(state=>state.allHumanInteractionLocked)')).toBe(false)
  await expect(appWindow.getByRole('button', { name: /Block human page input/ })).toBeEnabled()
})


test('global unlock rejects a blocked debugger queue without applying a late unlock', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  await appWindow.evaluate('window.hronaut.setAllHumanInteractionLocked(true)')
  await electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
    const original = page.debugger.sendCommand
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const probe = { held: false, unlocks: 0, release, restore: () => { page.debugger.sendCommand = original } }
    ;(globalThis as typeof globalThis & { unlockQueueProbe?: typeof probe }).unlockQueueProbe = probe
    page.debugger.sendCommand = async function (...args) {
      if (args[0] === 'Emulation.setEmulatedMedia' && !probe.held) { probe.held = true; await gate }
      if (args[0] === 'Input.setIgnoreInputEvents' && args[1]?.ignore === false) probe.unlocks++
      return original.apply(this, args)
    }
  }, fixtureUrl)
  const operation = client.callTool({ name: 'browser_emulate', arguments: { tabId, colorScheme: 'dark' } })
  void operation.catch(() => undefined)
  try {
    await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { unlockQueueProbe?: { held: boolean } }).unlockQueueProbe?.held)).toBe(true)
    await appWindow.getByRole('button', { name: /Allow human page input/ }).click()
    await expect(appWindow.getByText('A page is busy. Input locks were not changed.', { exact: false })).toBeVisible({ timeout: 5000 })
    await expect(appWindow.getByRole('button', { name: /Allow human page input/ })).toBeEnabled()
    expect(await appWindow.evaluate('window.hronaut.getState().then(state=>state.allHumanInteractionLocked)')).toBe(true)
    await electronApp.evaluate(() => (globalThis as typeof globalThis & { unlockQueueProbe?: { release: () => void } }).unlockQueueProbe?.release())
    await operation
    expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { unlockQueueProbe?: { unlocks: number } }).unlockQueueProbe?.unlocks)).toBe(0)
    await appWindow.getByRole('button', { name: /Allow human page input/ }).click()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state=>state.allHumanInteractionLocked)')).toBe(false)
  } finally {
    await electronApp.evaluate(() => {
      const holder = globalThis as typeof globalThis & { unlockQueueProbe?: { release: () => void; restore: () => void } }
      holder.unlockQueueProbe?.release(); holder.unlockQueueProbe?.restore(); delete holder.unlockQueueProbe
    })
    await operation.catch(() => undefined)
  }
})
