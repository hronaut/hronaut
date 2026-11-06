import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'
const exec = promisify(execFile)

type TestWindow = { hronaut: HronautApi }

// Pressing the split divider gave it the keyboard, so after a drag or a double-click the arrow keys, Home, End and
// Enter the person typed for the page resized the split instead. In Chrome the page keeps the keyboard.
test('the page in view has the keyboard again after a drag or a double-click on the split divider', async ({ appWindow, electronApp }) => {
  const page = (name: string) => `data:text/html,<title>Keys ${name}</title><body style=height:100vh;margin:0>${name}</body>`
  const alpha: BrowserState = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(page('Alpha'))}, active: true })`)
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(page('Beta'))}, active: true })`)
  await appWindow.evaluate(`window.hronaut.openSplitView(${JSON.stringify(alpha.activeTabId)})`)
  await appWindow.evaluate(async () => {
    const api = (window as unknown as TestWindow).hronaut
    const state = await api.getState()
    await api.setAllHumanInteractionLocked(false)
    for (const tab of state.tabs) await api.setTabHumanInteractionLocked(tab.id, false)
  })
  // Real focus, so the press gives Hronaut's window the keyboard as a person's press does.
  const session = await appWindow.context().newCDPSession(appWindow)
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: false })
  const activeTitle = async () => {
    const state = await appWindow.evaluate(() => (window as unknown as TestWindow).hronaut.getState())
    return state.tabs.find(tab => tab.id === state.activeTabId)!.title
  }
  const title = await activeTitle()
  await electronApp.evaluate(async ({ webContents }) => {
    for (const contents of webContents.getAllWebContents().filter(candidate => /^Keys /.test(candidate.getTitle()))) {
      await contents.executeJavaScript("document.body.dataset.keys = ''; addEventListener('keydown', event => { document.body.dataset.keys += event.key + ' ' })")
    }
  })
  const focusedTitle = () => electronApp.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getTitle())
  const pageKeys = () => electronApp.evaluate(({ webContents }, title) => webContents.getAllWebContents()
    .find(candidate => candidate.getTitle() === title)!.executeJavaScript('document.body.dataset.keys') as Promise<string>, title)
  const ratio = () => appWindow.evaluate(async () => (await (window as unknown as TestWindow).hronaut.getState()).splitView?.ratio)

  const divider = appWindow.getByRole('separator', { name: 'Resize split view', exact: true })
  await expect(divider).toBeVisible()
  const origin = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds())
  const point = async () => {
    const rect = (await divider.boundingBox())!
    return { x: origin.x + Math.round(rect.x + rect.width / 2), y: origin.y + Math.round(rect.y + rect.height / 2) }
  }
  const physical = (action: string, at: { x: number, y: number }) => exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(at.x), String(at.y), action])

  const start = await point()
  await physical(`--drag-to=${start.x + 120},${start.y}`, start)
  await expect.poll(ratio).not.toBe(0.5)
  const dragged = await ratio()
  await expect.poll(focusedTitle).toBe(title)
  await physical('--shortcut=Right', start)
  await expect.poll(pageKeys).toBe('ArrowRight ')
  expect(await ratio()).toBe(dragged)

  // A double-click puts the split back halfway, and the page keeps the keyboard then too.
  const middle = await point()
  await physical('--click', middle)
  await physical('--click', middle)
  await expect.poll(ratio).toBe(0.5)
  await expect.poll(focusedTitle).toBe(title)
  await physical('--shortcut=End', middle)
  await expect.poll(pageKeys).toBe('ArrowRight End ')
  expect(await ratio()).toBe(0.5)

  // The divider given the keyboard, as with Tab, takes the arrow keys; once the person clicks into the page, it lets the
  // keyboard go, so a later drag leaves the keyboard with the page again.
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.focus())
  await divider.focus()
  await physical('--shortcut=Right', middle)
  await expect.poll(ratio).toBe(0.51)
  await electronApp.evaluate(({ webContents }, title) => webContents.getAllWebContents().find(candidate => candidate.getTitle() === title)!.focus(), title)
  await expect.poll(focusedTitle).toBe(title)
  const last = await point()
  await physical(`--drag-to=${last.x - 120},${last.y}`, last)
  await expect.poll(ratio).not.toBe(0.51)
  const draggedBack = await ratio()
  await expect.poll(focusedTitle).toBe(title)
  await physical('--shortcut=Home', last)
  await expect.poll(pageKeys).toBe('ArrowRight End Home ')
  expect(await ratio()).toBe(draggedBack)
})
