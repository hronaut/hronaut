import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type KeyGate = {
  ready: boolean
  events: Array<{ key: string; code: string; repeat: boolean; prevented: boolean }>
  inject(key: string, modifiers: Electron.KeyboardInputEvent['modifiers']): void
  release(): void
  restore(): void
}
type KeyScope = typeof globalThis & { __keyAdmission?: KeyGate }

for (const locked of [false, true]) {
  for (const scenario of ['character', 'raw', 'modified', 'different-key', 'different-modifiers', 'repeat', 'duplicate'] as const) {
    test(`keyboard event ${scenario} with lock ${locked}`, async ({ capabilities, electronApp, appWindow }) => {
      const { client, tabId, fixtureUrl } = capabilities
      const positive = ['character', 'raw', 'modified'].includes(scenario)
      let pending: Promise<CallToolResult> | undefined
      const generation = (): Promise<number> => appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.id === id)!.humanInteractionGeneration ?? 0, tabId)
      try {
        await electronApp.evaluate(async ({ webContents }, { url }) => {
          const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
          await page.executeJavaScript("document.body.innerHTML='<input id=target>';window.keys=[];document.querySelector('input').onkeydown=e=>window.keys.push({key:e.key,code:e.code,repeat:e.repeat});document.querySelector('input').focus();void 0")
          const send = page.debugger.sendCommand
          let release!: () => void
          const barrier = new Promise<void>(resolve => { release = resolve })
          const listener = (event: Electron.Event, input: Electron.Input): void => {
            if (input.type === 'keyDown' && gate.events.length < 16) gate.events.push({ key: input.key, code: input.code, repeat: input.isAutoRepeat, prevented: event.defaultPrevented })
          }
          const gate: KeyGate = { ready: false, events: [], release,
            inject: (keyCode, modifiers) => {
              page.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
              page.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
            },
            restore: () => { page.removeListener('before-input-event', listener); if (!page.isDestroyed()) page.debugger.sendCommand = send }
          }
          page.on('before-input-event', listener)
          ;(globalThis as KeyScope).__keyAdmission = gate
          page.debugger.sendCommand = async (method, ...args) => {
            const params = args[0] as Record<string, unknown> | undefined
            if (method === 'Input.dispatchKeyEvent' && params?.type !== 'keyUp' && !gate.ready) {
              page.focus()
              await page.executeJavaScript("document.querySelector('input').focus(); void 0")
              // The expected token is already installed, before native dispatch.
              gate.ready = true
              await barrier
            }
            return send.call(page.debugger, method, ...args)
          }
        }, { url: fixtureUrl })
        await appWindow.evaluate(({ id, locked }) => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, locked), { id: tabId, locked })
        const before = await generation()
        const key = scenario === 'character' ? 'a' : scenario === 'modified' ? 'Shift+a' : 'ArrowDown'
        pending = client.callTool({ name: 'browser_press', arguments: { tabId, key } }) as Promise<CallToolResult>
        await expect.poll(() => electronApp.evaluate(() => (globalThis as KeyScope).__keyAdmission?.ready)).toBe(true)
        await electronApp.evaluate((_electron, scenario) => {
          const gate = (globalThis as KeyScope).__keyAdmission!
          // sendInputEvent reaches before-input-event; CDP keys bypass that
          // callback in this runtime. A matching native shape is deliberately
          // admitted once, demonstrating the documented origin ambiguity.
          const keyCode = scenario === 'character' || scenario === 'modified' ? 'A' : scenario === 'different-key' ? 'Up' : 'Down'
          const modifiers: Electron.KeyboardInputEvent['modifiers'] = scenario === 'modified' || scenario === 'different-modifiers' ? ['shift'] : scenario === 'repeat' ? ['isautorepeat'] : []
          gate.inject(keyCode, modifiers)
          if (scenario === 'duplicate') gate.inject(keyCode, modifiers)
        }, scenario)
        await expect.poll(() => electronApp.evaluate(() => (globalThis as KeyScope).__keyAdmission!.events.length)).toBe(scenario === 'duplicate' ? 2 : 1)
        expect(await generation() - before).toBe(!locked && !positive ? 1 : 0)
        const events = await electronApp.evaluate(() => (globalThis as KeyScope).__keyAdmission!.events)
        expect(events[0]?.prevented).toBe(locked && !positive && scenario !== 'duplicate')
        if (scenario === 'duplicate') expect(events[1]?.prevented).toBe(locked)
        if (scenario === 'repeat') expect(events[0]?.repeat).toBe(true)
        await electronApp.evaluate(() => (globalThis as KeyScope).__keyAdmission!.release())
        const result = await pending
        const interrupted = !locked && !positive
        expect(result.isError === true, text(result)).toBe(interrupted)
        if (interrupted) expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', retrySafe: false })
        expect(await generation() - before).toBe(interrupted ? 1 : 0)
        const observed = await electronApp.evaluate(async ({ webContents }, url) => ({
          events: (globalThis as KeyScope).__keyAdmission!.events,
          keys: await webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('window.keys')
        }), fixtureUrl)
        const nativeEffects = positive ? 1 : scenario === 'duplicate' ? (locked ? 1 : 2) : locked ? 0 : 1
        expect(observed.keys).toHaveLength(1 + nativeEffects)
        expect(observed.events.filter(event => !event.prevented)).toHaveLength(nativeEffects)
        const expectedKey = scenario === 'character' ? 'a' : scenario === 'modified' ? 'A' : 'ArrowDown'
        expect(observed.keys).toContainEqual({ key: expectedKey, code: scenario === 'character' || scenario === 'modified' ? 'KeyA' : 'ArrowDown', repeat: false })
        // Restore the seam and exercise another key: no expected token or
        // interceptor may leak into the next operation, even after rejection.
        await electronApp.evaluate(({ webContents }, url) => {
          (globalThis as KeyScope).__keyAdmission!.restore()
          delete (globalThis as KeyScope).__keyAdmission
          webContents.getAllWebContents().find(page => page.getURL() === url)!.focus()
        }, fixtureUrl)
        const next = await client.callTool({ name: 'browser_press', arguments: { tabId, key: 'ArrowRight' } }) as CallToolResult
        expect(next.isError, text(next)).not.toBe(true)
        expect(await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('window.keys.length'), fixtureUrl)).toBe(2 + nativeEffects)
        expect(await generation() - before).toBe(interrupted ? 1 : 0)
      } finally {
        await electronApp.evaluate(() => {
          const gate = (globalThis as KeyScope).__keyAdmission
          gate?.release()
          gate?.restore()
          delete (globalThis as KeyScope).__keyAdmission
        }).catch(() => undefined)
        await pending?.catch(() => undefined)
      }
    })
  }
}
