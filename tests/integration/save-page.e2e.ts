import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer } from './fixtures.js'
import { expect, test, text } from './capability-fixtures.js'

type SaveDialog = { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }

test('Ctrl+S, View → Save Page As… and Save As… in the page context menu save the page where the person chooses, as in Chrome', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId } = capabilities
  const primary = process.platform === 'darwin' ? 'meta' as const : 'control' as const
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
  const server = createServer((request, response) => {
    if (request.url === '/pixel.png') {
      response.writeHead(200, { 'content-type': 'image/png' })
      response.end(pixel)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    // Every page notes the keys it gets; /keeps handles Ctrl+S itself, as a web editor saves its document with it.
    const keeps = request.url === '/keeps'
    response.end(`<!doctype html><title>Release notes: 3.5</title><p>hronaut-save-marker</p><img src="/pixel.png"><script>window.keys = []; addEventListener('keydown', (event) => {
      window.keys.push(event.key)
      if (${keeps} && (event.ctrlKey || event.metaKey) && event.key === 's') event.preventDefault()
    })</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  const folder = mkdtempSync(join(tmpdir(), 'hronaut-save-page-e2e-'))
  try {
    const visit = async (to: string) => {
      await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(origin + to)}, tabId: ${JSON.stringify(tabId)} })`)
      await expect.poll(() => electronApp.evaluate(({ webContents }, address) => (
        webContents.getAllWebContents().some(candidate => candidate.getURL() === address && !candidate.isLoading())
      ), origin + to)).toBe(true)
    }
    // The system dialog is out of reach here: note what it is asked, and answer with the next name, or cancel.
    await electronApp.evaluate(({ dialog }) => {
      const state = globalThis as typeof globalThis & { __saveDialogs?: SaveDialog[], __saveAnswers?: string[] }
      state.__saveDialogs = []
      state.__saveAnswers = []
      dialog.showSaveDialog = (async (_window: unknown, options: SaveDialog) => {
        state.__saveDialogs!.push({ title: options.title, defaultPath: options.defaultPath, filters: options.filters })
        const filePath = state.__saveAnswers!.shift()
        return filePath ? { canceled: false, filePath } : { canceled: true, filePath: '' }
      }) as typeof dialog.showSaveDialog
    })
    const dialogs = () => electronApp.evaluate(() => (globalThis as typeof globalThis & { __saveDialogs?: SaveDialog[] }).__saveDialogs!.length)
    const answer = (filePath?: string) => electronApp.evaluate((_electron, filePath) => {
      (globalThis as typeof globalThis & { __saveAnswers?: string[] }).__saveAnswers!.push(filePath ?? '')
    }, filePath)
    const keys = (script = 'window.keys.slice()') => electronApp.evaluate(({ webContents }, { origin, script }) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(`${origin}/`))
      if (!contents) throw new Error('Page web contents was not found')
      return contents.executeJavaScript(script) as Promise<string[]>
    }, { origin, script })
    // The person's key, sent to the page or to Hronaut's own window as the keyboard sends it.
    const press = (where: 'page' | 'shell') => electronApp.evaluate(({ webContents }, { origin, shellUrl, where, primary }) => {
      const contents = webContents.getAllWebContents()
        .find(candidate => where === 'page' ? candidate.getURL().startsWith(`${origin}/`) : candidate.getURL() === shellUrl)
      if (!contents) throw new Error(`No ${where} web contents`)
      if (where === 'page') contents.focus()
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: [primary] })
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: [primary] })
    }, { origin, shellUrl: appWindow.url(), where, primary })

    await visit('/page')
    const complete = join(folder, 'notes.html')
    await answer(complete)
    await press('page')
    // The page as it is, with the image it shows in a folder beside it.
    await expect.poll(() => existsSync(complete) && readFileSync(complete, 'utf8').includes('hronaut-save-marker')).toBe(true)
    const asked = await electronApp.evaluate(() => (globalThis as typeof globalThis & { __saveDialogs?: SaveDialog[] }).__saveDialogs![0]!)
    expect(asked.title).toBe('Save Page As')
    expect(asked.defaultPath?.endsWith('Release notes- 3.5.html')).toBe(true)
    expect(asked.filters?.map(filter => filter.name)).toEqual(['Webpage, Complete', 'Webpage, Single File'])
    await expect.poll(() => existsSync(join(folder, 'notes_files')) && readdirSync(join(folder, 'notes_files'))).toEqual(['pixel.png'])

    // From View → Save Page As…, as one MHTML file.
    const single = join(folder, 'notes.mhtml')
    await answer(single)
    await electronApp.evaluate(({ BrowserWindow, Menu }) => {
      const item = Menu.getApplicationMenu()?.items.find(candidate => candidate.label === 'View')
        ?.submenu?.items.find(candidate => candidate.label === 'Save Page As…')
      if (!item?.click) throw new Error('Missing View → Save Page As…')
      item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
    })
    await expect.poll(() => existsSync(single) && readFileSync(single, 'utf8').includes('multipart/related')).toBe(true)

    // And Save As… in the page's context menu; Cancel saves nothing.
    await answer()
    await electronApp.evaluate(async ({ Menu, webContents }, origin) => {
      const popup = Menu.prototype.popup
      let menu: Electron.Menu | undefined
      Menu.prototype.popup = function (): void { menu = this }
      try {
        const page = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(`${origin}/`))
        if (!page) throw new Error('Page web contents was not found')
        page.focus()
        page.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, x: 20, y: 20 })
        page.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, x: 20, y: 20 })
        for (let waited = 0; !menu && waited < 5_000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50))
      } finally {
        Menu.prototype.popup = popup
      }
      const item = menu?.getMenuItemById('save-page')
      if (!item?.click) throw new Error('Missing Save As in the page\'s context menu')
      ;(item.click as unknown as () => void)()
    }, origin)
    await expect.poll(dialogs).toBe(3)
    expect(readdirSync(folder).sort()).toEqual(['notes.html', 'notes.mhtml', 'notes_files'])

    // A key an agent sends stays with the page.
    await keys('window.keys = []')
    const pressed = await client.callTool({ name: 'browser_press', arguments: { tabId, key: process.platform === 'darwin' ? 'Meta+s' : 'Control+s' } }) as CallToolResult
    expect(pressed.isError, text(pressed)).not.toBe(true)
    await expect.poll(() => keys()).toContain('s')
    await appWindow.waitForTimeout(500)
    expect(await dialogs()).toBe(3)
    // A website that handles the key itself keeps it.
    await visit('/keeps')
    await press('page')
    await expect.poll(() => keys()).toContain('s')
    await appWindow.waitForTimeout(500)
    expect(await dialogs()).toBe(3)
    // Nor does it open behind a Hronaut dialog.
    await appWindow.keyboard.press('ControlOrMeta+Shift+P')
    const palette = appWindow.getByRole('dialog', { name: 'Commands' })
    await expect(palette).toBeVisible()
    await press('shell')
    await appWindow.waitForTimeout(500)
    expect(await dialogs()).toBe(3)
    await appWindow.keyboard.press('Escape')
    await expect(palette).toBeHidden()
  } finally {
    await closeFixtureServer(server)
    rmSync(folder, { recursive: true, force: true })
  }
})
