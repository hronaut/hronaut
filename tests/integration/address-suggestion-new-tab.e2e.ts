import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'
import type { HronautApi, HronautBookmarksApi } from '../../src/shared/types.js'

type TestWindow = Window & { hronaut: HronautApi; hronautBookmarks: HronautBookmarksApi }

// A middle-click on a row of the address bar's suggestions did nothing; in Chrome it opens the row in a new tab behind
// and the address bar keeps the keyboard. The clicks are real mouse input sent to the suggestions view.
test('a middle-click on an address suggestion opens it in a new tab behind and keeps the field, as in Chrome', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Saved ${request.url}</title><p>${request.url}</p>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address()
  if (!port || typeof port === 'string') throw new Error('Missing fixture port')
  const saved = `http://127.0.0.1:${port.port}/saved`
  try {
    await appWindow.evaluate(async url => (window as unknown as TestWindow).hronautBookmarks.add(url, 'Saved page'), saved)
    const sourceTabId = await appWindow.evaluate(async () => {
      await (window as unknown as TestWindow).hronaut.newTab({ active: true })
      return (await (window as unknown as TestWindow).hronaut.getState()).activeTabId
    })
    const tabs = async () => (await appWindow.evaluate(async () => (await (window as unknown as TestWindow).hronaut.getState()).tabs))
      .map(tab => ({ id: tab.id, url: tab.url, active: tab.active }))
    const address = appWindow.getByRole('combobox', { name: 'Address' })
    // Clicks the row in the suggestions view with real mouse input, as a person does, once the view shows this search's
    // rows: the rows of an earlier search stay in the hidden view's page until it shows new ones.
    const clickRow = async (button: 'left' | 'middle', modifiers: Array<'control' | 'shift' | 'meta'> = []) => {
      await electronApp.evaluate(async ({ webContents }) => {
        const overlay = webContents.getAllWebContents().find(contents => contents.getURL().includes('address-overlay.html'))
        await overlay?.executeJavaScript("window.__earlierRow = document.querySelector('[role=option]')")
      })
      await address.fill('')
      await address.fill('Saved page')
      await expect(address).toHaveAttribute('aria-expanded', 'true')
      await expect.poll(() => electronApp.evaluate(async ({ BrowserWindow, webContents }) => {
        const overlay = webContents.getAllWebContents().find(contents => contents.getURL().includes('address-overlay.html'))
        const main = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Hronaut')
        const shown = main?.contentView.children.some(child => (
          (child as unknown as { webContents?: { id: number } }).webContents?.id === overlay?.id && child.getVisible()
        ))
        const row = await overlay?.executeJavaScript("(() => { const row = document.querySelector('[role=option]'); return row && row !== window.__earlierRow ? row.getAttribute('data-suggestion-id') : null })()") as string | null | undefined
        return shown ? row ?? null : null
      })).toMatch(/^bookmark:/)
      await electronApp.evaluate(async ({ webContents }, click) => {
        const overlay = webContents.getAllWebContents().find(contents => contents.getURL().includes('address-overlay.html'))!
        const box = await overlay.executeJavaScript("(() => { const r = document.querySelector('[role=option]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()") as { x: number; y: number }
        const at = { x: Math.round(box.x), y: Math.round(box.y), button: click.button, clickCount: 1, modifiers: click.modifiers }
        // A person's press gives the view the keyboard; input sent to it does not.
        overlay.focus()
        overlay.sendInputEvent({ type: 'mouseDown', ...at })
        overlay.sendInputEvent({ type: 'mouseUp', ...at })
      }, { button, modifiers })
    }

    const shellFocused = () => electronApp.evaluate(({ BrowserWindow, webContents }) => {
      const main = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'Hronaut')
      return webContents.getFocusedWebContents()?.id === main?.webContents.id
    })

    await clickRow('middle', ['shift'])
    await expect.poll(async () => (await tabs()).filter(tab => tab.url === saved)).toEqual([expect.objectContaining({ active: false })])
    expect((await tabs()).find(tab => tab.id === sourceTabId)).toMatchObject({ url: 'about:blank', active: true })
    // The field has the keyboard again, with the typed text and its suggestions.
    await expect.poll(shellFocused).toBe(true)
    await expect(address).toBeFocused()
    await expect(address).toHaveValue('Saved page')
    await expect(address).toHaveAttribute('aria-expanded', 'true')

    // Chrome opens a row in the tab for a click with Ctrl or ⌘ held, as for a plain one.
    await clickRow('left', [process.platform === 'darwin' ? 'meta' : 'control'])
    await expect.poll(async () => (await tabs()).find(tab => tab.id === sourceTabId)?.url).toBe(saved)
    expect((await tabs()).filter(tab => tab.url === saved)).toHaveLength(2)
  } finally {
    await closeFixtureServer(server)
  }
})
