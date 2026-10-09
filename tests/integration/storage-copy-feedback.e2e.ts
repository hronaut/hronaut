import { expect, test } from './capability-fixtures.js'

test('clears Site Storage copy success while a later clipboard write is pending and after it fails', async ({ capabilities, appWindow, electronApp }) => {
  const { tabId, openPageTool } = capabilities
  await openPageTool('Site storage for 127.0.0.1')
  const panel = appWindow.getByRole('dialog', { name: /Site storage/ })
  await panel.getByRole('button', { name: 'Overview', exact: true }).click()
  await expect(panel).toContainText('Chromium quota detail')
  await electronApp.evaluate(({ ipcMain, clipboard }) => {
    const control = { calls: 0, reject: undefined as ((error: Error) => void) | undefined }
    ;(globalThis as typeof globalThis & { __storageClipboard?: typeof control }).__storageClipboard = control
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
    expect(JSON.parse(previous)).toMatchObject({ tabId, source: 'chromium-quota' })
    await copyReport.click()
    await expect.poll(() => electronApp.evaluate(() => Boolean((globalThis as typeof globalThis & {
      __storageClipboard?: { reject?: (error: Error) => void }
    }).__storageClipboard?.reject))).toBe(true)
    // Read immediately: waiting for the old success timer would hide the regression.
    expect(await copyReport.innerText()).toBe('Copy report')
    await electronApp.evaluate(() => (globalThis as typeof globalThis & {
      __storageClipboard?: { reject?: (error: Error) => void }
    }).__storageClipboard?.reject?.(new Error('Synthetic clipboard refusal')))
    await expect(appWindow.getByText('Synthetic clipboard refusal', { exact: false })).toBeVisible()
    await expect(copyReport).toHaveText('Copy report')
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(previous)
    await expect(panel).toContainText('Chromium quota detail')
  } finally {
    await electronApp.evaluate(({ ipcMain }) => {
      const mainGlobal = globalThis as typeof globalThis & {
        __storageClipboard?: { reject?: (error: Error) => void }
      }
      mainGlobal.__storageClipboard?.reject?.(new Error('Clipboard fixture cleanup'))
      delete mainGlobal.__storageClipboard
      ipcMain.removeHandler('browser:copy-text')
    })
  }
})
