import type { ElectronApplication } from '@playwright/test'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

type TooltipView = { visible: boolean; topmost: boolean; bounds: Electron.Rectangle; text: string | null; theme: string | null }

/** The native view that draws shell tooltips, as main shows it. */
async function tooltipView(electronApp: ElectronApplication): Promise<TooltipView | null> {
  return electronApp.evaluate(async ({ BrowserWindow }) => {
    const children = BrowserWindow.getAllWindows()[0]!.contentView.children
    const view = children.find((child) => (
      'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().endsWith('tooltip-overlay.html')
    )) as Electron.WebContentsView | undefined
    if (!view) return null
    const [text, theme] = await view.webContents.executeJavaScript(
      `[document.querySelector('[role=tooltip]')?.textContent ?? null, document.documentElement.dataset.theme ?? null]`
    ) as [string | null, string | null]
    return { visible: view.getVisible(), topmost: children.at(-1) === view, bounds: view.getBounds(), text, theme }
  })
}

test('shows a themed tooltip above the page for a toolbar button instead of a native title', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(async () => {
    const api = (window as unknown as { hronaut: HronautApi }).hronaut
    await api.newTab({ url: 'data:text/html,<title>Tooltip fixture</title><body style="margin:0;background:%231d6f42">', active: true })
  })
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Tooltip fixture')
  const page = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children
    .filter((child) => 'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().startsWith('data:'))
    .map((child) => child.getBounds())[0])
  expect(page).toBeDefined()

  const commands = appWindow.getByRole('button', { name: 'Open command palette' })
  // The shortcut that the native title carried stays in the tooltip and the accessible description.
  await expect(commands).not.toHaveAttribute('title')
  await expect(commands).toHaveAttribute('data-tooltip', 'Commands (Ctrl/Cmd+Shift+P)')
  await expect(commands).toHaveAccessibleDescription('Commands (Ctrl/Cmd+Shift+P)')

  await appWindow.evaluate('window.hronautSettings.setTheme("light")')
  await commands.hover()
  await expect.poll(async () => (await tooltipView(electronApp))?.visible ?? false).toBe(true)
  const shown = (await tooltipView(electronApp))!
  expect(shown).toMatchObject({ topmost: true, text: 'Commands (Ctrl/Cmd+Shift+P)', theme: 'light' })
  // Below the button and over the page, where a tooltip in the shell's own page could never be seen.
  // At the default interface scale, shell CSS pixels are window coordinates.
  const button = (await commands.boundingBox())!
  expect(shown.bounds.y).toBeGreaterThanOrEqual(Math.floor(button.y + button.height))
  expect(shown.bounds.y + shown.bounds.height).toBeGreaterThan(page!.y)
  expect(shown.bounds.width).toBeGreaterThan(40)
  expect(shown.bounds.height).toBeLessThan(60)

  // Leaving the button hides it; another control shows its own text in the current theme at once.
  await appWindow.evaluate('window.hronautSettings.setTheme("dark")')
  await appWindow.mouse.move(button.x + button.width / 2, button.y + button.height + 200)
  await expect.poll(async () => (await tooltipView(electronApp))?.visible).toBe(false)
  await appWindow.getByRole('button', { name: 'Search tabs', exact: true }).hover()
  await expect.poll(async () => {
    const view = await tooltipView(electronApp)
    return view?.visible ? [view.text, view.theme] : null
  }).toEqual(['Search tabs (Ctrl/Cmd+Shift+A)', 'dark'])

  // A click hides it and keeps it away while the pointer stays on the control.
  await appWindow.getByRole('button', { name: 'Search tabs', exact: true }).click()
  await expect.poll(async () => (await tooltipView(electronApp))?.visible).toBe(false)
  await appWindow.keyboard.press('Escape')
})
