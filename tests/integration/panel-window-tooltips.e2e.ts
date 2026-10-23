import { expect, test } from './fixtures.js'

// A panel in its own window showed the operating system's tooltips, from native titles, instead of the themed ones.
test('shows the themed tooltip beside a control in a panel opened in its own window', async ({ appWindow, electronApp }) => {
  await appWindow.getByRole('button', { name: 'New tab' }).click()
  await appWindow.evaluate("window.hronautPanelWindow.open('console')")
  // The new tab's page is a window to Playwright too, so find the panel's by its address.
  await expect.poll(() => electronApp.windows().some((page) => page.url().includes('hronautPanel=console'))).toBe(true)
  const panel = electronApp.windows().find((page) => page.url().includes('hronautPanel=console'))!
  const toggle = panel.locator('.preserve-logs-toggle')
  await expect(toggle).toBeVisible()
  const text = await toggle.getAttribute('data-tooltip')
  expect(text).toBeTruthy()

  await toggle.hover()
  const tooltip = panel.locator('.shell-window-tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip).toHaveText(text!)
  await expect(tooltip).toHaveAttribute('aria-hidden', 'true')
  await expect(toggle).not.toHaveAttribute('title')
  // Beside the control, never over it, and inside the window.
  const [drawn, control, size] = await Promise.all([
    tooltip.boundingBox(),
    toggle.boundingBox(),
    panel.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  ])
  expect(drawn && control).toBeTruthy()
  const apart = drawn!.y >= control!.y + control!.height || drawn!.y + drawn!.height <= control!.y
    || drawn!.x >= control!.x + control!.width || drawn!.x + drawn!.width <= control!.x
  expect(apart).toBe(true)
  expect(drawn!.x).toBeGreaterThanOrEqual(0)
  expect(drawn!.y).toBeGreaterThanOrEqual(0)
  expect(drawn!.x + drawn!.width).toBeLessThanOrEqual(size.width)
  expect(drawn!.y + drawn!.height).toBeLessThanOrEqual(size.height)
  // In the panel's theme, not the system's colors.
  const colors = await tooltip.evaluate((element) => {
    const style = getComputedStyle(element)
    const probe = document.createElement('div')
    probe.style.background = 'var(--surface-raised)'
    document.body.append(probe)
    const expected = getComputedStyle(probe).backgroundColor
    probe.remove()
    return { background: style.backgroundColor, expected }
  })
  expect(colors.background).toBe(colors.expected)

  await toggle.dispatchEvent('pointerdown')
  await expect(tooltip).toHaveCount(0)
})
