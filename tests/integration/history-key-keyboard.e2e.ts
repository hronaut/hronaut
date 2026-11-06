import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

type TestWindow = { hronaut: HronautApi }

// Ctrl+H (Cmd+Y on macOS) from a page opened History but left the keyboard in the page, so what the person typed next
// went to the website behind the panel. Chrome's History page takes the keyboard in its search, and closing it gives
// the keyboard back to the page.
test('the history key from a page puts the keyboard in History\'s search, and closing History gives it back', async ({ appWindow, electronApp }) => {
  const mac = process.platform === 'darwin'
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Notes</title><input aria-label="Note" autofocus>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    await appWindow.evaluate(url => (window as unknown as TestWindow).hronaut.newTab({ url, active: true }), `${origin}/notes`)
    await expect.poll(async () => (await appWindow.evaluate(() => (window as unknown as TestWindow).hronaut.getState()))
      .tabs.find(tab => tab.url === `${origin}/notes`)?.title).toBe('Notes')
    const focusedContents = () => electronApp.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())
    // The person's key, sent to the page with its field in focus, as the keyboard sends it.
    const pressInPage = () => electronApp.evaluate(({ webContents }, { origin, modifier, keyCode }) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(origin))
      if (!contents) throw new Error('Page web contents was not found')
      contents.focus()
      contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: [modifier] })
      contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: [modifier] })
    }, { origin, modifier: mac ? 'meta' as const : 'control' as const, keyCode: mac ? 'Y' : 'H' })
    const history = appWindow.getByRole('dialog', { name: 'Browsing history' })
    const search = appWindow.getByRole('searchbox', { name: 'Search browsing history' })

    await pressInPage()
    await expect(history).toBeVisible()
    await expect(search).toBeFocused()
    await expect.poll(focusedContents).toBe(appWindow.url())
    // What the person types next goes to the search, not to the website.
    await electronApp.evaluate(({ webContents }) => {
      const focused = webContents.getFocusedWebContents()
      if (!focused) throw new Error('The history key left no focused web contents')
      for (const character of 'notes') focused.sendInputEvent({ type: 'char', keyCode: character })
    })
    await expect(search).toHaveValue('notes')
    expect(await electronApp.evaluate(({ webContents }, origin) => webContents.getAllWebContents()
      .find(candidate => candidate.getURL().startsWith(origin))!.executeJavaScript('document.querySelector("input").value'), origin)).toBe('')

    // Escape closes it and the page has the keyboard again.
    await appWindow.keyboard.press('Escape')
    await expect(history).toBeHidden()
    await expect.poll(focusedContents).toBe(`${origin}/notes`)

    // So does the history key pressed in the page again while History is open.
    await pressInPage()
    await expect(search).toBeFocused()
    await pressInPage()
    await expect(history).toBeHidden()
    await expect.poll(focusedContents).toBe(`${origin}/notes`)

    // The page keeps it, where the key was pressed, also when Hronaut's window last had it somewhere else, such as on the
    // page's tab.
    await pressInPage()
    await expect(search).toBeFocused()
    const tab = appWindow.getByRole('tab', { name: /^Notes/, selected: true })
    await tab.focus()
    await expect(tab).toBeFocused()
    await expect(history).toBeVisible()
    await pressInPage()
    await expect(history).toBeHidden()
    await expect.poll(focusedContents).toBe(`${origin}/notes`)

    // The keys typed right after the key closes History from the page, while Hronaut's window is busy, reach the page.
    await pressInPage()
    await expect(search).toBeFocused()
    await electronApp.evaluate(async ({ webContents }, { origin, shellUrl, modifier, keyCode }) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(origin))
      const shell = webContents.getAllWebContents().find(candidate => candidate.getURL() === shellUrl)
      if (!page || !shell) throw new Error('The page or Hronaut\'s window was not found')
      page.focus()
      await new Promise(resolve => setTimeout(resolve, 100))
      void shell.executeJavaScript('setTimeout(() => { const start = performance.now(); while (performance.now() - start < 150); }, 0)')
      page.sendInputEvent({ type: 'keyDown', keyCode, modifiers: [modifier] })
      page.sendInputEvent({ type: 'keyUp', keyCode, modifiers: [modifier] })
      // The person types on at once, where the keyboard is, as soon as Hronaut's window has it, if it takes it.
      const start = Date.now()
      while (webContents.getFocusedWebContents()?.id !== shell.id && Date.now() - start < 300) {
        await new Promise(resolve => setImmediate(resolve))
      }
      for (const character of 'abc') {
        const focused = webContents.getFocusedWebContents()
        if (!focused) throw new Error('Nothing has the keyboard')
        focused.sendInputEvent({ type: 'keyDown', keyCode: character })
        focused.sendInputEvent({ type: 'char', keyCode: character })
        focused.sendInputEvent({ type: 'keyUp', keyCode: character })
      }
    }, { origin, shellUrl: appWindow.url(), modifier: mac ? 'meta' as const : 'control' as const, keyCode: mac ? 'Y' : 'H' })
    await expect(history).toBeHidden()
    await expect.poll(() => electronApp.evaluate(({ webContents }, origin) => webContents.getAllWebContents()
      .find(candidate => candidate.getURL().startsWith(origin))!.executeJavaScript('document.querySelector("input").value'), origin)).toBe('abc')
    await expect.poll(focusedContents).toBe(`${origin}/notes`)
  } finally {
    await closeFixtureServer(server)
  }
})
