import type { ElectronApplication } from '@playwright/test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { test, expect, text } from './capability-fixtures.js'

const NEVER_SETTLES = '(window.__evaluating = (window.__evaluating ?? 0) + 1, new Promise(() => {}))'

async function windowFocus(electronApp: ElectronApplication): Promise<{ focusable: boolean; focused: boolean }> {
  return electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    return { focusable: window.isFocusable(), focused: window.isFocused() }
  })
}

// A script whose promise never settles used to hold its workspace's writer,
// the window's background focus guard and the tab's debugger indefinitely,
// even after the client cancelled the call.
test('a script that never finishes stops at its deadline and frees the workspace and window', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.blur())
  await expect.poll(() => windowFocus(electronApp)).toEqual({ focusable: true, focused: false })

  for (const dialogAction of [undefined, 'dismiss'] as const) {
    const started = Date.now()
    const stopped = await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: NEVER_SETTLES, timeoutMs: 1_000, ...(dialogAction ? { dialogAction } : {}) } }) as CallToolResult
    expect(stopped.isError, text(stopped)).toBe(true)
    expect(stopped.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', reason: 'SCRIPT_TIMEOUT', retrySafe: false, timeoutMs: 1_000 })
    expect(Date.now() - started).toBeLessThan(10_000)
    await expect.poll(() => windowFocus(electronApp)).toEqual({ focusable: true, focused: false })
    // The next evaluation through the same debugger is admitted and answered.
    const next = await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: 'window.__evaluating', dialogAction: 'dismiss' } }) as CallToolResult
    expect(next.isError, text(next)).not.toBe(true)
    expect(text(next)).toBe(dialogAction ? '2' : '1')
  }
})

test('cancelling a script that never finishes frees the workspace', async ({ capabilities }) => {
  const { client, tabId } = capabilities
  const abort = new AbortController()
  const pending = client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: NEVER_SETTLES } }, undefined, { signal: abort.signal }).catch(() => undefined)
  await expect.poll(async () => text(await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult)).toBeTruthy()
  await expect.poll(async () => {
    const probe = await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: 'window.__evaluating ?? 0' } }) as CallToolResult
    return probe.structuredContent?.reason ?? text(probe)
  }).toBe('WORKSPACE_BUSY')
  abort.abort()
  await pending
  await expect.poll(async () => {
    const after = await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: 'window.__evaluating' } }) as CallToolResult
    return after.isError ? (after.structuredContent?.reason ?? text(after)) : text(after)
  }, { timeout: 10_000 }).toBe('1')
})
