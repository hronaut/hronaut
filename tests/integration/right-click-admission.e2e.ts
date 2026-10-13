import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type Probe = { commands: string[]; restore(): void }
type Scope = typeof globalThis & { rightAdmission?: Probe }

for (const state of ['unlocked', 'zoom', 'emulation', 'background', 'sleeping', 'hidden', 'child-frame', 'devtools'] as const) {
  test(`right-click rejects ${state} without native input or presentation changes`, async ({ capabilities, electronApp, appWindow }) => {
    const { client, tabId, fixtureUrl } = capabilities
    const originalPageId = await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.id, fixtureUrl)
    if (state !== 'unlocked') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, true), tabId)
    if (state === 'zoom') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setZoom({ tabId: id, action: 'set', percent: 125 }), tabId)
    if (state === 'emulation') expect((await client.callTool({ name: 'browser_emulate', arguments: { tabId, viewport: { width: 800, height: 600, deviceScaleFactor: 1, mobile: false, touch: false, orientation: 'portrait' } } })).isError).not.toBe(true)
    if (state === 'background' || state === 'sleeping') await appWindow.evaluate(async id => { const api = (window as unknown as { hronaut: HronautApi }).hronaut; await api.selectTab((await api.getState()).tabs.find(tab => tab.id !== id)!.id) }, tabId)
    if (state === 'sleeping') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabSleeping(id, true), tabId)
    if (state === 'hidden') await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.hide())
    if (state === 'child-frame') await electronApp.evaluate(async ({ webContents }, url) => { await webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('document.body.appendChild(document.createElement("iframe"));void 0') }, fixtureUrl)
    if (state === 'devtools') {
      // Trusted UI normally refuses Developer Tools while locked. Inject only
      // this native-state discriminator to exercise the defensive admission.
      await electronApp.evaluate(({ webContents }, id) => {
        const page = webContents.fromId(id)!
        const opened = page.isDevToolsOpened
        ;(globalThis as Scope).rightAdmission = { commands: [], restore: () => { page.isDevToolsOpened = opened } }
        page.isDevToolsOpened = () => true
      }, originalPageId)
    }
    const presentation = () => appWindow.evaluate(async id => { const s = await (window as unknown as { hronaut: HronautApi }).hronaut.getState(); const t = s.tabs.find(tab => tab.id === id)!; return { active: s.activeTabId, sleeping: t.sleeping, locked: t.humanInteractionLocked } }, tabId)
    const before = await presentation()
    await electronApp.evaluate(({ webContents }, id) => {
      const page = webContents.fromId(id)!
      const send = page.debugger.sendCommand
      const previous = (globalThis as Scope).rightAdmission
      const probe: Probe = { commands: [], restore: () => { page.debugger.sendCommand = send; previous?.restore() } }
      ;(globalThis as Scope).rightAdmission = probe
      page.debugger.sendCommand = async (method, ...args) => { if (method.startsWith('Input.')) probe.commands.push(method); return send.call(page.debugger, method, ...args) }
    }, originalPageId)
    try {
      const result = await client.callTool({ name: 'browser_click', arguments: { tabId, selector: 'button', native: true, button: 'right' } }) as CallToolResult
      expect(result.isError, text(result)).toBe(true)
      expect(await presentation()).toEqual(before)
      expect(await electronApp.evaluate(() => (globalThis as Scope).rightAdmission!.commands)).toEqual([])
      if (state === 'hidden') expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(false)
    } finally { await electronApp.evaluate(() => { (globalThis as Scope).rightAdmission?.restore(); delete (globalThis as Scope).rightAdmission }).catch(() => undefined) }
  })
}

