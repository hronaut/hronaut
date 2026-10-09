import { createHash } from 'node:crypto'
import { expect, test } from './capability-fixtures.js'

test('clears Visual Compare copy success while another image copy is pending or refused', async ({ capabilities, appWindow, electronApp }) => {
  await capabilities.openPageTool(/Visual compare:/)
  const panel = appWindow.getByRole('dialog', { name: 'Visual compare', exact: true })
  await panel.getByRole('button', { name: 'Set baseline', exact: true }).click()
  await panel.getByRole('button', { name: 'Compare now', exact: true }).click()
  const copy = panel.getByRole('button', { name: /^(Copy diff PNG|Copied)$/ })
  await expect(copy).toBeVisible()
  const source = await panel.locator('.visual-compare-image').getAttribute('src')
  const clipboardHash = async () => createHash('sha256').update(await electronApp.evaluate(async ({ clipboard }) => {
    const item = (await clipboard.read()).find(item => item.types.includes('image/png'))
    if (!item) throw new Error('Expected the real comparison PNG on the clipboard')
    const blob = await item.getType('image/png') as Blob
    return Buffer.from(await blob.arrayBuffer()).toString('base64')
  }), 'base64').digest('hex')
  await copy.click()
  await expect(copy).toHaveText('Copied')
  const previous = await clipboardHash()
  await electronApp.evaluate(({ ipcMain }) => {
    const control = { reject: undefined as ((error: Error) => void) | undefined }
    const target = globalThis as unknown as { visualClipboardControl?: typeof control }
    target.visualClipboardControl = control
    ipcMain.removeHandler('browser:copy-visual-diff')
    ipcMain.handle('browser:copy-visual-diff', () => new Promise((_resolve, reject) => { control.reject = reject }))
  })
  try {
    expect(await copy.innerText()).toBe('Copied')
    await copy.click()
    await expect.poll(() => electronApp.evaluate(() => Boolean((globalThis as unknown as {
      visualClipboardControl?: { reject?: (error: Error) => void }
    }).visualClipboardControl?.reject))).toBe(true)
    // Read before the old success timer can expire and hide the regression.
    expect(await copy.innerText()).toBe('Copy diff PNG')
    await electronApp.evaluate(() => (globalThis as unknown as {
      visualClipboardControl?: { reject?: (error: Error) => void }
    }).visualClipboardControl?.reject?.(new Error('Synthetic image clipboard refusal')))
    await expect(panel.getByRole('alert')).toContainText('Synthetic image clipboard refusal')
    expect(await clipboardHash()).toBe(previous)
    await panel.getByRole('button', { name: 'Return to baseline', exact: true }).click()
    await expect(copy).toHaveText('Copy diff PNG')
    await expect(panel.locator('.visual-compare-image')).toHaveAttribute('src', source!)
  } finally {
    await electronApp.evaluate(({ ipcMain }) => {
      const target = globalThis as unknown as { visualClipboardControl?: { reject?: (error: Error) => void } }
      target.visualClipboardControl?.reject?.(new Error('Clipboard fixture cleanup'))
      delete target.visualClipboardControl
      ipcMain.removeHandler('browser:copy-visual-diff')
    })
  }
})
