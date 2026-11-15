import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

// Shift+F10 opens a page's context menu on Windows and Linux, as a right-click does. Pressed by an agent in a page the
// person had not locked, Hronaut's page menu opened with it as the person's own, at their pointer, where Paste would
// give the agent's page their clipboard.

test('browser_press Shift+F10 opens only the page\'s own menu, and only in a page the person locked', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const opensMenu = process.platform !== 'darwin'
  await electronApp.evaluate(async ({ webContents, Menu }, url) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
    const scope = globalThis as typeof globalThis & { __pageMenuEvidence?: unknown }
    let popups = 0
    const popup = Menu.prototype.popup
    // Counted, not shown: a menu that opened by mistake would stay open over the next test.
    Menu.prototype.popup = function (): void { popups++ }
    scope.__pageMenuEvidence = { get popups() { return popups }, restore: () => { Menu.prototype.popup = popup } }
    await page.executeJavaScript(`document.body.innerHTML = '<input id="field">'
      window.pageMenus = 0
      document.addEventListener('contextmenu', () => { window.pageMenus++ })
      document.querySelector('#field').focus()
      void 0`)
  }, fixtureUrl)
  const evidence = async () => await electronApp.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
    const scope = globalThis as typeof globalThis & { __pageMenuEvidence: { popups: number } }
    return { popups: scope.__pageMenuEvidence.popups, pageMenus: await page.executeJavaScript('window.pageMenus') as number }
  }, fixtureUrl)
  const press = async (key: string) => await client.callTool({ name: 'browser_press', arguments: { tabId, key } }) as CallToolResult
  try {
    const unlocked = await press('Shift+F10')
    if (opensMenu) {
      expect(unlocked.isError).toBe(true)
      expect(text(unlocked)).toContain('requires a page locked in the trusted UI')
    } else {
      expect(unlocked.isError, text(unlocked)).not.toBe(true)
    }
    // Other keys go on as before.
    const plain = await press('F10')
    expect(plain.isError, text(plain)).not.toBe(true)
    await appWindow.waitForTimeout(500)
    expect(await evidence()).toEqual({ popups: 0, pageMenus: 0 })

    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, true), tabId)
    const locked = await press('Shift+F10')
    expect(locked.isError, text(locked)).not.toBe(true)
    if (opensMenu) await expect.poll(async () => (await evidence()).pageMenus).toBe(1)
    await appWindow.waitForTimeout(500)
    expect((await evidence()).popups).toBe(0)
  } finally {
    await electronApp.evaluate(() => {
      (globalThis as typeof globalThis & { __pageMenuEvidence?: { restore: () => void } }).__pageMenuEvidence?.restore()
    })
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, false), tabId)
  }
})