for (const target of ['missing', 'ambiguous', 'disabled', 'covered', 'detached', 'replaced', 'late-overlay', 'shadow'] as const) {
  test(`right-click samples ${target} target without a press`, async ({ capabilities, electronApp, appWindow }) => {
    const { client, tabId, fixtureUrl } = capabilities
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, true), tabId)
    await electronApp.evaluate(async ({ webContents }, { url, target }) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      await page.executeJavaScript(`document.body.innerHTML='<button id="target" style="position:fixed;left:100px;top:100px;width:180px;height:80px">Menu</button>';${target === 'missing' ? "document.querySelector('#target').remove();" : target === 'ambiguous' ? "document.body.appendChild(document.querySelector('#target').cloneNode(true));" : target === 'disabled' ? "document.querySelector('#target').disabled=true;" : target === 'covered' ? "document.body.insertAdjacentHTML('beforeend','<div style=\"position:fixed;inset:0;z-index:100\">Cover</div>');" : target === 'shadow' ? "document.querySelector('#target').outerHTML='<div id=target style=\"position:fixed;left:100px;top:100px;width:180px;height:80px\"></div>';document.querySelector('#target').attachShadow({mode:'open'}).innerHTML='<button style=\"width:100%;height:100%\">Shadow</button>';" : ''}void 0`)
      const send = page.debugger.sendCommand
      const probe: Probe = { commands: [], restore: () => { page.debugger.sendCommand = send } }
      ;(globalThis as Scope).rightAdmission = probe
      page.debugger.sendCommand = async (method, ...args) => {
        const params = args[0] as Record<string, unknown> | undefined
        if (method === 'Input.dispatchMouseEvent') probe.commands.push(String(params?.type))
        const result = await send.call(page.debugger, method, ...args)
        if (method === 'Input.dispatchMouseEvent' && params?.type === 'mouseMoved') {
          if (target === 'detached') await page.executeJavaScript("document.querySelector('#target').remove();void 0")
          if (target === 'replaced') await page.executeJavaScript("document.querySelector('#target').replaceWith(document.querySelector('#target').cloneNode(true));void 0")
          if (target === 'late-overlay') await page.executeJavaScript("document.body.insertAdjacentHTML('beforeend','<div style=\"position:fixed;inset:0;z-index:100\">Cover</div>');void 0")
        }
        return result
      }
    }, { url: fixtureUrl, target })
    try {
      const result = await client.callTool({ name: 'browser_click', arguments: { tabId, selector: '#target', native: true, button: 'right' } }) as CallToolResult
      expect(result.isError, text(result)).toBe(true)
      expect(await electronApp.evaluate(() => (globalThis as Scope).rightAdmission!.commands.filter(type => type === 'mousePressed' || type === 'mouseReleased'))).toEqual([])
    } finally { await electronApp.evaluate(() => { (globalThis as Scope).rightAdmission?.restore(); delete (globalThis as Scope).rightAdmission }) }
  })
}

test('public right-click schema rejects unsupported combinations before manager input', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  await electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
    const send = page.debugger.sendCommand
    const probe: Probe = { commands: [], restore: () => { page.debugger.sendCommand = send } }
    ;(globalThis as Scope).rightAdmission = probe
    page.debugger.sendCommand = async (method, ...args) => { if (method.startsWith('Input.')) probe.commands.push(method); return send.call(page.debugger, method, ...args) }
  }, fixtureUrl)
  try {
    for (const change of [{ tabId: undefined }, { native: false }, { ref: 'e1' }, { selector: undefined }, { x: 1, y: 1 }, { doubleClick: true }, { dialogAction: 'dismiss' }, { modifiers: [] }, { button: 'middle' }]) {
      const result = await client.callTool({ name: 'browser_click', arguments: { tabId, selector: 'button', native: true, button: 'right', ...change } }) as CallToolResult
      expect(result.isError, text(result)).toBe(true)
    }
    expect(await electronApp.evaluate(() => (globalThis as Scope).rightAdmission!.commands)).toEqual([])
  } finally { await electronApp.evaluate(() => { (globalThis as Scope).rightAdmission?.restore(); delete (globalThis as Scope).rightAdmission }) }
})
