import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type RelockProbe = { rawDown: boolean; injected: boolean; commands: string[]; relocks: number; restored: boolean; restore: () => void }
type ProbeGlobal = typeof globalThis & { relockProbe?: RelockProbe }

for (const action of ['drag', 'press', 'click'] as const) for (const failure of ['none', 'relock', 'relock-and-release', 'persistent-relock'] as const) {
  test(`native ${action} releases after successful raw down: ${failure}`, async ({ capabilities, electronApp, appWindow }, testInfo) => {
    const { client, tabId, fixtureUrl } = capabilities
    const failRelock = failure !== 'none'
    await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      await page.executeJavaScript("document.body.innerHTML='<input id=target style=\"position:fixed;left:100px;top:100px;width:200px;height:100px\">';window.relockEffects={mouseDown:0,mouseUp:0,keyDown:0,keyUp:0};for(const [event,key] of [['mousedown','mouseDown'],['mouseup','mouseUp'],['keydown','keyDown'],['keyup','keyUp']])document.addEventListener(event,()=>window.relockEffects[key]++);document.querySelector('#target').focus();")
    }, fixtureUrl)
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, true), tabId)
    await electronApp.evaluate(({ webContents }, { url, failRelock, failure }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      const send = page.debugger.sendCommand
      const probe: RelockProbe = { rawDown: false, injected: false, commands: [], relocks: 0, restored: false, restore: () => { if (!page.isDestroyed()) page.debugger.sendCommand = send } }
      ;(globalThis as ProbeGlobal).relockProbe = probe
      page.debugger.sendCommand = async (method, ...args) => {
        const params = args[0] as Record<string, unknown> | undefined
        if (probe.rawDown && method === 'Input.setIgnoreInputEvents' && params?.ignore === true) probe.relocks++
        if (failRelock && probe.rawDown && (!probe.injected || failure === 'persistent-relock') && method === 'Input.setIgnoreInputEvents' && params?.ignore === true) {
          probe.injected = true
          throw new Error('Controlled compositor re-lock failure after successful raw down')
        }
        if (method === 'Input.dispatchMouseEvent' || method === 'Input.dispatchKeyEvent') {
          probe.commands.push(String(params?.type))
          if (failure === 'relock-and-release' && probe.injected && (params?.type === 'mouseReleased' || params?.type === 'keyUp')) throw new Error('Controlled independent matching-release failure')
        }
        const result = await send.call(page.debugger, method, ...args)
        if (probe.rawDown && method === 'Input.setIgnoreInputEvents' && params?.ignore === true) probe.restored = true
        if ((method === 'Input.dispatchMouseEvent' && params?.type === 'mousePressed') || (method === 'Input.dispatchKeyEvent' && params?.type === 'keyDown')) probe.rawDown = true
        return result
      }
    }, { url: fixtureUrl, failRelock, failure })
    try {
      const args = action === 'drag' ? { startX: 150, startY: 140, endX: 250, endY: 140 } : action === 'press' ? { key: 'x' } : { x: 150, y: 140 }
      const result = await client.callTool({ name: `browser_${action}`, arguments: { tabId, ...args } }) as CallToolResult
      const observed = await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
        const probe = (globalThis as ProbeGlobal).relockProbe!
        return { rawDown: probe.rawDown, injected: probe.injected, commands: probe.commands, relocks: probe.relocks, restored: probe.restored, effects: await page.executeJavaScript('window.relockEffects') }
      }, fixtureUrl)
      await testInfo.attach('native-relock-observation', { body: JSON.stringify({ action, failure, result, observed }), contentType: 'application/json' })
      expect(observed.rawDown).toBe(true)
      expect(observed.injected).toBe(failRelock)
      expect(observed.restored).toBe(failure !== 'persistent-relock')
      if (failure === 'persistent-relock') expect(observed.relocks).toBeLessThanOrEqual(3)
      expect(await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.id === id)!.humanInteractionLocked, tabId)).toBe(true)
      expect(result.isError === true, text(result)).toBe(failRelock)
      expect(observed.effects[action === 'press' ? 'keyDown' : 'mouseDown']).toBe(1)
      expect(observed.commands.filter(type => type === (action === 'press' ? 'keyUp' : 'mouseReleased'))).toHaveLength(1)
      expect(observed.effects[action === 'press' ? 'keyUp' : 'mouseUp']).toBe(failure === 'relock-and-release' ? 0 : 1)
      if (failRelock) expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false })
    } finally {
      await electronApp.evaluate(() => { const scope = globalThis as ProbeGlobal; scope.relockProbe?.restore(); delete scope.relockProbe }).catch(() => undefined)
      await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, false), tabId).catch(() => undefined)
      // Clear any held synthetic input before the temporary profile closes.
      await electronApp.evaluate(async ({ webContents }, { url, action }) => {
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
        if (!page || page.isDestroyed()) return
        if (action !== 'press') await page.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 150, y: 140, button: 'left', buttons: 0, clickCount: 1 })
        else await page.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88 })
      }, { url: fixtureUrl, action }).catch(() => undefined)
    }
  })
}
