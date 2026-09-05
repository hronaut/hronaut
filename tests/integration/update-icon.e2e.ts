import { expect, test } from './fixtures.js'

test('keeps busy update indicators distinct and visible across themes', async ({ appWindow, electronApp }, testInfo) => {
  await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
  await appWindow.getByRole('button', { name: /Updates/ }).click()
  const panel = appWindow.getByRole('region', { name: 'Software update status' })
  for (const theme of ['cyberpunk', 'cyberpunk-turbo', 'light', 'dark']) {
    await appWindow.evaluate(theme => (window as unknown as { hronautSettings: { setTheme: (theme: string) => Promise<unknown> } }).hronautSettings.setTheme(theme), theme)
    for (const status of ['downloading', 'checking', 'installing'] as const) {
      await electronApp.evaluate(({ BrowserWindow }, status) => {
        BrowserWindow.getAllWindows()[0]!.webContents.send('updates:changed', {
          status, currentVersion: '1.11.54', availableVersion: '1.11.55', percent: 71
        })
      }, status)
      const icon = panel.locator('.update-status-card-icon.busy')
      await expect(icon).toBeVisible()
      if (theme === 'cyberpunk' && status === 'downloading') {
        await panel.screenshot({ path: testInfo.outputPath('cyberpunk-downloading.png') })
      }
      await expect.poll(() => icon.evaluate(element => {
        const ring = element.querySelector('.ui-spinner__ring') ?? element
        const style = getComputedStyle(ring)
        return new Set([style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor]).size
      }), `${theme} ${status}: spinner must have a visible arc, not a uniform circle`).toBeGreaterThan(1)
      await expect(panel.locator('.ui-spinner__ring')).toHaveCSS('border-left-color', await panel.evaluate(element => {
        const probe = element.querySelector('.ui-spinner')!
        return getComputedStyle(probe).color
      }))
      if (status === 'downloading') {
        await expect(panel.locator('.update-progress > span')).toHaveAttribute('style', /width: 71%/)
        await expect(appWindow.getByRole('button', { name: 'Check now', exact: true })).toBeDisabled()
      }
    }
    await panel.screenshot({ path: testInfo.outputPath(`${theme}-installing.png`) })
  }
})
