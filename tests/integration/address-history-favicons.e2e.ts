import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import type { AddressSuggestionOverlayRequest } from '../../src/shared/address-suggestions.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('shows the latest history suggestions when requests arrive during popup startup', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate('window.hronaut.newTab({ active: true })')
  const address = appWindow.getByRole('combobox', { name: 'Address' })
  await address.fill('no-existing-matches')
  await expect(address).toHaveAttribute('aria-expanded', 'false')
  const request: AddressSuggestionOverlayRequest = {
    bounds: { x: 300, y: 100, width: 560, maxHeight: 440 },
    suggestions: [{ id: 'history:first', kind: 'history', title: 'First match', url: 'https://first.example/' }],
    selectedIndex: -1,
    theme: 'light',
    locale: 'en-US'
  }
  await appWindow.evaluate(`(() => {
    const initial = ${JSON.stringify(request)};
    window.hronautAddressOverlay.show(initial)
    window.hronautAddressOverlay.show({
      ...initial,
      suggestions: [{ id: 'history:latest', kind: 'history', title: 'Latest history match', url: 'https://latest.example/' }]
    })
  })()`)

  await expect.poll(() => electronApp.evaluate(async ({ BrowserWindow, webContents }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL().includes('address-overlay.html'))
    if (!contents || contents.isLoading()) return null
    const main = BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')
    const view = main?.contentView.children.find((child) => (
      (child as unknown as { webContents?: { id: number } }).webContents?.id === contents.id
    ))
    return {
      visible: view?.getVisible(),
      text: await contents.executeJavaScript("document.querySelector('[role=option]')?.textContent")
    }
  })).toMatchObject({ visible: true, text: expect.stringContaining('Latest history match') })
})

for (const format of ['svg', 'ico', 'data-svg', 'png'] as const) {
  test(`renders a website ${format} favicon as PNG and keeps it after iframe navigation`, async ({ appWindow, electronApp }) => {
    const png = await readFile(new URL('../../build/icons/24x24.png', import.meta.url))
    const icoHeader = Buffer.alloc(22)
    icoHeader.writeUInt16LE(1, 2)
    icoHeader.writeUInt16LE(1, 4)
    icoHeader[6] = 24
    icoHeader[7] = 24
    icoHeader.writeUInt16LE(1, 10)
    icoHeader.writeUInt16LE(32, 12)
    icoHeader.writeUInt32LE(png.length, 14)
    icoHeader.writeUInt32LE(22, 18)
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>'
    const icon = format === 'ico' ? Buffer.concat([icoHeader, png]) : format === 'png' ? png : Buffer.from(svg)
    const mimeType = format === 'ico' ? 'image/x-icon' : format === 'png' ? 'image/png' : 'image/svg+xml'
    const href = format === 'data-svg' ? `data:${mimeType};base64,${icon.toString('base64')}` : '/favicon'
    const server = createServer((request, response) => {
      if (request.url === '/favicon') {
        response.writeHead(200, { 'content-type': mimeType, 'content-length': icon.length })
        response.end(icon)
      } else {
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end(`<!doctype html><title>Website icon</title><link rel="icon" href="${href}"><main>Website icon</main><iframe></iframe>`)
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Favicon server is unavailable')
      const url = `http://127.0.0.1:${address.port}/page`
      await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
      const favicon = appWindow.locator('.tab.active .favicon-image')
      await expect(favicon).toHaveAttribute('src', /^data:image\/png;base64,/)
      const initialIcon = await favicon.getAttribute('src')
      await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
        if (!page) throw new Error('Favicon page is unavailable')
        await page.executeJavaScript(`new Promise(resolve => {
          const frame = document.querySelector('iframe');
          frame.onload = () => resolve(true);
          frame.src = '/child';
        })`)
      }, url)
      await expect(favicon).toHaveAttribute('src', initialIcon!)
    } finally {
      await closeFixtureServer(server)
    }
  })
}
