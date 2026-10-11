import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type AdmissionGate = {
  ready: boolean
  presses: number
  nativeEvents: Array<{ type: string; prevented: boolean }>
  release(): void
  restore(): void
}
type AdmissionGlobal = typeof globalThis & { __inputAdmissionGate?: AdmissionGate }

for (const phase of ['move', 'press', 'unlock'] as const) for (const locked of [false, true]) {
  if (phase === 'unlock' && !locked) continue
  for (const directInput of ['none', 'keyboard'] as const) {
    test(`native click after ${directInput} input with lock ${locked} held after ${phase}`, async ({ capabilities, electronApp, appWindow }) => {
      const { client, tabId, fixtureUrl } = capabilities
      const zoom = 1
      let pending: Promise<CallToolResult> | undefined
      const generation = (): Promise<number> => appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.id === id)!.humanInteractionGeneration ?? 0, tabId)
      try {
        await electronApp.evaluate(async ({ webContents }, { url, zoom, phase }) => {
          const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
          page.setZoomFactor(zoom)
          await page.executeJavaScript(`document.body.innerHTML='<button id="agent" style="position:fixed;left:100px;top:100px;width:150px;height:80px">Agent target</button><button id="human" style="position:fixed;left:350px;top:100px;width:150px;height:80px">Direct target</button>';window.agentClicks=0;window.directInputs=0;document.querySelector('#agent').onclick=()=>window.agentClicks++;document.querySelector('#human').onmousedown=()=>window.directInputs++;document.body.onkeydown=()=>window.directInputs++;document.querySelector('#human').focus();`)
          const api = page.debugger
          const original = api.sendCommand
          let unlocks = 0
          let release!: () => void
          const barrier = new Promise<void>(resolve => { release = resolve })
          const gate: AdmissionGate = { ready: false, presses: 0, nativeEvents: [], release, restore: () => {
            page.removeListener('before-input-event', onKeyboard)
            if (!page.isDestroyed()) api.sendCommand = original
          } }
          const onKeyboard = (event: Electron.Event, input: Electron.Input): void => {
            if (input.key === 'x' && input.type === 'keyDown' && gate.nativeEvents.length < 32) gate.nativeEvents.push({ type: input.type, prevented: event.defaultPrevented })
          }
          page.on('before-input-event', onKeyboard)
          ;(globalThis as AdmissionGlobal).__inputAdmissionGate = gate
          api.sendCommand = async (method, ...args) => {
            const params = args[0] as Record<string, unknown> | undefined
            if (method === 'Input.dispatchMouseEvent' && params?.type === 'mousePressed') gate.presses++
            const result = await original.call(api, method, ...args)
            if (method === 'Input.setIgnoreInputEvents' && params?.ignore === false) unlocks++
            if (!gate.ready && ((phase === 'move' && method === 'Input.dispatchMouseEvent' && params?.type === 'mouseMoved')
              || (phase === 'press' && method === 'Input.dispatchMouseEvent' && params?.type === 'mousePressed')
              || (phase === 'unlock' && method === 'Input.setIgnoreInputEvents' && params?.ignore === false && unlocks === 2))) {
              gate.ready = true
              await barrier
            }
            return result
          }
        }, { url: fixtureUrl, zoom, phase })
        await appWindow.evaluate(({ id, locked }) => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, locked), { id: tabId, locked })
        const before = await generation()
        pending = client.callTool({ name: 'browser_click', arguments: { tabId, selector: '#agent', native: true, doubleClick: phase === 'press' } }) as Promise<CallToolResult>
        await expect.poll(() => electronApp.evaluate(() => (globalThis as AdmissionGlobal).__inputAdmissionGate?.ready)).toBe(true)
        if (directInput !== 'none') {
          await electronApp.evaluate(({ webContents }, { url }) => {
            const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
            page.focus()
            // Deliberately differs from the outstanding CDP mouse movement.
            // This exercises native admission, not proof of physical origin.
            page.sendInputEvent({ type: 'keyDown', keyCode: 'X' })
            page.sendInputEvent({ type: 'keyUp', keyCode: 'X' })
          }, { url: fixtureUrl })
          await expect.poll(() => electronApp.evaluate(() => (globalThis as AdmissionGlobal).__inputAdmissionGate!.nativeEvents.length)).toBe(1)
          expect(await electronApp.evaluate(() => (globalThis as AdmissionGlobal).__inputAdmissionGate!.nativeEvents)).toEqual([{ type: 'keyDown', prevented: locked }])
          if (!locked) await expect.poll(() => electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('window.directInputs'), fixtureUrl)).toBe(1)
        }
        const afterDirectInput = await generation()
        await electronApp.evaluate(() => (globalThis as AdmissionGlobal).__inputAdmissionGate!.release())
        const result = await pending
        const observation = await electronApp.evaluate(async ({ webContents }, url) => ({
          presses: (globalThis as AdmissionGlobal).__inputAdmissionGate!.presses,
          page: await webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('({agentClicks:window.agentClicks,directInputs:window.directInputs})')
        }), fixtureUrl)
        const interrupted = !locked && directInput !== 'none'
        const clicks = interrupted ? (phase === 'press' ? 1 : 0) : phase === 'press' ? 2 : 1
        expect({ ...observation, generationDelta: afterDirectInput - before }).toEqual({
          presses: clicks,
          page: { agentClicks: clicks, directInputs: interrupted ? 1 : 0 },
          generationDelta: interrupted ? 1 : 0
        })
        expect(result.isError === true, text(result)).toBe(interrupted)
        if (interrupted) expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false })
      } finally {
        await electronApp.evaluate(() => {
          const scope = globalThis as AdmissionGlobal
          scope.__inputAdmissionGate?.release()
          scope.__inputAdmissionGate?.restore()
          delete scope.__inputAdmissionGate
        }).catch(() => undefined)
        await pending?.catch(() => undefined)
      }
    })
  }
}
