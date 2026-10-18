import type { ElectronApplication } from '@playwright/test'
import type { McpToolActivity } from '../../src/main/mcp/activity-history.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type InputCheckpoint = { at: number; stage: 'send' | 'ack'; method: string; type?: unknown; ignore?: unknown }
type MouseDecision = { at: number; type: string; x: number; y: number; prevented: boolean }
type DispatchGate = { ready: boolean; armed: boolean; commands: string[]; unlocks: number; initialLockAcknowledgedAt: number; timeline: InputCheckpoint[]; mouseDecisions: MouseDecision[]; overflow: number; preparationHeld: boolean; cleanupHeld: boolean; releaseCleanup: () => void; releasePreparation: () => void; release: () => void; restore: () => void }
type NativeEvent = { at: number; phase: 'setup' | 'pending-lock' | 'locked' | 'action'; type: string; trusted: boolean; x?: number; y?: number; button?: number; buttons?: number }
type NativeHistory = { events: NativeEvent[]; overflow: number; boundaryAt: number }

function guardedEffects(history: NativeHistory & { lockAcknowledgedAt: number }): { moves: number; downs: number; keys: number } {
  expect(history.overflow, 'Native event evidence must not be truncated').toBe(0)
  // Include every observed effect after acknowledgement, including events that
  // arrive before the renderer's descriptive phase marker changes.
  expect(history.lockAcknowledgedAt, 'Initial compositor lock must be acknowledged').toBeGreaterThan(0)
  const events = history.events.filter(event => event.at >= history.lockAcknowledgedAt)
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

async function terminalActivities(app: ElectronApplication, tabId: string, toolName: string): Promise<McpToolActivity[]> {
  return app.evaluate(async ({ webContents }, { id, name }) => {
    const home = webContents.getAllWebContents().find(page => page.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Missing Home session for native input settlement observation')
    const response = await home.session.fetch('hronaut://home/api/status')
    if (!response.ok) throw new Error(`Native input settlement observation failed: ${response.status}`)
    const state = await response.json() as { recentActivity: McpToolActivity[] }
    return state.recentActivity.filter(activity => activity.toolName === name && activity.tabId === id)
  }, { id: tabId, name: toolName })
}

for (const action of ['hover', 'drag', 'press'] as const) {
  for (const phase of action === 'hover' ? ['unlock'] as const : ['unlock', 'pressed'] as const) {
    for (const change of ['unchanged', 'pause', 'access', 'route', 'cancel'] as const) {
      const controls = action === 'drag' && phase === 'unlock' && change === 'route'
        ? ['none', 'pre-lock', 'pending-lock', 'post-ack', 'post-boundary'] as const
        : action === 'press' && phase === 'unlock' && change === 'cancel' ? ['none', 'held-cleanup'] as const : ['none'] as const
      for (const control of controls) {
        test(`native ${action} revalidates at ${phase}: ${change}${control === 'none' ? '' : ` (${control} ownership control)`}`, async ({ capabilities, appWindow, electronApp }, testInfo) => {
          const { client, tabId, fixtureUrl } = capabilities
          const name = `browser_${action}`
          const previousActivities = new Set((await terminalActivities(electronApp, tabId, name)).map(activity => activity.activityId))
          const completedActivities = async () => (await terminalActivities(electronApp, tabId, name)).filter(activity => !previousActivities.has(activity.activityId))
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
          await electronApp.evaluate(({ webContents }, { url, phase, control }) => {
            const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
            const send = page.debugger.sendCommand
            let release!: () => void
            let releasePreparation!: () => void
            let releaseCleanup!: () => void
            const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve })
            const barrier = new Promise<void>(resolve => { release = resolve })
            const preparation = new Promise<void>(resolve => { releasePreparation = resolve })
            const gate: DispatchGate = { ready: false, armed: false, commands: [], unlocks: 0, initialLockAcknowledgedAt: 0, timeline: [], mouseDecisions: [], overflow: 0, preparationHeld: false, cleanupHeld: false, releaseCleanup, releasePreparation, release, restore: () => { page.removeListener('before-mouse-event', observeMouse); if (!page.isDestroyed()) page.debugger.sendCommand = send } }
            const observeMouse = (event: Electron.Event, input: Electron.MouseInputEvent): void => {
              if (gate.mouseDecisions.length >= 128) { gate.overflow++; return }
              gate.mouseDecisions.push({ at: Date.now(), type: input.type, x: input.x, y: input.y, prevented: event.defaultPrevented })
            }
            page.on('before-mouse-event', observeMouse)
            ;(globalThis as DispatchGlobal).nativeDispatchGate = gate
            const record = (stage: 'send' | 'ack', method: string, params: Record<string, unknown> | undefined): void => {
              if (!method.startsWith('Input.')) return
              if (gate.timeline.length >= 128) { gate.overflow++; return }
              gate.timeline.push({ at: Date.now(), stage, method, type: params?.type, ignore: params?.ignore })
            }
            page.debugger.sendCommand = async (method, ...args) => {
              const params = args[0] as Record<string, unknown> | undefined
              if (control === 'pending-lock' && method === 'Emulation.setEmulatedMedia' && !gate.preparationHeld) {
                gate.preparationHeld = true
                await preparation
              }
              if (control === 'held-cleanup' && gate.armed && !gate.cleanupHeld && method === 'Input.setIgnoreInputEvents' && params?.ignore === true
                && await page.executeJavaScript('window.__hronautAgentInputActive === true') === false) {
                gate.cleanupHeld = true
                await cleanup
              }
              record('send', method, params)
              if (method === 'Input.dispatchMouseEvent' || method === 'Input.dispatchKeyEvent') gate.commands.push(String(params?.type))
              const result = await send.call(page.debugger, method, ...args)
              // Passively observe the real successful acknowledgement. Do not
              // await a renderer operation or omit events before phase updates.
              if (!gate.armed && !gate.initialLockAcknowledgedAt && method === 'Input.setIgnoreInputEvents' && params?.ignore === true) gate.initialLockAcknowledgedAt = Date.now()
              record('ack', method, params)
              // Hold the actual compositor unlock immediately before native dispatch.
              if (gate.armed && !gate.ready && ((phase === 'unlock' && method === 'Input.setIgnoreInputEvents' && params?.ignore === false && ++gate.unlocks === 1)
                || (phase === 'pressed' && ((method === 'Input.dispatchMouseEvent' && params?.type === 'mousePressed') || (method === 'Input.dispatchKeyEvent' && params?.type === 'keyDown'))))) {
                gate.ready = true
                await barrier
              }
              return result
            }
          }, { url: fixtureUrl, phase, control })
          const transport = client.transport!
          const send = transport.send.bind(transport)
          let requestId: string | number | undefined
          transport.send = async (message, options) => {
            if ('method' in message && message.method === 'tools/call' && 'id' in message && message.params?.name === name) requestId = message.id
            return send(message, options)
          }
          const abort = new AbortController()
          let pending: Promise<CallToolResult> | undefined
          let preparation: Promise<CallToolResult> | undefined
          let locking: Promise<{ requestedAt: number; returnedAt: number }> | undefined
          const knownInput = () => electronApp.evaluate(({ webContents }, url) => {
            webContents.getAllWebContents().find(contents => contents.getURL() === url)!.sendInputEvent({ type: 'mouseMove', x: 43, y: 37, movementX: 0, movementY: 0 })
          }, fixtureUrl)
          const waitForKnownInput = () => expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url)!.executeJavaScript("window.nativeHistory.events.some(event=>event.type==='mousemove'&&event.trusted&&event.x===43&&event.y===37&&event.buttons===0)"), fixtureUrl)).toBe(true)
          try {
            if (control === 'pre-lock') {
              await knownInput()
              await waitForKnownInput()
            }
            await electronApp.evaluate(async ({ webContents }, url) => {
              await webContents.getAllWebContents().find(contents => contents.getURL() === url)!.executeJavaScript("window.nativeHistory.boundaryAt=Date.now();window.nativeHistory.phase='pending-lock'")
            }, fixtureUrl)
            if (control === 'pending-lock') {
              preparation = client.callTool({ name: 'browser_emulate', arguments: { tabId, colorScheme: 'dark' } }) as Promise<CallToolResult>
              void preparation.catch(() => undefined)
              await expect.poll(() => electronApp.evaluate(() => (globalThis as DispatchGlobal).nativeDispatchGate!.preparationHeld)).toBe(true)
            }
            locking = appWindow.evaluate(async id => {
              const scope = window as unknown as { hronaut: HronautApi; nativeLockRequestedAt?: number }
              scope.nativeLockRequestedAt = Date.now()
              await scope.hronaut.setTabHumanInteractionLocked(id, true)
              return { requestedAt: scope.nativeLockRequestedAt, returnedAt: Date.now() }
            }, tabId)
            void locking.catch(() => undefined)
            if (control === 'pending-lock') {
              await expect.poll(() => appWindow.evaluate(() => (window as unknown as { nativeLockRequestedAt?: number }).nativeLockRequestedAt)).toBeGreaterThan(0)
              await knownInput()
              await waitForKnownInput()
              await electronApp.evaluate(() => (globalThis as DispatchGlobal).nativeDispatchGate!.releasePreparation())
              expect((await preparation!).isError).not.toBe(true)
            }
            const lockRequest = await locking
            const lockAcknowledgedAt = await electronApp.evaluate(() => (globalThis as DispatchGlobal).nativeDispatchGate!.initialLockAcknowledgedAt)
            expect(lockAcknowledgedAt).toBeGreaterThanOrEqual(lockRequest.requestedAt)
            expect(lockAcknowledgedAt).toBeLessThanOrEqual(lockRequest.returnedAt)
            await electronApp.evaluate(async ({ webContents }, url) => {
              await webContents.getAllWebContents().find(contents => contents.getURL() === url)!.executeJavaScript("window.nativeHistory.phase='locked'")
              ;(globalThis as DispatchGlobal).nativeDispatchGate!.armed = true
            }, fixtureUrl)
            if (control === 'post-ack') await knownInput()
            await electronApp.evaluate(async ({ webContents }, url) => {
              await webContents.getAllWebContents().find(contents => contents.getURL() === url)!.executeJavaScript("window.nativeHistory.phase='action'")
            }, fixtureUrl)
            const actionLaunchedAt = Date.now()
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
            if (control === 'held-cleanup') {
              await expect.poll(() => electronApp.evaluate(() => (globalThis as DispatchGlobal).nativeDispatchGate!.cleanupHeld)).toBe(true)
              const active = await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL() === url)!.executeJavaScript('window.__hronautAgentInputActive === true'), fixtureUrl)
              expect(active).toBe(false)
              const activitiesWhileHeld = await completedActivities()
              await testInfo.attach('native-held-cleanup-observation', { body: JSON.stringify({ active, activitiesWhileHeld }), contentType: 'application/json' })
              expect(activitiesWhileHeld).toEqual([])
              // The former flag-only endpoint would already have allowed a
              // snapshot. This later synthetic effect must still fail the oracle.
              await electronApp.evaluate(async ({ webContents }, url) => {
                await webContents.getAllWebContents().find(contents => contents.getURL() === url)!.executeJavaScript("document.dispatchEvent(new MouseEvent('mousemove',{clientX:43,clientY:37,buttons:0,bubbles:true}))")
              }, fixtureUrl)
              await electronApp.evaluate(() => (globalThis as DispatchGlobal).nativeDispatchGate!.releaseCleanup())
            }
            // The client and page flag can settle before final guard/focus cleanup.
            // Match the sole new terminal activity for this exact tool and tab;
            // it is recorded only after the server handler has unwound.
            await expect.poll(completedActivities).toHaveLength(1)
            const activities = await completedActivities()
            if (change === 'cancel') expect(activities).toMatchObject([{ result: { outcome: 'cancelled', reasonCode: 'REQUEST_CANCELLED' } }])
            await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(contents => contents.getURL().split('#')[0] === url.split('#')[0])!.executeJavaScript('window.__hronautAgentInputActive === true'), fixtureUrl)).toBe(false)
            const observation = await electronApp.evaluate(async ({ webContents }, url) => ({
              commands: (globalThis as DispatchGlobal).nativeDispatchGate!.commands,
              lockAcknowledgedAt: (globalThis as DispatchGlobal).nativeDispatchGate!.initialLockAcknowledgedAt,
              timeline: (globalThis as DispatchGlobal).nativeDispatchGate!.timeline,
              mouseDecisions: (globalThis as DispatchGlobal).nativeDispatchGate!.mouseDecisions,
              timelineOverflow: (globalThis as DispatchGlobal).nativeDispatchGate!.overflow,
              history: await webContents.getAllWebContents().find(contents => contents.getURL().split('#')[0] === url.split('#')[0])!.executeJavaScript('window.nativeHistory') as NativeHistory
            }), fixtureUrl)
            await testInfo.attach('native-dispatch-observation', { body: JSON.stringify({ action, phase, change, control, lockRequest, actionLaunchedAt, activities, result, observation }), contentType: 'application/json' })
            expect(observation.timelineOverflow).toBe(0)
            const effects = guardedEffects({ ...observation.history, lockAcknowledgedAt: observation.lockAcknowledgedAt })
            const expectedCommands = change === 'unchanged' ? action === 'hover' ? 1 : action === 'drag' ? 11 : 2 : phase === 'unlock' ? 0 : action === 'drag' ? 3 : 2
            expect(observation.commands).toHaveLength(expectedCommands)
            if (phase === 'pressed' && change !== 'unchanged') expect(observation.commands).toEqual(action === 'drag' ? ['mouseMoved', 'mousePressed', 'mouseReleased'] : ['keyDown', 'keyUp'])
            if (control === 'pre-lock') {
              expect(observation.history.events.some(event => event.phase === 'setup' && event.trusted && event.x === 43 && event.y === 37 && event.buttons === 0)).toBe(true)
            }
            if (control === 'pending-lock') {
              const known = observation.history.events.filter(event => event.trusted && event.x === 43 && event.y === 37 && event.buttons === 0)
              expect(known).toHaveLength(1)
              expect(known[0]!.phase).toBe('pending-lock')
              expect(known[0]!.at).toBeGreaterThanOrEqual(lockRequest.requestedAt)
              expect(known[0]!.at).toBeLessThan(observation.lockAcknowledgedAt)
              // The former marker-based oracle would reject this allowed input.
              expect(() => assertEffects({ moves: known.length, downs: 0, keys: 0 }, { moves: 0, downs: 0, keys: 0 })).toThrow()
            }
            if (control === 'post-ack') {
              expect(observation.mouseDecisions.filter(event => event.type === 'mouseMove' && event.x === 43 && event.y === 37)).toEqual([
                { at: expect.any(Number), type: 'mouseMove', x: 43, y: 37, prevented: true }
              ])
              expect(observation.history.events.some(event => event.trusted && event.x === 43 && event.y === 37)).toBe(false)
            }
            if (change !== 'unchanged') {
              // A drag stopped at its press has already sent its first move, which the locked tab's guard admits like the press.
              const expected = { moves: phase === 'pressed' && action === 'drag' ? 1 : 0, downs: phase === 'pressed' && action === 'drag' ? 1 : 0, keys: phase === 'pressed' && action === 'press' ? 1 : 0 }
              if (control === 'post-boundary' || control === 'held-cleanup') {
                expect(effects).toEqual({ moves: 1, downs: 0, keys: 0 })
                expect(observation.history.events.some(event => event.at >= observation.lockAcknowledgedAt && event.phase === 'action' && !event.trusted && event.x === 43 && event.y === 37)).toBe(true)
                expect(() => assertEffects(effects, expected)).toThrow()
              } else assertEffects(effects, expected)
            }
            if (change === 'unchanged' && action !== 'hover') expect(effects[action === 'drag' ? 'downs' : 'keys']).toBe(1)
            expect(result.isError === true, text(result)).toBe(change !== 'unchanged')
            if (control !== 'none' && control !== 'held-cleanup') {
              expect(result.structuredContent?.status).toBe('OUTCOME_UNKNOWN')
              expect(result.structuredContent?.retrySafe).toBe(false)
            }
          } finally {
            transport.send = send
            await electronApp.evaluate(() => (globalThis as DispatchGlobal).nativeDispatchGate?.releasePreparation()).catch(() => undefined)
            await preparation?.catch(() => undefined)
            await locking?.catch(() => undefined)
            await electronApp.evaluate(() => (globalThis as DispatchGlobal).nativeDispatchGate?.release()).catch(() => undefined)
            await electronApp.evaluate(() => (globalThis as DispatchGlobal).nativeDispatchGate?.releaseCleanup()).catch(() => undefined)
            await pending?.catch(() => undefined)
            await electronApp.evaluate(() => { const scope = globalThis as DispatchGlobal; scope.nativeDispatchGate?.restore(); delete scope.nativeDispatchGate }).catch(() => undefined)
          }
        })
      }
    }
  }
}
