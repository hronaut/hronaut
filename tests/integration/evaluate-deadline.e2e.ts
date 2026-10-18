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

/** Reads the page directly, outside any MCP call and its dialog handling. */
async function inPage(electronApp: ElectronApplication, url: string, expression: string): Promise<unknown> {
  return electronApp.evaluate(({ webContents }, { url, expression }) => (
    webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript(expression)
  ), { url, expression })
}

// A script whose promise never settles used to hold its workspace's writer,
// the window's background focus guard and the tab's debugger indefinitely,
// even after the client cancelled the call.
test('a script that never finishes stops at its deadline and frees the workspace and window', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const stopsAtDeadline = async (args: Record<string, unknown>): Promise<void> => {
    const started = Date.now()
    const stopped = await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: NEVER_SETTLES, timeoutMs: 1_000, ...args } }) as CallToolResult
    expect(stopped.isError, text(stopped)).toBe(true)
    expect(stopped.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', reason: 'SCRIPT_TIMEOUT', retrySafe: false, timeoutMs: 1_000 })
    expect(Date.now() - started).toBeLessThan(10_000)
  }

  // In the foreground the script runs directly in the page.
  await expect.poll(() => windowFocus(electronApp)).toEqual({ focusable: true, focused: true })
  await stopsAtDeadline({})
  expect(await inPage(electronApp, fixtureUrl, 'window.__evaluating')).toBe(1)

  // In the background it runs through the debugger, answering the page's dialogs.
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.blur())
  await expect.poll(() => windowFocus(electronApp)).toEqual({ focusable: true, focused: false })
  await stopsAtDeadline({ dialogAction: 'accept' })
  await expect.poll(() => windowFocus(electronApp)).toEqual({ focusable: true, focused: false })
  // The page's own confirm comes back although the stopped script still runs.
  await expect.poll(() => inPage(electronApp, fixtureUrl, 'String(window.confirm).includes("[native code]")')).toBe(true)
  // The next evaluation through the same debugger is admitted and answered.
  const next = await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: 'window.__evaluating', dialogAction: 'dismiss' } }) as CallToolResult
  expect(next.isError, text(next)).not.toBe(true)
  expect(text(next)).toBe('2')
})

test('cancelling a script that never finishes frees the workspace', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const abort = new AbortController()
  const pending = client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: NEVER_SETTLES } }, undefined, { signal: abort.signal }).catch(() => undefined)
  await expect.poll(() => inPage(electronApp, fixtureUrl, 'window.__evaluating ?? 0')).toBe(1)
  const busy = await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: 'window.__evaluating' } }) as CallToolResult
  expect(busy.structuredContent, text(busy)).toMatchObject({ reason: 'WORKSPACE_BUSY' })
  abort.abort()
  await pending
  await expect.poll(async () => {
    const after = await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: 'window.__evaluating' } }) as CallToolResult
    return after.isError ? (after.structuredContent?.reason ?? text(after)) : text(after)
  }, { timeout: 10_000 }).toBe('1')
})
