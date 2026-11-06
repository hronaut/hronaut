import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication } from '@playwright/test'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function succeeded(result: CallToolResult): string {
  const content = result.content.find(item => item.type === 'text')
  const text = content?.type === 'text' ? content.text : ''
  expect(result.isError, text).not.toBe(true)
  return text
}

function parsed(result: CallToolResult): Record<string, unknown> {
  return JSON.parse(succeeded(result))
}

/** Where main draws the page with this URL, in window coordinates. */
async function pageBounds(electronApp: ElectronApplication, url: string): Promise<Electron.Rectangle | undefined> {
  return electronApp.evaluate(({ BrowserWindow, WebContentsView }, url) => {
    const view = BrowserWindow.getAllWindows()[0]?.contentView.children.find((candidate) => (
      candidate instanceof WebContentsView && candidate.webContents.getURL() === url && candidate.getVisible()
    ))
    return view?.getBounds()
  }, url)
}

test('the full-page view gives the page the window and brings the chrome back at its edge', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
  }).toBe(true)
  const client = new Client({ name: 'Claude Code', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
  try {
    await connectMcpWorkspace(client, 'Full page', false)
    const url = 'data:text/html,<title>Full page</title><main>Full page</main>'
    const opened = parsed(await client.callTool({ name: 'browser_new_tab', arguments: { url, active: true } }) as CallToolResult)
    const tabId = (opened.tabs as Array<{ id: string }>)[0]!.id
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    // The app starts on Home, which has no toolbar; the page is measured once it sits below the toolbar.
    await expect(appWindow.locator('.toolbar')).toBeVisible()
    let previous: Electron.Rectangle | undefined
    await expect.poll(async () => {
      const [last, current] = [previous, await pageBounds(electronApp, url)]
      previous = current
      const toolbarBottom = await appWindow.evaluate(() => document.querySelector('.toolbar')!.getBoundingClientRect().bottom)
      return Boolean(current && current.height > 1 && current.y >= Math.floor(toolbarBottom) && last && JSON.stringify(last) === JSON.stringify(current))
    }).toBe(true)
    const normal = previous!
    const shell = appWindow.locator('header.shell')
    const edge = appWindow.getByTestId('full-page-edge')
    await appWindow.mouse.move(600, 500)

    // Ctrl+Shift+F hides the tabs and the toolbar; the page fills the window under a band as tall as the window controls.
    await appWindow.keyboard.press('Control+Shift+F')
    await expect(shell).toHaveClass(/full-page-concealed/)
    await expect(edge).toHaveText('Full page')
    const bandBottom = Math.round(await edge.evaluate((element) => element.getBoundingClientRect().bottom))
    expect(bandBottom).toBeLessThan(normal.y - 40)
    await expect.poll(() => pageBounds(electronApp, url)).toEqual({
      x: normal.x, y: bandBottom, width: normal.width, height: normal.y + normal.height - bandBottom
    })
    // Nothing in the view moves the window, so the system leaves the pointer to the band and the bars it reveals.
    const dragRegions = () => appWindow.evaluate(() => Array.from(document.querySelectorAll('[data-titlebar-drag-surface]'))
      .map((element) => getComputedStyle(element).getPropertyValue('-webkit-app-region'))
      .filter((region) => region === 'drag').length)
    expect(await dragRegions()).toBe(0)

    // Resting the pointer at the top edge brings them back, and the page makes room again.
    await appWindow.mouse.move(600, 20)
    await expect(shell).not.toHaveClass(/full-page-concealed/)
    await expect.poll(() => pageBounds(electronApp, url)).toEqual(normal)
    const exit = appWindow.getByRole('button', { name: 'Exit full-page view', exact: true })
    await expect(exit).toBeVisible()
    expect((await exit.boundingBox())!.height).toBeGreaterThanOrEqual(32)
    expect(await dragRegions()).toBe(0)
    // Moving back onto the page hides them.
    await appWindow.mouse.move(600, 500)
    await expect(shell).toHaveClass(/full-page-concealed/)
    await expect.poll(async () => (await pageBounds(electronApp, url))!.y).toBe(bandBottom)

    // An agent that needs you brings the toolbar back with its avatar until you answer.
    succeeded(await client.callTool({ name: 'browser_request_user_attention', arguments: { tabId, reason: 'Check the total.' } }) as CallToolResult)
    await expect(shell).not.toHaveClass(/full-page-concealed/)
    await expect(appWindow.getByRole('group', { name: 'Agents in this workspace', exact: true }).getByRole('button', { name: /^Claude Code, needs you/ })).toBeVisible()
    await expect.poll(() => pageBounds(electronApp, url)).toEqual(normal)
    await appWindow.evaluate('window.hronaut.getUserAttention().then((request) => window.hronaut.answerUserAttention(request.id, "resolved"))')
    await expect(shell).toHaveClass(/full-page-concealed/)

    // The same keys pressed in the website leave the view.
    await electronApp.evaluate(({ BrowserWindow, WebContentsView }, url) => {
      const view = BrowserWindow.getAllWindows()[0]?.contentView.children.find((candidate) => (
        candidate instanceof WebContentsView && candidate.webContents.getURL() === url
      )) as Electron.WebContentsView
      view.webContents.focus()
      view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: ['control', 'shift'] })
      view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers: ['control', 'shift'] })
    }, url)
    await expect(shell).not.toHaveClass(/full-page-view/)
    await expect(edge).toHaveCount(0)
    await expect.poll(() => pageBounds(electronApp, url)).toEqual(normal)
    expect(await dragRegions()).toBeGreaterThan(0)

    // Turned on while the pointer rests on the tabs, the band that takes their place answers the next move.
    await appWindow.mouse.move(600, 20)
    await appWindow.keyboard.press('Control+Shift+F')
    await expect(shell).toHaveClass(/full-page-concealed/)
    await appWindow.mouse.move(610, 22)
    await expect(shell).not.toHaveClass(/full-page-concealed/)
    await appWindow.mouse.move(600, 500)
    await expect(shell).toHaveClass(/full-page-concealed/)
    await appWindow.keyboard.press('Control+Shift+F')
    await expect(shell).not.toHaveClass(/full-page-view/)

    // With the tabs in a rail, the hidden rail gives the page its width, and the window's left edge brings it back.
    await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
    await expect(appWindow.getByRole('navigation', { name: 'Tab navigation' })).toHaveClass(/vertical/)
    await expect.poll(async () => (await pageBounds(electronApp, url))!.x).toBeGreaterThan(100)
    const railed = (await pageBounds(electronApp, url))!
    await appWindow.keyboard.press('Control+Shift+F')
    await expect(shell).toHaveClass(/full-page-concealed/)
    await expect.poll(async () => (await pageBounds(electronApp, url))!.x).toBe(normal.x)
    await appWindow.mouse.move(4, 500)
    await expect(shell).not.toHaveClass(/full-page-concealed/)
    await expect.poll(async () => (await pageBounds(electronApp, url))!.x).toBe(railed.x)
    await appWindow.mouse.move(700, 500)
    await expect(shell).toHaveClass(/full-page-concealed/)
    await appWindow.keyboard.press('Control+Shift+F')
    await expect(shell).not.toHaveClass(/full-page-view/)
    await expect.poll(() => pageBounds(electronApp, url)).toEqual(railed)
    await appWindow.evaluate("window.hronautSettings.setTabPosition('top')")
  } finally {
    await client.close()
  }
})

