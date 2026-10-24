import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'
import { trustedDialog } from './trusted-dialog-fixture.js'

test('gives the keyboard back to the page whose close or navigation the person kept, and leaves it where it was otherwise', async ({ appWindow, electronApp }) => {
  test.skip(process.platform === 'darwin', 'The person presses Ctrl+W here; the macOS key is Cmd+W')
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    // A page with a draft asks before it closes or navigates, and notes the keys it gets.
    response.end(`<!doctype html><title>${request.url}</title><form onsubmit="window.submitted = true; return false"><input id="draft"></form><script>
      window.keys = []; window.submitted = false
      addEventListener('keydown', (event) => window.keys.push(event.key))
      addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = '' })
    </script>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const draftUrl = `http://127.0.0.1:${address.port}/draft`
  try {
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(draftUrl)}, active: true })`)
    const draftTab = appWindow.getByRole('tab', { name: /^\/draft/ })
    await expect(draftTab).toBeVisible()
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
      webContents.getAllWebContents().find((contents) => contents.getURL() === url)?.isLoading() === false
    ), draftUrl)).toBe(true)
    // The person last used the tab strip, so its tab is the control the shell's document still holds as focused.
    await draftTab.click()
    const focusedUrl = () => electronApp.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL())
    const pageState = () => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find((contents) => contents.getURL() === url)!
      .executeJavaScript('({ keys: window.keys.slice(), submitted: window.submitted, value: document.querySelector("#draft").value, field: document.activeElement?.id ?? "" })') as Promise<{ keys: string[], submitted: boolean, value: string, field: string }>, draftUrl)
    // The person's key on the page, as the keyboard sends it; typing gives the page the gesture its question needs.
    const pressOnPage = (keyCode: string, modifiers: Array<'control'> = []) => electronApp.evaluate(({ webContents }, { url, keyCode, modifiers }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!
      page.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      if (keyCode.length === 1 && modifiers.length === 0) page.sendInputEvent({ type: 'char', keyCode })
      page.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    }, { url: draftUrl, keyCode, modifiers })
    // The person's key in Hronaut's own window. A held key repeats, as the keyboard does, into whatever has the keyboard,
    // until it is let go there.
    const pressInWindow = (keyCode: string, holdMs = 0) => electronApp.evaluate(async ({ BrowserWindow, webContents }, { url, keyCode, holdMs }) => {
      const shell = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL() === url)!.webContents
      const focused = () => webContents.getFocusedWebContents() ?? shell
      shell.sendInputEvent({ type: 'keyDown', keyCode })
      await new Promise<void>((resolve) => {
        const repeat = setInterval(() => focused().sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['isautorepeat'] }), 30)
        setTimeout(() => { clearInterval(repeat); resolve() }, holdMs)
      })
      focused().sendInputEvent({ type: 'keyUp', keyCode })
    }, { url: appWindow.url(), keyCode, holdMs })
    const typeDraft = async (text: string) => {
      await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)!
        page.focus()
        await page.executeJavaScript('document.querySelector("#draft").focus()')
      }, draftUrl)
      await expect.poll(focusedUrl).toBe(draftUrl)
      for (const letter of text) await pressOnPage(letter)
      await expect.poll(async () => (await pageState()).value).toContain(text)
    }

    // Ctrl+W on the page asks first; Escape keeps the page.
    await typeDraft('a')
    await pressOnPage('W', ['control'])
    await expect(trustedDialog(appWindow)).toHaveAttribute('data-armed', 'true')
    await expect.poll(focusedUrl).not.toBe(draftUrl)
    await pressInWindow('Escape')
    await expect(trustedDialog(appWindow)).toBeHidden()
    // The keyboard stayed on the tab in the strip, so typing went nowhere and Delete would have closed the tab.
    await expect.poll(focusedUrl).toBe(draftUrl)
    expect((await pageState()).field).toBe('draft')

    // Enter held on Keep editing gives the page the keyboard too, and its repeats never reach the page's form.
    await typeDraft('b')
    await pressOnPage('W', ['control'])
    await expect(trustedDialog(appWindow)).toHaveAttribute('data-armed', 'true')
    const keysBefore = (await pageState()).keys.length
    await pressInWindow('Enter', 1_000)
    await expect(trustedDialog(appWindow)).toBeHidden()
    await expect.poll(focusedUrl).toBe(draftUrl)
    expect((await pageState()).keys.length).toBe(keysBefore)
    expect((await pageState()).submitted).toBe(false)

    // A navigation asked from the address bar keeps the keyboard in the address bar.
    const addressBar = appWindow.getByRole('combobox', { name: 'Address', exact: true })
    await addressBar.click()
    await addressBar.fill(`${draftUrl}?next`)
    await addressBar.press('Enter')
    await expect(trustedDialog(appWindow)).toHaveAttribute('data-armed', 'true')
    await pressInWindow('Escape')
    await expect(trustedDialog(appWindow)).toBeHidden()
    // Nothing may move the keyboard once the dialog has gone.
    await appWindow.waitForTimeout(500)
    expect(await focusedUrl()).toBe(appWindow.url())
    await expect(addressBar).toBeFocused()
  } finally {
    await closeFixtureServer(server)
  }
})
