import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ElectronApplication } from '@playwright/test'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

const exec = promisify(execFile)
const PAGE_COLOR = [0x1d, 0x6f, 0x42] as const

type TooltipView = { visible: boolean; topmost: boolean; bounds: Electron.Rectangle; text: string | null; theme: string | null }

/** The native view that draws shell tooltips, while main has it in the window. */
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

test('shows a themed tooltip over the page for a toolbar button instead of a native title', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(async () => {
    const api = (window as unknown as { hronaut: HronautApi }).hronaut
    await api.newTab({ url: 'data:text/html,<title>Tooltip fixture</title><body style="margin:0;background:%231d6f42">', active: true })
  })
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Tooltip fixture')
  const page = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children
    .filter((child) => 'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().startsWith('data:'))
    .map((child) => child.getBounds())[0])
  expect(page).toBeDefined()

  // The toolbar row sits right above the page, so the tooltip below its button reaches over the page.
  const find = appWindow.getByRole('button', { name: 'Find in page', exact: true })
  // The shortcut that the native title carried stays in the tooltip and the accessible description.
  await expect(find).not.toHaveAttribute('title')
  await expect(find).toHaveAttribute('data-tooltip', 'Find in page (Ctrl/Cmd+F)')
  await expect(find).toHaveAccessibleDescription('Find in page (Ctrl/Cmd+F)')

  await appWindow.evaluate('window.hronautSettings.setTheme("light")')
  await find.hover()
  await expect.poll(async () => (await tooltipView(electronApp))?.visible ?? false).toBe(true)
  const shown = (await tooltipView(electronApp))!
  expect(shown).toMatchObject({ topmost: true, text: 'Find in page (Ctrl/Cmd+F)', theme: 'light' })
  // Below the button and over the page, where a tooltip in the shell's own page could never be seen.
  // At the default interface scale, shell CSS pixels are window coordinates.
  const button = (await find.boundingBox())!
  expect(shown.bounds.y).toBeGreaterThanOrEqual(Math.floor(button.y + button.height))
  expect(shown.bounds.y + shown.bounds.height).toBeGreaterThan(page!.y)
  expect(shown.bounds.width).toBeGreaterThan(40)
  expect(shown.bounds.height).toBeLessThan(60)

  // Leaving the button hides it; another control shows its own text in the current theme at once.
  await appWindow.evaluate('window.hronautSettings.setTheme("dark")')
  await appWindow.mouse.move(button.x + button.width / 2, button.y + button.height + 200)
  // A hidden tooltip leaves the window's native views as they were, with nothing unseen above the page.
  await expect.poll(() => tooltipView(electronApp)).toBeNull()
  await appWindow.getByRole('button', { name: 'Search tabs', exact: true }).hover()
  await expect.poll(async () => {
    const view = await tooltipView(electronApp)
    return view?.visible ? [view.text, view.theme] : null
  }).toEqual(['Search tabs (Ctrl/Cmd+Shift+A)', 'dark'])

  // A click hides it and keeps it away while the pointer stays on the control.
  await appWindow.getByRole('button', { name: 'Search tabs', exact: true }).click()
  await expect.poll(() => tooltipView(electronApp)).toBeNull()
  await appWindow.keyboard.press('Escape')
})

/** Share of the real screen's pixels in a box, in window coordinates, that show the fixture page's color. */
async function pageColorShare(electronApp: ElectronApplication, box: Electron.Rectangle): Promise<number> {
  return electronApp.evaluate(async ({ BrowserWindow, desktopCapturer, screen }, { box, color: [pageRed, pageGreen, pageBlue] }) => {
    const host = BrowserWindow.getAllWindows()[0]!.getContentBounds()
    const display = screen.getDisplayMatching(host)
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: display.size })
    const image = sources.find((source) => source.display_id === String(display.id))!.thumbnail
    const crop = image.crop({ x: host.x + box.x - display.bounds.x, y: host.y + box.y - display.bounds.y, width: box.width, height: box.height })
    const bitmap = crop.toBitmap()
    let matching = 0
    for (let index = 0; index < bitmap.length; index += 4) {
      const [blue, green, red] = [bitmap[index]!, bitmap[index + 1]!, bitmap[index + 2]!]
      if (Math.abs(red - pageRed) <= 10 && Math.abs(green - pageGreen) <= 10 && Math.abs(blue - pageBlue) <= 10) matching += 1
    }
    return matching / Math.max(1, bitmap.length / 4)
  }, { box, color: PAGE_COLOR })
}

test('draws the tooltip on screen over the page for the real pointer, and leaves the page its input', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(async () => {
    const api = (window as unknown as { hronaut: HronautApi }).hronaut
    await api.newTab({
      url: 'data:text/html,<title>Native tooltip fixture</title><body style="margin:0;height:100vh;background:%231d6f42" onclick="document.title=\'Clicked\'">',
      active: true
    })
  })
  const activeTitle = (): Promise<unknown> => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')
  await expect.poll(activeTitle).toBe('Native tooltip fixture')
  await appWindow.evaluate('window.hronautSettings.setTheme("light")')
  const page = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children
    .filter((child) => 'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().startsWith('data:'))
    .map((child) => child.getBounds())[0]!)
  const button = (await appWindow.getByRole('button', { name: 'Find in page', exact: true }).boundingBox())!
  const origin = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds())
  const pointer = (x: number, y: number, action: '--move' | '--click' = '--move') => exec('python3', [
    join(process.cwd(), 'tests/integration/x11-input.py'), String(Math.round(origin.x + x)), String(Math.round(origin.y + y)), action
  ])
  const onButton = () => pointer(button.x + button.width / 2, button.y + button.height / 2)
  const onPage = () => pointer(button.x + button.width / 2, page.y + 240)

  let overPage: Electron.Rectangle | undefined
  // The second time, main adds the view to the window again; it must still be drawn.
  for (let round = 0; round < 2; round += 1) {
    await onButton()
    await expect.poll(async () => (await tooltipView(electronApp))?.visible ?? false).toBe(true)
    const { bounds } = (await tooltipView(electronApp))!
    // The tooltip's own box, inside its shadow room, where it reaches over the page.
    const top = Math.max(bounds.y + 4, page.y) + 2
    overPage = { x: bounds.x + 8, y: top, width: bounds.width - 16, height: bounds.y + bounds.height - 6 - top }
    expect(overPage.height).toBeGreaterThan(4)
    await expect.poll(() => pageColorShare(electronApp, overPage!)).toBeLessThan(0.2)

    await onPage()
    await expect.poll(() => tooltipView(electronApp)).toBeNull()
    await expect.poll(() => pageColorShare(electronApp, overPage!)).toBeGreaterThan(0.95)
  }

  // A key press in the page hides the tooltip, as it hides a native one.
  await onButton()
  await expect.poll(async () => (await tooltipView(electronApp))?.visible ?? false).toBe(true)
  await electronApp.evaluate(({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0]!.contentView.children
      .find((child) => 'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().startsWith('data:')) as Electron.WebContentsView
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A' })
    view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A' })
  })
  await expect.poll(() => tooltipView(electronApp)).toBeNull()

  // Where the tooltip was, a real click reaches the page.
  await pointer(overPage!.x + overPage!.width / 2, overPage!.y + overPage!.height / 2, '--click')
  await expect.poll(activeTitle).toBe('Clicked')
})
