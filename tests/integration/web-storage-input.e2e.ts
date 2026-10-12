import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

type InputGateGlobal = typeof globalThis & { __webStorageInputGate?: { calls: number; restore(): void } }

for (const kind of ['local-storage', 'session-storage'] as const) {
  test(`Web storage ${kind} preserves bounded pre-execution validation feedback`, async ({ capabilities, electronApp, appWindow }) => {
    const { client, tabId, fixtureUrl } = capabilities
    const canary = 'synthetic-storage-input-canary'
    await electronApp.evaluate(({ webContents }, fixtureUrl) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!
      const execute = page.executeJavaScript
      const gate = { calls: 0, restore: () => { page.executeJavaScript = execute } }
      ;(globalThis as InputGateGlobal).__webStorageInputGate = gate
      page.executeJavaScript = async function (...args) {
        if (args[0].includes('const storage = window[')) gate.calls++
        return execute.apply(this, args)
      }
    }, fixtureUrl)
    try {
      const invalidInputs = [
        ...(['get', 'set', 'delete'] as const).map(action => ({ args: { action, value: canary }, reason: 'KEY_REQUIRED', message: 'key is required' })),
        { args: { action: 'set', key: canary }, reason: 'VALUE_REQUIRED', message: 'value is required' },
        { args: { action: 'set', key: canary, value: canary + '🙂'.repeat(65_536) }, reason: 'VALUE_TOO_LARGE', message: '256 KiB' }
      ]
      for (const { args, reason, message } of invalidInputs) {
        const result = await client.callTool({ name: 'browser_storage', arguments: { tabId, kind, ...args } }) as CallToolResult
        expect(result.isError).toBe(true)
        expect(result.structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', reason, effects: 'none', executionSubmitted: false, executionAcknowledged: false, retrySafe: false })
        expect(text(result)).toContain(message)
        expect(JSON.stringify(result)).not.toContain(canary)
      }
      // MCP's schema already bounds key length; exercise the manager's matching
      // bound through the trusted UI bridge without passing the oversize key back.
      const keyError = await appWindow.evaluate(async ({ tabId, kind, canary }) => {
        try {
          await (window as unknown as { hronaut: HronautApi }).hronaut.manageStorage({ tabId, kind, action: 'get', key: canary.repeat(30) })
          return 'unexpected success'
        } catch (error) { return String(error) }
      }, { tabId, kind, canary })
      expect(keyError).toContain('Storage keys are limited to 512 characters')
      expect(keyError).not.toContain(canary)
      await electronApp.evaluate(async ({ webContents }, fixtureUrl) => {
        await webContents.getAllWebContents().find(p => p.getURL() === fixtureUrl)!.loadURL('data:text/html,storage input validation')
      }, fixtureUrl)
      const scheme = await client.callTool({ name: 'browser_storage', arguments: { tabId, kind, action: 'get', key: canary } }) as CallToolResult
      expect(scheme.isError).toBe(true)
      expect(scheme.structuredContent).toMatchObject({ status: 'NOT_DISPATCHED', reason: 'UNSUPPORTED_SCHEME', effects: 'none', executionSubmitted: false })
      expect(text(scheme)).toContain('HTTP and HTTPS')
      expect(JSON.stringify(scheme)).not.toContain(canary)
      expect(await electronApp.evaluate(() => (globalThis as InputGateGlobal).__webStorageInputGate!.calls)).toBe(0)
    } finally {
      await electronApp.evaluate(() => {
        const scope = globalThis as InputGateGlobal
        scope.__webStorageInputGate?.restore()
        delete scope.__webStorageInputGate
      }).catch(() => undefined)
    }
  })
}
