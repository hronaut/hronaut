import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type DispatchGate = { ready: boolean; commands: string[]; unlocks: number; release: () => void; restore: () => void }
type NativeEvent = { at: number; phase: 'setup' | 'guarded'; type: string; trusted: boolean; x?: number; y?: number; button?: number; buttons?: number }
type NativeHistory = { events: NativeEvent[]; overflow: number; boundaryAt: number }

function guardedEffects(history: NativeHistory): { moves: number; downs: number; keys: number } {
  expect(history.overflow, 'Native event evidence must not be truncated').toBe(0)
  const events = history.events.filter(event => event.phase === 'guarded')
  return {
    moves: events.filter(event => event.type === 'mousemove').length,
    downs: events.filter(event => event.type === 'mousedown').length,
    keys: events.filter(event => event.type === 'keydown').length
  }
}

function assertEffects(actual: { moves: number; downs: number; keys: number }, expected: { moves: number; downs: number; keys: number }): void {
  expect(actual).toEqual(expected)
}

type DispatchGlobal = typeof globalThis & { nativeDispatchGate?: DispatchGate }

for (const action of ['hover', 'drag', 'press'] as const) {
  for (const phase of action === 'hover' ? ['unlock'] as const : ['unlock', 'pressed'] as const) {
    for (const change of ['unchanged', 'pause', 'access', 'route', 'cancel'] as const) {
      const controls = action === 'drag' && phase === 'unlock' && change === 'route'
        ? ['none', 'pre-lock', 'post-boundary'] as const
        : ['none'] as const
      for (const control of controls) {
        test(`native ${action} revalidates at ${phase}: ${change}${control === 'none' ? '' : ` (${control} ownership control)`}`, async ({ capabilities, appWindow, electronApp }, testInfo) => {
          const { client, tabId, fixtureUrl } = capabilities
          await electronApp.evaluate(async ({ webContents }, url) => {
            const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
            await page.executeJavaScript(`(() => {
              window.nativeHistory={phase:'setup',events:[],overflow:0,boundaryAt:0};
              for(const type of ['mousemove','mousedown','keydown']) document.addEventListener(type,event=>{
                const history=window.nativeHistory;
                if(history.events.length>=128){history.overflow++;return}
                history.events.push({at:Date.now(),phase:history.phase,type:event.type,trusted:event.isTrusted,x:event.clientX,y:event.clientY,button:event.button,buttons:event.buttons});
              });
              document.body.innerHTML='<input id="target" style="position:fixed;left:100px;top:100px;width:200px;height:100px">';
              document.querySelector('#target').focus();
            })()`)
          }, fixtureUrl)
          if (control === 'pre-lock') {
            // A known setup event must remain in the evidence, without becoming
            // an effect attributed to the later guarded action.
            await electronApp.evaluate(({ webContents }, url) => {
              webContents.getAllWebContents().find(contents => contents.getURL() === url)!.sendInputEvent({ type: 'mouseMove', x: 43, y: 37, movementX: 0, movementY: 0 })
            }, fixtureUrl)
            await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url)!.executeJavaScript("window.nativeHistory.events.some(event=>event.phase==='setup'&&event.type==='mousemove'&&event.trusted&&event.x===43&&event.y===37&&event.buttons===0)"), fixtureUrl)).toBe(true)
          }
          // Begin the strict effect boundary before requesting the human lock.
          // Never reset history or omit events during the real compositor unlock.
          await electronApp.evaluate(async ({ webContents }, url) => {
            await webContents.getAllWebContents().find(contents => contents.getURL() === url)!.executeJavaScript("window.nativeHistory.boundaryAt=Date.now();window.nativeHistory.phase='guarded'")
          }, fixtureUrl)
          await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, true), tabId)
          await electronApp.evaluate(({ webContents }, { url, phase }) => {
            const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
            const send = page.debugger.sendCommand
            let release!: () => void
            const barrier = new Promise<void>(resolve => { release = resolve })
            const gate: DispatchGate = { ready: false, commands: [], unlocks: 0, release, restore: () => { if (!page.isDestroyed()) page.debugger.sendCommand = send } }
            ;(globalThis as DispatchGlobal).nativeDispatchGate = gate
            page.debugger.sendCommand = async (method, ...args) => {
              const params = args[0] as Record<string, unknown> | undefined
              if (method === 'Input.dispatchMouseEvent' || method === 'Input.dispatchKeyEvent') gate.commands.push(String(params?.type))
              const result = await send.call(page.debugger, method, ...args)
              // Hold the actual compositor unlock immediately before the first native dispatch.
              if (!gate.ready && ((phase === 'unlock' && method === 'Input.setIgnoreInputEvents' && params?.ignore === false && ++gate.unlocks === 1)
                || (phase === 'pressed' && ((method === 'Input.dispatchMouseEvent' && params?.type === 'mousePressed') || (method === 'Input.dispatchKeyEvent' && params?.type === 'keyDown'))))) {
                gate.ready = true
                await barrier
              }
              return result
            }
          }, { url: fixtureUrl, phase })
          const transport = client.transport!
          const send = transport.send.bind(transport)
          let requestId: string | number | undefined
          const name = `browser_${action}`
          transport.send = async (message, options) => {
            if ('method' in message && message.method === 'tools/call' && 'id' in message && message.params?.name === name) requestId = message.id
            return send(message, options)
          }
          const abort = new AbortController()
          let pending: Promise<CallToolResult> | undefined
          try {
            const args = action === 'hover' ? { x: 150, y: 140 } : action === 'drag' ? { startX: 150, startY: 140, endX: 250, endY: 140 } : { key: 'x' }
            pending = client.callTool({ name, arguments: { tabId, ...args } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>
            if (change === 'cancel') pending = pending.catch(() => ({ isError: true, content: [{ type: 'text', text: 'Client cancelled' }] }))
            await expect.poll(() => electronApp.evaluate(() => (globalThis as DispatchGlobal).nativeDispatchGate!.ready)).toBe(true)
            if (control === 'post-boundary') {
              // Deliberately inject a DOM event while the real unlock is held.
              // It has no native-input provenance; the oracle must still detect it.
              await electronApp.evaluate(async ({ webContents }, url) => {
                await webContents.getAllWebContents().find(contents => contents.getURL() === url)!.executeJavaScript("document.dispatchEvent(new MouseEvent('mousemove',{clientX:43,clientY:37,buttons:0,bubbles:true}))")
              }, fixtureUrl)
            }
            if (change === 'pause') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, true), tabId)
            if (change === 'access') await appWindow.evaluate(async id => {
              const api = (window as unknown as { hronaut: HronautApi }).hronaut
              const workspace = (await api.getState()).tabs.find(tab => tab.id === id)!.mcpGroupId!
              await api.updateTabGroup(workspace, { agentAccess: false })
            }, tabId)
            if (change === 'route') await electronApp.evaluate(async ({ webContents }, url) => {
              await webContents.getAllWebContents().find(contents => contents.getURL() === url)!.executeJavaScript("location.hash='changed-native-context'")
            }, fixtureUrl)
            if (change === 'cancel') {
              if (requestId === undefined) throw new Error('Missing native input request id')
              await client.notification({ method: 'notifications/cancelled', params: { requestId, reason: 'Controlled native input cancellation' } })
              abort.abort()
            }
            await electronApp.evaluate(() => (globalThis as DispatchGlobal).nativeDispatchGate!.release())
            const result = await pending
            // The client can settle cancellation before the server unwinds its input scope.
            await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL().split('#')[0] === url.split('#')[0])!.executeJavaScript('window.__hronautAgentInputActive === true'), fixtureUrl)).toBe(false)
            const observation = await electronApp.evaluate(async ({ webContents }, url) => ({
              commands: (globalThis as DispatchGlobal).nativeDispatchGate!.commands,
              history: await webContents.getAllWebContents().find(contents => contents.getURL().split('#')[0] === url.split('#')[0])!.executeJavaScript('window.nativeHistory') as NativeHistory
            }), fixtureUrl)
            await testInfo.attach('native-dispatch-observation', { body: JSON.stringify({ action, phase, change, control, result, observation }), contentType: 'application/json' })
            const effects = guardedEffects(observation.history)
            const expectedCommands = change === 'unchanged' ? action === 'hover' ? 1 : action === 'drag' ? 11 : 2 : phase === 'unlock' ? 0 : action === 'drag' ? 3 : 2
            expect(observation.commands).toHaveLength(expectedCommands)
            if (phase === 'pressed' && change !== 'unchanged') expect(observation.commands).toEqual(action === 'drag' ? ['mouseMoved', 'mousePressed', 'mouseReleased'] : ['keyDown', 'keyUp'])
            if (control === 'pre-lock') {
              expect(observation.history.events.some(event => event.phase === 'setup' && event.trusted && event.x === 43 && event.y === 37 && event.buttons === 0)).toBe(true)
            }
            if (change !== 'unchanged') {
              const expected = { moves: 0, downs: phase === 'pressed' && action === 'drag' ? 1 : 0, keys: phase === 'pressed' && action === 'press' ? 1 : 0 }
              if (control === 'post-boundary') {
                expect(effects).toEqual({ moves: 1, downs: 0, keys: 0 })
                expect(observation.history.events.some(event => event.phase === 'guarded' && !event.trusted && event.x === 43 && event.y === 37)).toBe(true)
                expect(() => assertEffects(effects, expected)).toThrow()
              } else assertEffects(effects, expected)
            }
            if (change === 'unchanged' && action !== 'hover') expect(effects[action === 'drag' ? 'downs' : 'keys']).toBe(1)
            expect(result.isError === true, text(result)).toBe(change !== 'unchanged')
            if (control !== 'none') {
              expect(result.structuredContent?.status).toBe('OUTCOME_UNKNOWN')
              expect(result.structuredContent?.retrySafe).toBe(false)
            }
          } finally {
            transport.send = send
            await electronApp.evaluate(() => (globalThis as DispatchGlobal).nativeDispatchGate?.release()).catch(() => undefined)
            await pending?.catch(() => undefined)
            await electronApp.evaluate(() => { const scope = globalThis as DispatchGlobal; scope.nativeDispatchGate?.restore(); delete scope.nativeDispatchGate }).catch(() => undefined)
          }
        })
      }
    }
  }
}
