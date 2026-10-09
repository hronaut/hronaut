import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('clears Console copy success while a later clipboard write is pending and after it fails', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId, openPageTool } = capabilities
  const result = await client.callTool({ name: 'browser_evaluate', arguments: {
    tabId, script: "console.warn('clipboard-feedback-fixture'); true"
  } }) as CallToolResult
  expect(result.isError, text(result)).not.toBe(true)
  await openPageTool('Open Console')
  const panel = appWindow.getByRole('dialog', { name: 'Console', exact: true })
  await panel.getByRole('searchbox', { name: 'Filter Console messages', exact: true }).fill('clipboard-feedback-fixture')
  await expect(panel.locator('.console-message')).toHaveCount(1)
  await electronApp.evaluate(({ ipcMain, clipboard }) => {
    const control = { calls: 0, reject: undefined as ((error: Error) => void) | undefined }
    ;(globalThis as typeof globalThis & { __consoleClipboard?: typeof control }).__consoleClipboard = control
    ipcMain.removeHandler('browser:copy-text')
    ipcMain.handle('browser:copy-text', (_event, value: string) => {
      control.calls += 1
      if (control.calls === 1) { clipboard.writeText(value); return }
      return new Promise((_resolve, reject) => { control.reject = reject })
    })
  })
  try {
    const copyAll = panel.getByRole('button', { name: /^(Copy|Copied) all$/ })
    await copyAll.click()
    await expect(copyAll).toHaveText('Copied all')
    const previous = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(JSON.parse(previous).messages.some((entry: { message: string }) => entry.message === 'clipboard-feedback-fixture')).toBe(true)
    await copyAll.click()
    await expect.poll(() => electronApp.evaluate(() => Boolean((globalThis as typeof globalThis & {
      __consoleClipboard?: { reject?: (error: Error) => void }
    }).__consoleClipboard?.reject))).toBe(true)
    // Read immediately: waiting for the old success timer would hide the regression.
    expect(await copyAll.innerText()).toBe('Copy all')
    await electronApp.evaluate(() => (globalThis as typeof globalThis & {
      __consoleClipboard?: { reject?: (error: Error) => void }
    }).__consoleClipboard?.reject?.(new Error('Synthetic clipboard refusal')))
    await expect(appWindow.getByText('Synthetic clipboard refusal', { exact: false })).toBeVisible()
    await expect(copyAll).toHaveText('Copy all')
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(previous)
    await expect(panel.locator('.console-message')).toHaveCount(1)
  } finally {
    await electronApp.evaluate(({ ipcMain }) => {
      const mainGlobal = globalThis as typeof globalThis & {
        __consoleClipboard?: { reject?: (error: Error) => void }
      }
      mainGlobal.__consoleClipboard?.reject?.(new Error('Clipboard fixture cleanup'))
      delete mainGlobal.__consoleClipboard
      ipcMain.removeHandler('browser:copy-text')
    })
  }
})
