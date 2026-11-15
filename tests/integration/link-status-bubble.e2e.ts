import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication } from '@playwright/test'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Pointing at a link showed nothing of where it goes. Chrome shows its address at the page's bottom left corner, and
// moves it out of the pointer's way.

const execFileAsync = promisify(execFile)
const PAGE = 'Status bubble links'
const LINKS = `<title>${PAGE}</title><body style="margin:0;height:100vh">`
  + '<a id="top" href="https://example.com/top?q=a%20b" style="position:absolute;left:200px;top:40px;font-size:30px">Top link</a>'
  + '<a id="corner" href="https://example.com/corner" style="position:absolute;left:4px;bottom:4px;font-size:30px">Corner link</a>'
  + '</body>'

type Rect = { x: number; y: number; width: number; height: number }
type BubbleView = { bounds: Rect; text: string | null; side: string | null }

/** The native view that draws the status bubble, while main has it in the window. */
function bubbleView(electronApp: ElectronApplication): Promise<BubbleView | null> {
  return electronApp.evaluate(async ({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find((child) => (
      'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().endsWith('status-bubble.html')
    )) as Electron.WebContentsView | undefined
    if (!view?.getVisible()) return null
    const [text, side] = await view.webContents.executeJavaScript(
      `[document.querySelector('.status-bubble')?.textContent ?? null, document.querySelector('.status-bubble')?.dataset.side ?? null]`
    ) as [string | null, string | null]
    return { bounds: view.getBounds(), text, side }
  })
}

/** The page's view and its links, in window coordinates. */
function layout(electronApp: ElectronApplication, title: string): Promise<{ origin: Rect; page: Rect; links: Record<string, Rect> }> {
  return electronApp.evaluate(async ({ BrowserWindow }, title) => {
    const window = BrowserWindow.getAllWindows()[0]!
    const view = window.contentView.children.find((child) => (
      'webContents' in child && (child as Electron.WebContentsView).webContents.getTitle() === title
    )) as Electron.WebContentsView
    const page = view.getBounds()
    const links = await view.webContents.executeJavaScript(`Object.fromEntries([...document.querySelectorAll('a')].map((link) => {
      const box = link.getBoundingClientRect()
      return [link.id, { x: box.x, y: box.y, width: box.width, height: box.height }]
    }))`) as Record<string, Rect>
    for (const box of Object.values(links)) {
      box.x += page.x
      box.y += page.y
    }
    return { origin: window.getContentBounds(), page, links }
  }, title)
}

function pointer(origin: Rect) {
  return (x: number, y: number, action = '--move') => execFileAsync('python3', [
    join(process.cwd(), 'tests/integration/x11-input.py'), String(Math.round(origin.x + x)), String(Math.round(origin.y + y)), action
  ])
}

/** Which link of the page has keyboard focus, and whether the page has it. */
function pageFocus(electronApp: ElectronApplication, title: string): Promise<{ focused: boolean; link: string }> {
  return electronApp.evaluate(async ({ webContents }, title) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === title)!
    return { focused: page.isFocused(), link: await page.executeJavaScript('document.activeElement?.id ?? ""') as string }
  }, title)
}

const middle = (box: Rect) => [box.x + box.width / 2, box.y + box.height / 2] as const

test.afterEach(async () => {
  // The X pointer outlives the app: leave it where the next test's window has no link under it.
  await execFileAsync('python3', [join(process.cwd(), 'tests/integration/x11-input.py'), '1500', '540', '--move']).catch(() => undefined)
})

