import { createServer } from 'node:http'
import { expect, test } from './fixtures.js'

test('cancels native page selections when the website navigates', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>Selection lifecycle ${request.url}</title><main>Select on ${request.url}</main>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Selection lifecycle fixture did not expose a port')
    const origin = `http://127.0.0.1:${address.port}`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${origin}/start`)}, active: true })`)
    await expect.poll(() => appWindow.evaluate(
      'window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)'
    )).toBe('Selection lifecycle /start')

    const navigateWebsite = async (path: string): Promise<void> => {
      await electronApp.evaluate(async ({ webContents }, destination) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(destination.origin))
        if (!page) throw new Error('Selection lifecycle fixture web contents was not found')
        await page.loadURL(`${destination.origin}${destination.path}`)
      }, { origin, path })
      await expect.poll(() => appWindow.evaluate(
        'window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)'
      )).toBe(`Selection lifecycle ${path}`)
    }

    const picker = appWindow.getByRole('button', { name: 'Select an element to copy for agent' })
    await picker.click()
    await expect(appWindow.getByRole('button', { name: 'Cancel element selection' })).toBeVisible()
    await navigateWebsite('/after-picker')
    await expect(picker).toBeVisible({ timeout: 4_000 })

    const areaCapture = appWindow.getByRole('button', { name: 'Capture an area to the clipboard' })
    await areaCapture.click()
    await expect(appWindow.getByRole('button', { name: 'Cancel area screenshot' })).toBeVisible()
    await navigateWebsite('/after-area-capture')
    await expect(areaCapture).toBeVisible({ timeout: 4_000 })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
