import { expect, test } from './fixtures.js'

for (const dock of ['right', 'bottom'] as const) {
  test(`saves the ${dock} dock size from the native release position`, async ({ appWindow, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1200, 800))
    await expect.poll(() => appWindow.evaluate('({ width: innerWidth, height: innerHeight })')).toEqual({ width: 1200, height: 800 })
    await appWindow.getByRole('button', { name: 'New tab' }).click()
    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Page tools' })
    await panel.getByRole('combobox', { name: 'Dock page tools' }).selectOption(dock)
    const handle = appWindow.getByRole('separator', { name: 'Resize docked panel' })
    const horizontal = dock === 'right'
    const key = `hronaut:panel-dock-size-${horizontal ? 'horizontal' : 'vertical'}`
    const initial = horizontal ? 480 : 360
    await expect(handle).toHaveAttribute('aria-valuenow', String(initial))
    await expect(handle).toHaveAttribute('aria-orientation', horizontal ? 'vertical' : 'horizontal')
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }, horizontal) => {
      const bounds = BrowserWindow.getAllWindows()[0]!.contentView.children[0]!.getBounds()
      return horizontal ? bounds.width : bounds.height
    }, horizontal)).toBe(horizontal ? 1200 - initial : 800 - 105 - initial)
    const bounds = (await handle.boundingBox())!
    const x = Math.round(bounds.x + (horizontal ? bounds.width / 2 : 140))
    const y = Math.round(bounds.y + (horizontal ? 140 : bounds.height / 2))
    await appWindow.mouse.move(x, y)
    await appWindow.mouse.down()
    await expect(handle).toHaveClass(/active/)
    // Shrink into the panel so the gesture stays on trusted chrome rather than
    // crossing the native page view while its bounds are being updated.
    await appWindow.mouse.move(x + (horizontal ? 40 : 0), y + (horizontal ? 0 : 40))
    await expect(handle).toHaveAttribute('aria-valuenow', String(initial - 40))
    await expect(handle).toHaveClass(/active/)
    expect(await appWindow.evaluate(key => localStorage.getItem(key), key)).toBeNull()
    await handle.evaluate(element => element.addEventListener('pointerup', event => {
      const pointer = event as PointerEvent
      element.setAttribute('data-test-release', `${pointer.clientX},${pointer.clientY}`)
    }, { once: true }))
    const release = { x: x + (horizontal ? 80 : 0), y: y + (horizontal ? 0 : 80) }
    // Native release at a new coordinate, without a preceding move to mask the bug.
    await electronApp.evaluate(({ BrowserWindow }, position) => {
      BrowserWindow.getAllWindows()[0]!.webContents.sendInputEvent({
        type: 'mouseUp', button: 'left', clickCount: 1, ...position
      })
    }, release)
    await expect(handle).toHaveAttribute('data-test-release', `${release.x},${release.y}`)
    await expect(handle).toHaveAttribute('aria-valuenow', String(initial - 80))
    await expect(handle).not.toHaveClass(/active/)
    await expect.poll(() => appWindow.evaluate(key => localStorage.getItem(key), key)).toBe(String(initial - 80))
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }, horizontal) => {
      const bounds = BrowserWindow.getAllWindows()[0]!.contentView.children[0]!.getBounds()
      return horizontal ? bounds.width : bounds.height
    }, horizontal)).toBe(horizontal ? 1200 - initial + 80 : 800 - 105 - initial + 80)
    await panel.getByRole('button', { name: 'Close page tools' }).click()
    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    await expect(handle).toHaveAttribute('aria-valuenow', String(initial - 80))
  })
}
