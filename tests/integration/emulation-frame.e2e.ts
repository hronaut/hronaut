import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import type { EmulationFrameGeometry } from '../../src/shared/emulation-frame.js'
import { expect, test, text } from './capability-fixtures.js'

type Rect = { x: number; y: number; width: number; height: number }

test('frames a tab emulated smaller than its space, then rotates and returns it to the window size', async ({ capabilities, appWindow, electronApp }) => {
  const { tabId, fixtureUrl } = capabilities
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1400, 1000))
  const viewBounds = () => electronApp.evaluate(({ BrowserWindow, webContents }, url) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find(child => (
      child as unknown as { webContents?: { id: number } }
    ).webContents?.id === page?.id)
    return view?.getBounds() ?? null
  }, fixtureUrl) as Promise<Rect | null>
  const innerSize = () => electronApp.evaluate(({ webContents }, url) => (
    webContents.getAllWebContents().find(contents => contents.getURL() === url)!.executeJavaScript('[innerWidth, innerHeight]')
  ), fixtureUrl) as Promise<[number, number]>
  const frames = () => appWindow.evaluate(() => (window as unknown as { hronautEmulationFrame: { get(): Promise<EmulationFrameGeometry[]> } }).hronautEmulationFrame.get())
  const frameFor = async (width: number, height: number) => {
    await expect.poll(async () => (await frames())[0]?.viewport.width === width && (await frames())[0]?.viewport.height === height).toBe(true)
    return (await frames())[0]!
  }
  const centered = (frame: EmulationFrameGeometry, width: number, height: number): Rect => ({
    x: frame.area.x + Math.floor((frame.available.width - width) / 2), y: frame.area.y + Math.floor((frame.available.height - height) / 2), width, height
  })
  expect(await appWindow.evaluate(() => window.devicePixelRatio)).toBe(1)

  await appWindow.evaluate(async (tabId) => {
    await (window as unknown as { hronaut: HronautApi }).hronaut.setTabViewport(tabId, { width: 600, height: 360, deviceScaleFactor: 1, mobile: false, touch: false, orientation: 'landscape' })
  }, tabId)
  // The page keeps its emulated size, centered in the space it had.
  const frame = await frameFor(600, 360)
  expect(frame).toMatchObject({ tabId, viewport: { width: 600, height: 360 } })
  await expect.poll(viewBounds).toEqual(centered(frame, 600, 360))
  await expect.poll(innerSize).toEqual([600, 360])
  const bar = appWindow.getByRole('group', { name: 'Emulated viewport 600 × 360' })
  await expect(bar).toContainText('600 × 360 · Desktop')

  await bar.getByRole('button', { name: 'Rotate viewport' }).click()
  await expect.poll(innerSize).toEqual([360, 600])
  const rotatedFrame = await frameFor(360, 600)
  await expect.poll(viewBounds).toEqual(centered(rotatedFrame, 360, 600))
  const rotated = appWindow.getByRole('group', { name: 'Emulated viewport 360 × 600' })
  await expect(rotated).toContainText('360 × 600 · Desktop')

  // Without a viewport emulation the page fills the space again, and the frame goes away.
  await rotated.getByRole('button', { name: 'Use window size' }).click()
  const { width, height } = rotatedFrame.available
  await expect.poll(viewBounds).toEqual({ x: rotatedFrame.area.x, y: rotatedFrame.area.y, width, height })
  await expect.poll(innerSize).toEqual([width, height])
  await expect(appWindow.getByTestId('emulation-frame')).toHaveCount(0)
  expect(await frames()).toEqual([])
})

test('an agent removing a framed viewport gets the full size at once, also for a tab in the background', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId } = capabilities
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1400, 1000))
  const frames = () => appWindow.evaluate(() => (window as unknown as { hronautEmulationFrame: { get(): Promise<EmulationFrameGeometry[]> } }).hronautEmulationFrame.get())
  const resize = async (args: Record<string, unknown>) => {
    const result = await client.callTool({ name: 'browser_resize', arguments: { tabId, ...args } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as { width: number; height: number }
  }

  expect(await resize({ width: 600, height: 360 })).toMatchObject({ width: 600, height: 360 })
  await expect.poll(async () => (await frames()).length).toBe(1)
  const { available } = (await frames())[0]!
  // The page fills its space before the emulated viewport goes, so the page
  // never gets the small view as its real viewport and the result is final.
  expect(await resize({ reset: true })).toMatchObject(available)
  await expect.poll(frames).toEqual([])

  expect(await resize({ width: 600, height: 360 })).toMatchObject({ width: 600, height: 360 })
  await expect.poll(async () => (await frames()).length).toBe(1)
  await appWindow.evaluate(async () => { await (window as unknown as { hronaut: HronautApi }).hronaut.newTab() })
  await expect.poll(frames).toEqual([])
  // In the background, the page still gets the space it would have in front.
  expect(await resize({ reset: true })).toMatchObject(available)
})

test('a tab whose viewport Hronaut cannot confirm fills its space until the viewport is restored', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1400, 1000))
  const call = (method: string, ...args: unknown[]) => appWindow.evaluate(`window.hronaut.${method}(${[tabId, ...args].map(arg => JSON.stringify(arg)).join(', ')})`)
  const viewBounds = () => electronApp.evaluate(({ BrowserWindow, webContents }, url) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find(child => (
      child as unknown as { webContents?: { id: number } }
    ).webContents?.id === page?.id)
    return view?.getBounds() ?? null
  }, fixtureUrl) as Promise<Rect | null>
  const frames = () => appWindow.evaluate(() => (window as unknown as { hronautEmulationFrame: { get(): Promise<EmulationFrameGeometry[]> } }).hronautEmulationFrame.get())

  await call('setTabViewport', { width: 600, height: 360, deviceScaleFactor: 1, mobile: false, touch: false, orientation: 'landscape' })
  await expect.poll(async () => (await frames()).length).toBe(1)
  const { area } = (await frames())[0]!
  // Opening DevTools detaches Hronaut's debugger, so the page may have lost its viewport.
  expect(await call('toggleDevTools')).toBe(true)
  await expect.poll(frames).toEqual([])
  await expect.poll(viewBounds).toEqual(area)
  expect(await call('toggleDevTools')).toBe(false)
  // Request conditions recover separately before the viewport can be restored.
  const cleared = await client.callTool({ name: 'browser_network_routes', arguments: { action: 'clear', tabId } }) as CallToolResult
  expect(cleared.isError, text(cleared)).not.toBe(true)
  await call('recoverTabEmulation')
  await expect.poll(async () => (await frames())[0]?.viewport.width).toBe(600)
  await expect.poll(async () => (await viewBounds())?.width).toBe(600)
})
