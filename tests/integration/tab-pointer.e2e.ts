import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

for (const position of ['top', 'left']) {
  test(`distinguishes tab selection, closing and dragging cursors with tabs on the ${position}`, async ({ appWindow }) => {
    await appWindow.evaluate(`window.hronautSettings.setTabPosition('${position}')`)
    const targetId = await appWindow.evaluate(async () => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      return (await api.newTab({ url: 'data:text/html,<title>Drop target</title>', active: true })).activeTabId!
    })
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

    const target = appWindow.locator(`[data-tab-id="${targetId}"]`)
    const order = () => appWindow.evaluate(async (ids) => {
      const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
      return state.tabs.filter(tab => ids.includes(tab.id)).map(tab => tab.id)
    }, [id, targetId])
    await expect.poll(order).toEqual([targetId, id])
    const sourceBounds = (await tab.boundingBox())!
    const targetBounds = (await target.boundingBox())!
    const start = { x: sourceBounds.x + sourceBounds.width / 2, y: sourceBounds.y + sourceBounds.height / 2 }
    const destination = {
      x: targetBounds.x + (position === 'top' ? 3 : targetBounds.width / 2),
      y: targetBounds.y + (position === 'left' ? 3 : targetBounds.height / 2)
    }
    await appWindow.mouse.move(start.x, start.y)
    await appWindow.mouse.down()
    try {
      // A normal press and movement below the native drag threshold keep the selection cursor.
      await appWindow.mouse.move(start.x + 1, start.y + 1)
      await expect(tab).not.toHaveClass(/\bdragging\b/)
      await expect(tab).toHaveCSS('cursor', 'default')
      await appWindow.mouse.move(start.x - 12, start.y - 12)
      await appWindow.mouse.move(destination.x, destination.y, { steps: 5 })
      await appWindow.mouse.move(destination.x, destination.y)
      await expect(tab).toHaveClass(/\bdragging\b/)
      await expect(tab).toHaveCSS('cursor', 'grabbing')
      await expect(target).toHaveClass(/\bdrop-before\b/)
    } finally {
      await appWindow.mouse.up()
    }
    await expect.poll(order).toEqual([id, targetId])
    await expect(tab).not.toHaveClass(/\bdragging\b/)
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