test('shows where the link under the pointer goes at the page\'s bottom corner, out of the pointer\'s way', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`data:text/html,${encodeURIComponent(LINKS)}`)}, active: true })`)
  await appWindow.evaluate('window.hronaut.setAllHumanInteractionLocked(false)')
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe(PAGE)
  const { origin, page, links } = await layout(electronApp, PAGE)
  const move = pointer(origin)
  await move(page.x + page.width - 100, page.y + 200)

  await move(...middle(links.top!))
  await expect.poll(() => bubbleView(electronApp)).toMatchObject({ text: 'https://example.com/top?q=a b', side: 'left' })
  const shown = (await bubbleView(electronApp))!.bounds
  // In the page's bottom left corner, a third of the page wide at most.
  expect(shown.x).toBe(page.x)
  expect(shown.y + shown.height).toBe(page.y + page.height)
  expect(shown.width).toBeGreaterThan(40)
  expect(shown.width).toBeLessThanOrEqual(Math.ceil(page.width / 3))
  expect(shown.height).toBeLessThan(40)

  // Leaving the link takes it away.
  await move(page.x + page.width - 100, page.y + 200)
  await expect.poll(() => bubbleView(electronApp)).toBeNull()

  // A link in the bottom left corner gets it in the bottom right one, where the pointer is not.
  await move(...middle(links.corner!))
  await expect.poll(() => bubbleView(electronApp)).toMatchObject({ text: 'https://example.com/corner', side: 'right' })
  const moved = (await bubbleView(electronApp))!.bounds
  expect(moved.x + moved.width).toBe(page.x + page.width)
  expect(moved.y + moved.height).toBe(page.y + page.height)
  // The link keeps the pointer: the page still has it under the pointer.
  await move(middle(links.corner!)[0] + 4, middle(links.corner!)[1])
  await expect.poll(() => bubbleView(electronApp)).toMatchObject({ text: 'https://example.com/corner', side: 'right' })

  // A link the keyboard moves to shows too, and the page keeps the keyboard.
  await move(page.x + page.width - 100, page.y + 200, '--click')
  await expect.poll(() => bubbleView(electronApp)).toBeNull()
  await move(page.x + page.width - 100, page.y + 200, '--shortcut=Tab')
  await expect.poll(() => bubbleView(electronApp)).toMatchObject({ text: 'https://example.com/top?q=a b', side: 'left' })
  await move(page.x + page.width - 100, page.y + 200, '--shortcut=Tab')
  await expect.poll(() => bubbleView(electronApp)).toMatchObject({ text: 'https://example.com/corner' })
  expect(await pageFocus(electronApp, PAGE)).toEqual({ focused: true, link: 'corner' })

  // A tab selected meanwhile takes it away with its page.
  await appWindow.evaluate('window.hronaut.newTab({ url: "data:text/html,<title>Other page</title>", active: true })')
  await expect.poll(() => bubbleView(electronApp)).toBeNull()
})

test('shows nothing for an agent pointing at a link or focusing one', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(LINKS)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Status bubble fixture did not expose a port')
  const client = new Client({ name: 'hronaut-status-bubble-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
  })
  const text = (result: CallToolResult) => result.content.map((item) => item.type === 'text' ? item.text : '').join('')
  try {
    await client.connect(transport)
    await useMcpWorkspace(client, 'Status bubble test', false)
    const opened = await client.callTool({ name: 'browser_new_tab', arguments: { url: `http://127.0.0.1:${address.port}/links`, active: true } }) as CallToolResult
    expect(opened.isError, text(opened)).not.toBe(true)
    const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    await appWindow.evaluate('window.hronaut.setAllHumanInteractionLocked(false)')
    const loaded = await client.callTool({ name: 'browser_wait', arguments: { tabId, selector: '#top', state: 'visible', timeoutMs: 8_000 } }) as CallToolResult
    expect(loaded.isError, text(loaded)).not.toBe(true)
    const { origin, page, links } = await layout(electronApp, PAGE)
    const move = pointer(origin)
    // The person's click gives the page the keyboard, so a link focused there reports its address.
    await move(page.x + page.width - 100, page.y + 200, '--click')
    await expect.poll(() => pageFocus(electronApp, PAGE)).toEqual({ focused: true, link: '' })

    const bubbleMade = () => electronApp.evaluate(({ webContents }) => webContents.getAllWebContents().some((contents) => contents.getURL().endsWith('status-bubble.html')))
    // A script the agent runs that focuses a link reaches no input event of the page's.
    const focused = await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: 'document.getElementById("top").focus(); document.activeElement.id' } }) as CallToolResult
    expect(text(focused)).toContain('top')
    // Past the bubble's show delay, nothing was ever drawn: its view, made for the first bubble, does not exist.
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(await bubbleMade()).toBe(false)
    const hover = await client.callTool({ name: 'browser_hover', arguments: { tabId, selector: '#corner' } }) as CallToolResult
    expect(hover.isError, text(hover)).not.toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(await bubbleMade()).toBe(false)

    // The person's own pointing shows it again.
    await move(...middle(links.top!))
    await expect.poll(() => bubbleView(electronApp)).toMatchObject({ text: 'https://example.com/top?q=a b' })
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
