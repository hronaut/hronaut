import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('vertically centres the MCP status and pause labels in both tab layouts', async ({ appWindow, electronApp }) => {
  await electronApp.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]!; window.setPosition(0, 0); window.setSize(1440, 960) })
  await appWindow.evaluate(async () => {
    await (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url: 'data:text/html,<title>Status alignment</title>', active: true })
  })
  const measure = () => appWindow.evaluate(() => {
    const textMiddle = (element: Element | null): number => {
      const walker = document.createTreeWalker(element!, NodeFilter.SHOW_TEXT)
      let node: Node | null, text: Node | null = null
      while ((node = walker.nextNode())) if (node.textContent?.trim()) text = node
      const range = document.createRange()
      range.selectNodeContents(text!)
      const rect = range.getBoundingClientRect()
      return (rect.top + rect.bottom) / 2
    }
    const controls = document.querySelector('.mcp-controls')!.getBoundingClientRect()
    const pill = document.querySelector('.mcp-pill')!.getBoundingClientRect()
    return {
      status: textMiddle(document.querySelector('.mcp-pill')),
      pause: textMiddle(document.querySelector('.mcp-pause-label')),
      controlsMiddle: (controls.top + controls.bottom) / 2,
      pillInside: pill.top >= controls.top - 0.5 && pill.bottom <= controls.bottom + 0.5
    }
  })
  for (const layout of ['top', 'left']) {
    if (layout === 'left') {
      await appWindow.getByRole('button', { name: 'Settings' }).click()
      await appWindow.getByRole('combobox', { name: 'Tab position' }).selectOption('left')
      await expect(appWindow.locator('.shell')).toHaveClass(/vertical-tabs-shell/)
      await appWindow.keyboard.press('Escape')
    }
    await expect(appWindow.locator('.mcp-pause-label')).toBeVisible()
    // 2.41.0 drew "MCP ready" 4.5px below "Pause agents" in the top layout.
    const box = await measure()
    expect(Math.abs(box.status - box.pause), layout).toBeLessThanOrEqual(1)
    expect(Math.abs(box.status - box.controlsMiddle), layout).toBeLessThanOrEqual(1.5)
    expect(box.pillInside, layout).toBe(true)
  }
})
