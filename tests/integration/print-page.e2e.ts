import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer } from './fixtures.js'
import { expect, test, text } from './capability-fixtures.js'

// Hronaut had no Print: Ctrl/Cmd+P did nothing and no menu offered it.
test('Ctrl/Cmd+P and View → Print… print the shown page, and a website or an agent keeps the key', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId } = capabilities
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    // Every page notes the keys it gets; /editor prints its document itself, as an online editor does.
    const editor = request.url === '/editor'
    response.end(`<!doctype html><title>${request.url}</title><script>window.keys = []; addEventListener('keydown', (event) => {
      window.keys.push(event.key)
      if (${editor} && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') event.preventDefault()
    })</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  const primary = process.platform === 'darwin' ? 'meta' as const : 'control' as const
  try {
    type State = { tabs: Array<{ id: string, url: string }> }
    const pageOf = async () => ((await appWindow.evaluate(`window.hronaut.getState()`)) as State).tabs.find(tab => tab.id === tabId)!.url
    const visit = async (to: string) => {
      await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(origin + to)}, tabId: ${JSON.stringify(tabId)} })`)
      await expect.poll(async () => new URL(await pageOf()).pathname).toBe(to)
      // The system's print dialog cannot be answered in a test, so the page's print notes the request and is cancelled.
      await electronApp.evaluate(({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
        if (!page) throw new Error('Page web contents was not found')
        const prints = ((globalThis as { hronautPrints?: string[] }).hronautPrints ??= [])
        page.print = ((_options: unknown, callback?: (success: boolean, reason: string) => void) => {
          prints.push(page.getURL())
          callback?.(false, 'Print job canceled')
        }) as typeof page.print
      }, origin + to)
    }
    const prints = () => electronApp.evaluate(() => ((globalThis as { hronautPrints?: string[] }).hronautPrints ?? []).map(url => new URL(url).pathname))
    // The notices Hronaut shows for a browser action that did not happen, and the choices of View → Print….
    await electronApp.evaluate(({ BrowserWindow, Menu }) => {
      const state = globalThis as { hronautFailures?: string[], hronautMenuPrints?: number }
      state.hronautFailures = []
      state.hronautMenuPrints = 0
      const shell = BrowserWindow.getAllWindows()[0]!.webContents
      const send = shell.send
      shell.send = ((channel: string, ...args: unknown[]) => {
        if (channel === 'browser:action-failed') state.hronautFailures!.push((args[0] as { message: string }).message)
        return send.call(shell, channel, ...args)
      }) as typeof shell.send
      const print = Menu.getApplicationMenu()?.items.find(item => item.label === 'View')?.submenu?.items.find(item => item.label === 'Print…')
      if (!print) throw new Error('Missing View → Print…')
      const choose = print.click as (...args: unknown[]) => unknown
      print.click = (...args: unknown[]) => {
        state.hronautMenuPrints! += 1
        return choose.apply(print, args)
      }
    })
    const failures = () => electronApp.evaluate(() => (globalThis as { hronautFailures?: string[] }).hronautFailures ?? [])
    const menuPrints = () => electronApp.evaluate(() => (globalThis as { hronautMenuPrints?: number }).hronautMenuPrints ?? 0)
    const keys = async (script = 'window.keys.slice()') => electronApp.evaluate(({ webContents }, { url, script }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Page web contents was not found')
      return page.executeJavaScript(script) as Promise<string[]>
    }, { url: await pageOf(), script })
    // The person's key, as the keyboard sends it, on the page or in Hronaut's own window.
    const pressOnPage = async () => electronApp.evaluate(({ webContents }, { url, primary }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Page web contents was not found')
      page.focus()
      page.sendInputEvent({ type: 'keyDown', keyCode: 'P', modifiers: [primary] })
      page.sendInputEvent({ type: 'keyUp', keyCode: 'P', modifiers: [primary] })
    }, { url: await pageOf(), primary })
    const pressInShell = () => electronApp.evaluate(({ BrowserWindow }, primary) => {
      const shell = BrowserWindow.getAllWindows()[0]!.webContents
      shell.sendInputEvent({ type: 'keyDown', keyCode: 'P', modifiers: [primary] })
      shell.sendInputEvent({ type: 'keyUp', keyCode: 'P', modifiers: [primary] })
    }, primary)
    const chooseMenuPrint = () => electronApp.evaluate(({ BrowserWindow, Menu }) => {
      const view = Menu.getApplicationMenu()?.items.find(item => item.label === 'View')
      const print = view?.submenu?.items.find(item => item.label === 'Print…')
      if (!print?.click) throw new Error('Missing View → Print…')
      print.click(print, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
    })
    const setAgentsPaused = (paused: boolean) => appWindow.evaluate(`window.hronaut.setTabAgentPaused(${JSON.stringify(tabId)}, ${paused})`)

    await visit('/page')
    // While an agent works on the page, the dialog would stall it, so Hronaut asks the person to take over or pause it.
    const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult
    expect(snapshot.isError, text(snapshot)).not.toBe(true)
    await pressOnPage()
    await expect.poll(failures).toEqual(['An agent is working on this page. Take over or pause agents to print it.'])
    expect(await menuPrints()).toBe(1)
    expect(await prints()).toEqual([])
    // The page saw the key first, as in Chrome.
    expect((await keys()).map(key => key.toLowerCase())).toContain('p')

    await setAgentsPaused(true)
    await pressOnPage()
    await expect.poll(prints).toEqual(['/page'])

    // From the address field, as in Chrome.
    await appWindow.getByRole('combobox', { name: 'Address', exact: true }).focus()
    await pressInShell()
    await expect.poll(prints).toEqual(['/page', '/page'])

    // Behind Settings the page is covered, so nothing prints.
    await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = appWindow.getByRole('tabpanel', { name: 'Settings' })
    await expect(settings).toBeVisible()
    await pressInShell()
    await chooseMenuPrint()
    await settings.getByRole('button', { name: 'Close settings', exact: true }).click()
    await expect(settings).toHaveCount(0)
    // The page stays covered until Settings has finished closing.
    await expect.poll(async () => {
      await chooseMenuPrint()
      return prints()
    }).toEqual(['/page', '/page', '/page'])

    // With the person's input locked on the tab, the menu prints nothing either.
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(tabId)}, true)`)
    await chooseMenuPrint()
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(tabId)}, false)`)

    // An agent's Ctrl/Cmd+P stays with the page: it never reaches the menu's key.
    await setAgentsPaused(false)
    await keys('window.keys = []')
    const choicesBefore = await menuPrints()
    const pressed = await client.callTool({ name: 'browser_press', arguments: { tabId, key: process.platform === 'darwin' ? 'Meta+p' : 'Control+p' } }) as CallToolResult
    expect(pressed.isError, text(pressed)).not.toBe(true)
    await expect.poll(async () => (await keys()).map(key => key.toLowerCase())).toContain('p')
    await appWindow.waitForTimeout(500)
    expect(await menuPrints()).toBe(choicesBefore)

    // A page that prints its document itself keeps the key.
    await setAgentsPaused(true)
    await visit('/editor')
    await pressOnPage()
    await expect.poll(async () => (await keys()).map(key => key.toLowerCase())).toEqual(['p'])
    await appWindow.waitForTimeout(500)
    expect(await menuPrints()).toBe(choicesBefore)
    expect(await prints()).toEqual(['/page', '/page', '/page'])
    expect(await failures()).toHaveLength(1)
  } finally {
    await closeFixtureServer(server)
  }
})
