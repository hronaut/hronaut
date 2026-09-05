import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

for (const position of ['top', 'left']) {
  test(`distinguishes tab selection, closing and dragging cursors with tabs on the ${position}`, async ({ appWindow }) => {
    await appWindow.evaluate(`window.hronautSettings.setTabPosition('${position}')`)
    const id = await appWindow.evaluate(async () => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      return (await api.newTab({ url: 'data:text/html,<title>Cursor fixture</title>', active: true })).activeTabId!
    })
    const tab = appWindow.locator(`[data-tab-id="${id}"]`)
    const close = tab.locator('.tab-close')
    await tab.hover()
    await expect.poll(() => tab.evaluate(element => ({
      tab: getComputedStyle(element).cursor,
      close: getComputedStyle(element.querySelector('.tab-close')!).cursor
    }))).toEqual({ tab: 'default', close: 'pointer' })
    await close.hover()
    await expect(close).toHaveCSS('cursor', 'pointer')

    await tab.hover()
    await appWindow.mouse.down()
    await expect(tab).toHaveCSS('cursor', 'default')
    await appWindow.mouse.up()
    await tab.dispatchEvent('dragstart')
    await expect(tab).toHaveCSS('cursor', 'grabbing')
    await tab.dispatchEvent('dragend')
    await expect(tab).toHaveCSS('cursor', 'default')

    await appWindow.evaluate(async () => {
      await (window as unknown as { hronaut: HronautApi }).hronaut.setAllHumanInteractionLocked(true)
    })
    await expect(close).toHaveCSS('cursor', 'not-allowed')
    await close.click()
    await expect(tab).toBeVisible()
    await appWindow.evaluate(async () => {
      await (window as unknown as { hronaut: HronautApi }).hronaut.setAllHumanInteractionLocked(false)
    })
    await expect(close).toHaveCSS('cursor', 'pointer')
    await close.click()
    await expect(tab).toBeHidden()
  })
}
