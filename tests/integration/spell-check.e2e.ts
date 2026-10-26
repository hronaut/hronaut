import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { closeFixtureServer, expect, test } from './fixtures.js'

const exec = promisify(execFile)

type MenuItemState = { id: string; label: string; checked: boolean }

// Websites' text fields always checked spelling, with no switch to turn it off as Chrome's Spell check has. Settings →
// General and a text field's menu now turn it off and on for every website.

test('turns spell checking off from a text field menu and back on in Settings, for every website', async ({ appWindow, electronApp, profileDirectory }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Spell check fixture</title><textarea id="note" rows="4" cols="40">Ths note has a tset</textarea>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/compose`
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect(appWindow.getByRole('tab', { name: /Spell check fixture/ })).toBeVisible()
    // The sessions of the website and of Home, which belong to different workspaces.
    const checking = (): Promise<{ page?: boolean; home?: boolean }> => electronApp.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents()
      return {
        page: contents.find(candidate => candidate.getURL() === url)?.session.isSpellCheckerEnabled(),
        home: contents.find(candidate => candidate.getURL().startsWith('hronaut://home'))?.session.isSpellCheckerEnabled()
      }
    }, url)
    expect(await checking()).toEqual({ page: true, home: true })

    await electronApp.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = this
      }
    })
    // A real right-click on the screen, at the text field.
    const point = await electronApp.evaluate(async ({ BrowserWindow, WebContentsView }, url) => {
      ;(globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu = undefined
      const window = BrowserWindow.getAllWindows()[0]!
      const view = window.contentView.children
        .find((child): child is InstanceType<typeof WebContentsView> => child instanceof WebContentsView && child.webContents.getURL() === url)
      if (!view) throw new Error('Spell check fixture view was not found')
      const center = await view.webContents.executeJavaScript(`(() => {
        const bounds = document.querySelector('#note').getBoundingClientRect()
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      })()`) as { x: number; y: number }
      const origin = window.getContentBounds()
      const bounds = view.getBounds()
      return { x: Math.round(origin.x + bounds.x + center.x), y: Math.round(origin.y + bounds.y + center.y) }
    }, url)
    await exec('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), String(point.x), String(point.y), '--right-click'])
    const menuIds = (): Promise<string[]> => electronApp.evaluate(() => (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu })
      .__hronautContextMenu?.items.filter(item => item.type !== 'separator').map(item => item.id) ?? [])
    await expect.poll(menuIds).toContain('select-all')
    const spellCheck = (): Promise<{ label?: string; items: MenuItemState[] }> => electronApp.evaluate(() => {
      const item = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu?.getMenuItemById('spell-check')
      return { label: item?.label, items: item?.submenu?.items.map(entry => ({ id: entry.id, label: entry.label, checked: entry.checked })) ?? [] }
    })
    expect(await spellCheck()).toEqual({
      label: 'Spell check',
      items: [{ id: 'check-spelling', label: 'Check the spelling of text fields', checked: true }]
    })

    // Choosing the item flips its checkbox, as the menu does when it is clicked.
    await electronApp.evaluate(() => {
      const item = (globalThis as typeof globalThis & { __hronautContextMenu?: Electron.Menu }).__hronautContextMenu!.getMenuItemById('check-spelling')!
      ;(item.click as unknown as () => void)()
    })
    await expect.poll(checking).toEqual({ page: false, home: false })
    await expect.poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).spellCheck).toBe(false)

    // The shell heard of the change, so Settings shows it, and its switch turns checking back on everywhere.
    await appWindow.getByRole('button', { name: 'Settings' }).click()
    await appWindow.locator('.settings-nav-item').nth(0).click()
    const setting = appWindow.getByRole('checkbox', { name: /^Spell check/ })
    await expect(setting).not.toBeChecked()
    await setting.check()
    await expect.poll(checking).toEqual({ page: true, home: true })
    await expect.poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).spellCheck).toBe(true)
  } finally {
    await closeFixtureServer(server)
  }
})
