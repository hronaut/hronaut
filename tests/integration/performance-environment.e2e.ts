import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('compares identical performance environments after settings are reapplied in another order', async ({ capabilities }) => {
  const { client, tabId } = capabilities
  const call = async (name: string, options: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: { tabId, ...options } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  await call('browser_emulate', { viewportPreset: 'phone' })
  await call('browser_emulate', { locale: 'en-US' })
  await call('browser_performance', { action: 'set-baseline', settleMs: 0 })
  await call('browser_emulate', { reset: true })
  await call('browser_emulate', { locale: 'en-US', viewportPreset: 'phone' })
  const same = await call('browser_performance', { settleMs: 0 })
  expect(same.comparison.sameEnvironment).toBe(true)
  expect(same.caveats).not.toContain('The browser environment differs from the baseline; viewport, throttling, cache, headers, or locale changes can affect the delta.')
  await call('browser_emulate', { locale: 'fr-CA' })
  const changed = await call('browser_performance', { settleMs: 0 })
  expect(changed.comparison.sameEnvironment).toBe(false)
})
