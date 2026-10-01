import type { HronautApi } from '../../src/shared/types.js'
import { reproScrollScript } from '../../src/main/browser/repro-page-scripts.js'
import { expect, test } from './fixtures.js'

type StartProbe = { held: boolean; release(): void; restore(): void }
type ProbeGlobal = typeof globalThis & { __reproStartProbe?: StartProbe }

test('times out a stalled Repro start and preserves a retry when the old response arrives', async ({ appWindow, electronApp }) => {
  const url = 'data:text/html,<title>Repro start timeout</title><p>Ready</p>'
  const state = await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
  const tabId = state.activeTabId!
  await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(page => page.getURL() === url && !page.isLoading()), url)).toBe(true)
  await electronApp.evaluate(({ webContents }, input) => {
    const page = webContents.getAllWebContents().find(page => page.getURL() === input.url)!
    const original = page.executeJavaScript
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const probe: StartProbe = { held: false, release, restore: () => { page.executeJavaScript = original; release() } }
    page.executeJavaScript = async function (...args) {
      const result = await original.apply(this, args)
      if (args[0] !== input.script) return result
      page.executeJavaScript = original
      probe.held = true
      await gate
      return result
    }
    ;(globalThis as ProbeGlobal).__reproStartProbe = probe
  }, { url, script: reproScrollScript() })
  try {
    const pending = appWindow.evaluate(async tabId => {
      try {
        await (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId)
        return 'accepted'
      } catch (error) { return String(error) }
    }, tabId)
    await expect.poll(() => electronApp.evaluate(() => (globalThis as ProbeGlobal).__reproStartProbe!.held)).toBe(true)
    expect(await pending).toContain('Reproduction start timed out')
    expect(await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', tabId), tabId)).toMatchObject({ active: false, stepCount: 0 })
    const restarted = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId), tabId)
    expect(restarted).toMatchObject({ active: true, stepCount: 1 })
    await electronApp.evaluate(() => (globalThis as ProbeGlobal).__reproStartProbe!.release())
    expect(await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', tabId), tabId)).toEqual(restarted)
  } finally {
    await electronApp.evaluate(() => {
      ;(globalThis as ProbeGlobal).__reproStartProbe?.restore()
      delete (globalThis as ProbeGlobal).__reproStartProbe
    }).catch(() => undefined)
    await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('clear', tabId), tabId).catch(() => undefined)
  }
})
