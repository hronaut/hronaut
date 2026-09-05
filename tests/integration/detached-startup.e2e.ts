import { expect, test } from './fixtures.js'

test('starts detached Page tools without primary-window startup errors and preserves wallet isolation', async ({ appWindow, electronApp }, testInfo) => {
  await appWindow.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Detached startup target</title><script>console.log("Detached startup console evidence")</script>', active: true })`)
  await appWindow.evaluate("window.hronautPanelWindow.open('page-tools')")
  await expect.poll(() => electronApp.windows().some(page => page.url().includes('hronautPanel=page-tools'))).toBe(true)
  const panel = electronApp.windows().find(page => page.url().includes('hronautPanel=page-tools'))!
  await panel.waitForLoadState('domcontentloaded')
  await expect(panel.getByRole('dialog', { name: 'Page tools' })).toBeVisible()
  await panel.screenshot({ path: testInfo.outputPath('detached-page-tools.png') })
  await panel.getByRole('button', { name: 'Open Console' }).click()
  await expect(panel.getByRole('dialog', { name: 'Console' })).toBeVisible()
  await expect(panel.getByRole('dialog', { name: 'Console' })).toContainText('Detached startup console evidence')
  await expect(panel.getByText('Startup incomplete', { exact: true })).toHaveCount(0)
  await expect(panel.getByText(/Rejected IPC from/)).toHaveCount(0)

  await panel.screenshot({ path: testInfo.outputPath('detached-console.png') })
  const rejection = await panel.evaluate(`window.hronautWallets.status().then(() => 'unexpectedly allowed', error => error.message)`)
  expect(rejection).toContain('Rejected IPC from a non-primary renderer')
  const mainStatus = await appWindow.evaluate('window.hronautWallets.status()')
  expect(mainStatus).toHaveProperty('backend')
})
