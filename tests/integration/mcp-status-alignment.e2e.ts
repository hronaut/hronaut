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
    const label = document.querySelector('.mcp-pause-label')!
    const icon = document.querySelector('.mcp-pause-button svg')!.getBoundingClientRect()
    return {
      status: textMiddle(document.querySelector('.mcp-pill')),
      statusLines: (() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('.mcp-pill-label')!); return range.getClientRects().length })(),
      pause: label.getClientRects().length ? textMiddle(label) : (icon.top + icon.bottom) / 2,
      controlsMiddle: (controls.top + controls.bottom) / 2,
      pillInside: pill.top >= controls.top - 0.5 && pill.bottom <= controls.bottom + 0.5
    }
  })
  const check = async (layout: string) => {
    // 2.41.0 drew "MCP ready" 4.5px below "Pause agents" in the top layout.
    const box = await measure()
    expect(Math.abs(box.status - box.pause), layout).toBeLessThanOrEqual(1)
    expect(Math.abs(box.status - box.controlsMiddle), layout).toBeLessThanOrEqual(1.5)
    expect(box.pillInside, layout).toBe(true)
    expect(box.statusLines, layout).toBe(1)
  }
  await expect(appWindow.locator('.mcp-pause-label')).toBeVisible()
  await check('top')
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('combobox', { name: 'Tab position' }).selectOption('left')
  await expect(appWindow.locator('.shell')).toHaveClass(/vertical-tabs-shell/)
  await appWindow.keyboard.press('Escape')
  // The rail's 280 px footer keeps the status on one line by showing Pause agents as its icon; a rail of 340 px or
  // more has room for its words again.
  const pause = appWindow.getByRole('button', { name: 'Pause agents' })
  await expect(pause).toBeVisible()
  await expect(appWindow.locator('.mcp-pause-label')).toBeHidden()
  await check('left, 280 px rail')
  const handle = appWindow.getByRole('separator', { name: 'Resize workspace panel', exact: true })
  await handle.focus()
  await handle.press('Shift+ArrowRight')
  await handle.press('Shift+ArrowRight')
  await expect(handle).toHaveAttribute('aria-valuenow', '376')
  await expect(appWindow.locator('.mcp-pause-label')).toBeVisible()
  await check('left, 376 px rail')
})
