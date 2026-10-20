import { createServer } from 'node:http'
import type { ElectronApplication } from '@playwright/test'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

/** A key event as the keyboard sends it to whichever page has the focus, which is where a held key's repeats go. */
async function sendToFocusedPage(electronApp: ElectronApplication, type: 'keyDown' | 'keyUp', repeat = false): Promise<string> {
  return electronApp.evaluate(({ webContents }, { type, repeat }) => {
    const focused = webContents.getFocusedWebContents()
    if (!focused) return ''
    focused.sendInputEvent({ type, keyCode: 'Delete', ...(repeat ? { modifiers: ['isautorepeat' as const] } : {}) })
    return focused.getURL()
  }, { type, repeat })
}

test('a key held on the shell does not repeat into the page it hands the focus to', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(request.url === '/field'
      ? '<title>Held key field</title><input aria-label="Field" value="abcdef" autofocus onfocus="this.setSelectionRange(0,0)"><script>window.keys=[];addEventListener("keydown",e=>keys.push(e.key+(e.repeat?" repeat":"")),true)</script>'
      : '<title>Held key closed</title><p>Closed by Delete</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const fieldUrl = `http://127.0.0.1:${address.port}/field`
  const activeTitle = () => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    .then(state => state.tabs.find(tab => tab.active)?.title))
  const inPage = (expression: string) => electronApp.evaluate(({ webContents }, { url, expression }) => (
    webContents.getAllWebContents().find(contents => contents.getURL() === url)!.executeJavaScript(expression)
  ), { url: fieldUrl, expression })
  const pageKeys = () => inPage('window.keys') as Promise<string[]>
  const fieldValue = () => inPage('document.querySelector("input").value') as Promise<string>
  try {
    for (const [path, title] of [['field', 'Held key field'], ['closed', 'Held key closed']]) {
      await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), `http://127.0.0.1:${address.port}/${path}`)
      await expect.poll(activeTitle).toBe(title)
    }

    // Delete on the active tab closes it, and the tab that takes its place gets the focus in its page.
    const closing = appWindow.getByRole('tab', { name: /^Held key closed/ })
    await closing.focus()
    await expect(closing).toBeFocused()
    await appWindow.keyboard.down('Delete')
    await expect(closing).toHaveCount(0)
    await expect.poll(activeTitle).toBe('Held key field')
    await expect.poll(() => electronApp.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())).toBe(fieldUrl)
    await expect.poll(pageKeys).toEqual([])
    // The held key's repeats used to reach the page's field and delete its text.
    for (let repeat = 0; repeat < 5; repeat += 1) {
      // Repeats at about a keyboard's pace.
      await appWindow.waitForTimeout(50)
      expect(await sendToFocusedPage(electronApp, 'keyDown', true)).toBe(fieldUrl)
    }
    await sendToFocusedPage(electronApp, 'keyUp')
    await appWindow.keyboard.up('Delete')
    expect(await pageKeys()).toEqual([])
    expect(await fieldValue()).toBe('abcdef')

    // A key pressed in the page still repeats there.
    await sendToFocusedPage(electronApp, 'keyDown')
    await sendToFocusedPage(electronApp, 'keyDown', true)
    await sendToFocusedPage(electronApp, 'keyDown', true)
    await sendToFocusedPage(electronApp, 'keyUp')
    await expect.poll(pageKeys).toEqual(['Delete', 'Delete repeat', 'Delete repeat'])
    expect(await fieldValue()).toBe('def')
  } finally {
    await closeFixtureServer(server)
  }
})
