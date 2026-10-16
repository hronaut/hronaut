import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication } from '@playwright/test'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { expect, test } from './fixtures.js'

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

test('pins the agent\'s live status below the toolbar, moving the page down, and unpins it', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
  }).toBe(true)
  const client = new Client({ name: 'Claude Code', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
  try {
    await connectMcpWorkspace(client, 'Strip', false)
    const url = 'data:text/html,<title>Strip</title><main>Strip</main>'
    const opened = parsed(await client.callTool({ name: 'browser_new_tab', arguments: { url, active: true } }) as CallToolResult)
    const tabId = (opened.tabs as Array<{ id: string }>)[0]!.id
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    // The app starts on Home, which has no toolbar, so the page can first be placed for that shorter shell.
    // It is measured once it sits below the toolbar and two readings agree.
    await expect(appWindow.getByRole('group', { name: 'Agents in this workspace', exact: true }).getByRole('button', { name: /^Claude Code, / })).toBeVisible()
    let previous: Electron.Rectangle | undefined
    await expect.poll(async () => {
      const [last, current] = [previous, await pageBounds(electronApp, url)]
      previous = current
      const toolbarBottom = await appWindow.evaluate(() => document.querySelector('.toolbar')!.getBoundingClientRect().bottom)
      return Boolean(current && current.height > 1 && current.y >= Math.floor(toolbarBottom) && last && JSON.stringify(last) === JSON.stringify(current))
    }).toBe(true)
    const unpinned = previous!

    // Off until you pin it.
    const strip = appWindow.getByRole('group', { name: 'Live status of agents in this workspace', exact: true })
    await expect(strip).toHaveCount(0)
    expect(await appWindow.evaluate('window.hronautSettings.get().then(settings => settings.pinAgentLiveStatus)')).toBe(false)
    await appWindow.evaluate('window.hronautSettings.setPinAgentLiveStatus(true)')
    await expect(strip).toBeVisible()
    await expect(strip.getByText('Claude Code', { exact: true })).toBeVisible()

    // The page moves down by the strip's height, under the toolbar and the strip, and keeps its bottom edge.
    const layout = await appWindow.evaluate(() => {
      const toolbar = document.querySelector('.toolbar')!.getBoundingClientRect()
      const row = document.querySelector('.agent-live-strip')!.getBoundingClientRect()
      return { toolbarBottom: toolbar.bottom, top: row.top, bottom: row.bottom, height: row.height }
    })
    expect(layout.top).toBeGreaterThanOrEqual(Math.floor(layout.toolbarBottom))
    expect(layout.height).toBeGreaterThan(30)
    await expect.poll(async () => (await pageBounds(electronApp, url))!.y - unpinned.y).toBeGreaterThanOrEqual(Math.floor(layout.height) - 1)
    const pinned = (await pageBounds(electronApp, url))!
    expect(pinned.y - unpinned.y).toBeLessThanOrEqual(Math.ceil(layout.height) + 1)
    expect(pinned.y).toBeGreaterThanOrEqual(Math.floor(layout.bottom))
    expect(pinned.y + pinned.height).toBe(unpinned.y + unpinned.height)

    // It names the agent's current step, and Pause and Take over act on its tab, with 32 px targets.
    succeeded(await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult)
    await expect(strip).toHaveAttribute('data-state', 'working')
    await expect(strip.getByText('Reading the page', { exact: true })).toBeVisible()
    for (const button of await strip.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(32)
    await strip.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(tabId)})?.agentPaused === true)`)).toBe(true)
    await strip.getByRole('button', { name: 'Resume', exact: true }).click()
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(tabId)})?.agentPaused === true)`)).toBe(false)

    // When the agent needs you, the strip shows why, and Hand back answers it.
    succeeded(await client.callTool({ name: 'browser_request_user_attention', arguments: { tabId, reason: 'Check the total.' } }) as CallToolResult)
    await expect(strip).toHaveAttribute('data-state', 'needs-you')
    await expect(strip.getByText('Check the total.', { exact: true })).toBeVisible()
    await expect(strip.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0)
    await strip.getByRole('button', { name: 'Hand back', exact: true }).click()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getUserAttention()')).toBeNull()
    await expect(strip).not.toHaveAttribute('data-state', 'needs-you')

    // With the tabs in a rail, the strip starts after the rail, like the page.
    await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
    await expect(appWindow.getByRole('navigation', { name: 'Tab navigation' })).toHaveClass(/vertical/)
    await expect.poll(async () => {
      const left = await appWindow.evaluate(() => document.querySelector('.agent-live-strip-pill')!.getBoundingClientRect().left)
      return left >= (await pageBounds(electronApp, url))!.x - 1
    }).toBe(true)
    await expect.poll(async () => (await pageBounds(electronApp, url))!.y).toBeGreaterThanOrEqual(Math.floor(
      await appWindow.evaluate(() => document.querySelector('.agent-live-strip')!.getBoundingClientRect().bottom)
    ))
    await appWindow.evaluate("window.hronautSettings.setTabPosition('top')")

    // The chevron unpins it and gives the page its room back.
    await strip.getByRole('button', { name: 'Unpin live status', exact: true }).click()
    await expect(strip).toHaveCount(0)
    expect(await appWindow.evaluate('window.hronautSettings.get().then(settings => settings.pinAgentLiveStatus)')).toBe(false)
    await expect.poll(() => pageBounds(electronApp, url)).toEqual(unpinned)
  } finally {
    await client.close()
  }
})
