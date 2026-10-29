import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'
import type { BrowserState } from '../../src/shared/types.js'

test('selects tabs with Ctrl and a click, moves them together by drag, pins them all from the tab menu and closes them with Ctrl+W', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Tab ${(request.url ?? '/').slice(1).toUpperCase()}</title><p>Page</p>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The fixture server has no port.')
  const origin = `http://127.0.0.1:${address.port}`
  const state = () => appWindow.evaluate('window.hronaut.getState()') as Promise<BrowserState>
  const order = async () => (await state()).tabs.filter((tab) => tab.url.startsWith(origin))
    .map((tab) => `${tab.url.slice(origin.length + 1)}${tab.pinned ? '*' : ''}${tab.active ? '!' : ''}`)
  const control = (name: string) => appWindow.getByRole('tab', { name: new RegExp(`^Tab ${name}`) })
  try {
    await electronApp.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (this: Electron.Menu) { (globalThis as { selectionMenu?: Electron.Menu }).selectionMenu = this }
    })
    for (const [index, name] of ['a', 'b', 'c', 'd'].entries()) {
      await appWindow.evaluate(`window.hronaut.newTab({ url: '${origin}/${name}', active: ${index === 0} })`)
    }
    for (const name of ['A', 'B', 'C', 'D']) await expect(control(name)).toBeVisible()
    await expect.poll(order).toEqual(['a!', 'b', 'c', 'd'])

    await control('B').click({ modifiers: ['Control'] })
    await expect.poll(order).toEqual(['a', 'b!', 'c', 'd'])
    await expect(control('A')).toHaveAttribute('aria-selected', 'true')
    await expect(control('B')).toHaveAttribute('aria-selected', 'true')
    await expect(control('C')).toHaveAttribute('aria-selected', 'false')

    // Dragging one selected tab past another takes the other selected tab along, in their order.
    const from = (await control('A').boundingBox())!
    await appWindow.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await appWindow.mouse.down()
    await appWindow.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 4 })
    // Pressing a tab can scroll the strip to it, so the target is measured once the drag has started, in the right half
    // of the tab where the strip still shows it.
    const to = (await control('C').boundingBox())!
    const strip = (await appWindow.locator('.tabs-strip').boundingBox())!
    const toX = Math.min(to.x + to.width * 0.75, strip.x + strip.width - 8)
    expect(toX).toBeGreaterThan(to.x + to.width / 2)
    await appWindow.mouse.move(toX, to.y + to.height / 2, { steps: 8 })
    await appWindow.mouse.up()
    await expect.poll(order).toEqual(['c', 'a', 'b!', 'd'])
    await expect(control('A')).toHaveAttribute('aria-selected', 'true')

    // The menu of a selected tab pins them all, keeping their order.
    await control('A').click({ button: 'right' })
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as { selectionMenu?: Electron.Menu }).selectionMenu?.items.map((item) => item.id).filter(Boolean)
    ))).toContain('pin-tabs')
    await electronApp.evaluate(() => {
      const item = (globalThis as { selectionMenu?: Electron.Menu }).selectionMenu!.getMenuItemById('pin-tabs')!
      ;(item.click as unknown as () => void)()
    })
    await expect.poll(order).toEqual(['a*', 'b*!', 'c', 'd'])

    // A plain click leaves one tab selected.
    await control('C').click()
    await expect.poll(order).toEqual(['a*', 'b*', 'c!', 'd'])
    await expect(control('A')).toHaveAttribute('aria-selected', 'false')

    // Shift with Enter on a focused tab selects from the tab clicked last, as Shift with a click does.
    await control('D').press('Shift+Enter')
    await expect.poll(order).toEqual(['a*', 'b*', 'c', 'd!'])
    await expect(control('C')).toHaveAttribute('aria-selected', 'true')
    await expect(control('D')).toHaveAttribute('aria-current', 'page')

    // Ctrl+W closes every selected tab, as in Chrome.
    await control('D').press('Control+w')
    await expect.poll(async () => (await order()).map((name) => name.replace(/[*!]/g, ''))).toEqual(['a', 'b'])
  } finally {
    await closeFixtureServer(server)
  }
})
