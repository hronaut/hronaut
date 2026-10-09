import { expect, test } from './capability-fixtures.js'

test('clears Debug report copy success while a later clipboard write is pending and after it fails', async ({ capabilities, appWindow, electronApp }) => {
  const { tabId, openPageTool } = capabilities
  await openPageTool('Create debug report')
  const panel = appWindow.getByRole('dialog', { name: 'Debug report', exact: true })
  await expect(panel.getByRole('button', { name: 'Copy report', exact: true })).toBeEnabled()
  await electronApp.evaluate(({ ipcMain, clipboard }) => {
    const control = { calls: 0, reject: undefined as ((error: Error) => void) | undefined }
    ;(globalThis as typeof globalThis & { __diagnosticClipboard?: typeof control }).__diagnosticClipboard = control
    ipcMain.removeHandler('browser:copy-text')
    ipcMain.handle('browser:copy-text', (_event, value: string) => {
      control.calls += 1
      if (control.calls === 1) { clipboard.writeText(value); return }
      return new Promise((_resolve, reject) => { control.reject = reject })
    })
  })
  try {
    const copyReport = panel.getByRole('button', { name: /^(Copy report|Copied)$/ })
    await copyReport.click()
    await expect(copyReport).toHaveText('Copied')
    const previous = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(JSON.parse(previous)).toMatchObject({ tabId, summary: { failedRequests: expect.any(Number) } })
    await copyReport.click()
    await expect.poll(() => electronApp.evaluate(() => Boolean((globalThis as typeof globalThis & {
      __diagnosticClipboard?: { reject?: (error: Error) => void }
    }).__diagnosticClipboard?.reject))).toBe(true)
    // Read immediately: waiting for the old success timer would hide the regression.
    expect(await copyReport.innerText()).toBe('Copy report')
    await electronApp.evaluate(() => (globalThis as typeof globalThis & {
      __diagnosticClipboard?: { reject?: (error: Error) => void }
    }).__diagnosticClipboard?.reject?.(new Error('Synthetic clipboard refusal')))
    await expect(appWindow.getByText('Synthetic clipboard refusal', { exact: false })).toBeVisible()
    await expect(copyReport).toHaveText('Copy report')
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(previous)
    await expect(panel).toContainText('failed requests')
  } finally {
    await electronApp.evaluate(({ ipcMain }) => {
      const mainGlobal = globalThis as typeof globalThis & {
        __diagnosticClipboard?: { reject?: (error: Error) => void }
      }
      mainGlobal.__diagnosticClipboard?.reject?.(new Error('Clipboard fixture cleanup'))
      delete mainGlobal.__diagnosticClipboard
      ipcMain.removeHandler('browser:copy-text')
    })
  }
})
