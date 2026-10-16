import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('keeps tab toggles as named icon buttons so the toolbar fits one row at 1440 px', async ({ appWindow, electronApp }) => {
  await electronApp.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]!; window.setPosition(0, 0); window.setSize(1440, 960) })
  await appWindow.evaluate(async () => {
    const api = (window as unknown as { hronaut: HronautApi }).hronaut
    await api.newTab({ url: 'data:text/html,<title>Toolbar fixture</title><main>Toolbar fixture</main>', active: true })
  })
  const toolbar = appWindow.locator('.toolbar')
  const pageTools = appWindow.locator('.page-tools-button')
  await expect(pageTools).toBeVisible()
  const controls = appWindow.getByRole('group', { name: 'Tab controls' }).getByRole('button')
  await expect(controls).toHaveCount(4)
  for (const button of await controls.all()) {
    await expect(button).toHaveText('')
    await expect(button).toHaveAttribute('data-tooltip', /\S/)
    await expect(button).toHaveAttribute('aria-pressed', /true|false/)
    const box = (await button.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(32)
    expect(box.height).toBeGreaterThanOrEqual(32)
  }
  // 2.40.0 wrapped Page tools onto a second toolbar row at this size.
  const address = (await appWindow.locator('.address-form').boundingBox())!
  const tools = (await pageTools.boundingBox())!
  expect(Math.abs((tools.y + tools.height / 2) - (address.y + address.height / 2))).toBeLessThan(4)
  expect((await toolbar.boundingBox())!.height).toBeLessThan(70)
  expect(address.width).toBeGreaterThanOrEqual(300)
  // Every command remains reachable by its existing name.
  for (const name of ['Lock page input in this tab', 'Pause agents for this tab', 'Freeze this live page for deterministic review', 'Mute Tab', 'Page tools']) {
    await expect(appWindow.getByRole('button', { name, exact: true })).toBeVisible()
  }
})