// A press on a tab shows it while the button is down, and its page takes the keyboard then: the chrome went 400 ms
// after the press, while the person still held the tab, as to drag it.
test('keeps the chrome of the full-page view while a press on a tab holds', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Held ${(request.url ?? '/').slice(1).toUpperCase()}</title><p>Page</p>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The fixture server has no port.')
  const origin = `http://127.0.0.1:${address.port}`
  const control = (name: string) => appWindow.getByRole('tab', { name: new RegExp(`^Held ${name}`) })
  const shell = appWindow.locator('header.shell')
  try {
    for (const [index, name] of ['a', 'b'].entries()) {
      await appWindow.evaluate(`window.hronaut.newTab({ url: '${origin}/${name}', active: ${index === 0} })`)
    }
    await expect(control('B')).toBeVisible()
    await expect(appWindow.locator('.toolbar')).toBeVisible()
    await appWindow.mouse.move(600, 500)
    await appWindow.keyboard.press('Control+Shift+F')
    await expect(shell).toHaveClass(/full-page-concealed/)
    await appWindow.mouse.move(600, 20)
    await expect(shell).not.toHaveClass(/full-page-concealed/)
    const box = (await control('B').boundingBox())!
    await appWindow.mouse.move(box.x + box.width / 3, box.y + box.height / 2)
    await appWindow.mouse.down()
    try {
      await expect(control('B')).toHaveAttribute('data-active-tab', 'true')
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
        webContents.getAllWebContents().find((contents) => contents.getURL() === url)?.isFocused() ?? false
      ), `${origin}/b`)).toBe(true)
      await appWindow.waitForTimeout(800)
      await expect(shell).not.toHaveClass(/full-page-concealed/)
    } finally {
      await appWindow.mouse.up()
    }
    await appWindow.keyboard.press('Control+Shift+F')
    await expect(shell).not.toHaveClass(/full-page-view/)
  } finally {
    await closeFixtureServer(server)
  }
})
