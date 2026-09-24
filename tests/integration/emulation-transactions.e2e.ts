import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

for (const failFirst of [false, true]) {
  test(failFirst ? 'finishes failed emulation rollback before a newer viewport update' : 'preserves overlapping agent and human emulation changes', async ({ capabilities, electronApp, appWindow }) => {
    const { client, tabId, fixtureUrl } = capabilities
    let pending: Promise<CallToolResult> | undefined
    await electronApp.evaluate(({ webContents }, input) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === input.url)
      if (!page) throw new Error('Emulation fixture page was not found')
      const target = page.debugger
      const original = target.sendCommand
      let intercept = true
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const state = { held: false, release, restore: () => { target.sendCommand = original } }
      ;(globalThis as typeof globalThis & { __hronautEmulationGate?: typeof state }).__hronautEmulationGate = state
      target.sendCommand = async function (...args) {
        if (intercept && args[0] === 'Emulation.setEmulatedMedia') {
          intercept = false
          state.held = true
          await gate
          if (input.failFirst) throw new Error('Injected emulation command failure')
        }
        return original.apply(this, args)
      }
    }, { url: fixtureUrl, failFirst })
    try {
      pending = client.callTool({ name: 'browser_emulate', arguments: { tabId, colorScheme: 'dark' } }) as Promise<CallToolResult>
      await expect.poll(() => electronApp.evaluate(() => (
        (globalThis as typeof globalThis & { __hronautEmulationGate?: { held: boolean } }).__hronautEmulationGate?.held
      ))).toBe(true)
      // Both IPC messages use the same sender: getState is a barrier after the
      // viewport handler has entered the debugger queue behind the held change.
      await appWindow.evaluate(`(async () => {
        window.__hronautPendingViewport = window.hronaut.setTabViewport(${JSON.stringify(tabId)}, {
          width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true, orientation: 'portrait'
        }).then(() => ({ ok: true }), error => ({ ok: false, error: String(error) }));
        await window.hronaut.getState();
      })()`)
      await electronApp.evaluate(() => {
        ;(globalThis as typeof globalThis & { __hronautEmulationGate?: { release: () => void } }).__hronautEmulationGate?.release()
      })
      const first = await pending
      if (failFirst) {
        expect(first.isError).toBe(true)
        expect(text(first)).toContain('Injected emulation command failure')
      } else {
        expect(first.isError, text(first)).not.toBe(true)
      }
      expect(await appWindow.evaluate('window.__hronautPendingViewport')).toEqual({ ok: true })
      const report = await client.callTool({ name: 'browser_emulate', arguments: { tabId } }) as CallToolResult
      expect(report.isError, text(report)).not.toBe(true)
      expect(JSON.parse(text(report))).toMatchObject({ colorScheme: failFirst ? 'auto' : 'dark', viewport: { width: 390, height: 844 } })
      const dimensions = await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: '({width: innerWidth, height: innerHeight})' } }) as CallToolResult
      expect(dimensions.isError, text(dimensions)).not.toBe(true)
      expect(JSON.parse(text(dimensions))).toMatchObject({ width: 390, height: 844 })
    } finally {
      await electronApp.evaluate(() => {
        const state = (globalThis as typeof globalThis & { __hronautEmulationGate?: { release: () => void; restore: () => void } }).__hronautEmulationGate
        state?.release()
        state?.restore()
        delete (globalThis as typeof globalThis & { __hronautEmulationGate?: unknown }).__hronautEmulationGate
      }).catch(() => undefined)
      await pending?.catch(() => undefined)
      await appWindow.evaluate('(async () => { await window.__hronautPendingViewport; delete window.__hronautPendingViewport })()').catch(() => undefined)
    }
  })
}
