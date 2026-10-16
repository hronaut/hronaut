import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication } from '@playwright/test'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  const content = result.content.find(item => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

function succeeded(result: CallToolResult): string {
  expect(result.isError, text(result)).not.toBe(true)
  return text(result)
}

function parsed(result: CallToolResult): Record<string, unknown> {
  return JSON.parse(succeeded(result))
}

type PageInput =
  | { type: 'click' }
  | { type: 'key'; keyCode: string; modifiers?: Array<'control' | 'shift'> }

/** Input the person gives the page itself, which reaches main as native page input. */
async function inPage(electronApp: ElectronApplication, url: string, input: PageInput): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow, WebContentsView }, { url, input }) => {
    const view = BrowserWindow.getAllWindows()[0]?.contentView.children.find((candidate) => (
      candidate instanceof WebContentsView && candidate.webContents.getURL() === url
    )) as Electron.WebContentsView | undefined
    if (!view) throw new Error('The page is not shown')
    view.webContents.focus()
    if (input.type === 'click') {
      view.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: 40, y: 40 })
      view.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: 40, y: 40 })
    } else {
      view.webContents.sendInputEvent({ type: 'keyDown', keyCode: input.keyCode, modifiers: input.modifiers ?? [] })
      view.webContents.sendInputEvent({ type: 'keyUp', keyCode: input.keyCode, modifiers: input.modifiers ?? [] })
    }
  }, { url, input })
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function pageKeys(electronApp: ElectronApplication, url: string): Promise<string[]> {
  return electronApp.evaluate(({ BrowserWindow, WebContentsView }, url) => {
    const view = BrowserWindow.getAllWindows()[0]?.contentView.children.find((candidate) => (
      candidate instanceof WebContentsView && candidate.webContents.getURL() === url
    )) as Electron.WebContentsView
    return view.webContents.executeJavaScript('window.keys') as Promise<string[]>
  }, url)
}

test('the person takes a page over from its agent in the toolbar and hands it back with a note', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
  }).toBe(true)
  const client = new Client({ name: 'Claude Code', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
  try {
    // Wide enough for the whole prompt beside the commands.
    await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setSize(1920, 900) })
    await connectMcpWorkspace(client, 'Take over', false)
    const url = 'data:text/html,<title>Cart</title><main>Cart</main><script>window.keys=[];onkeydown=e=>keys.push(e.key)</script>'
    const opened = parsed(await client.callTool({ name: 'browser_new_tab', arguments: { url, active: true } }) as CallToolResult)
    const tabId = (opened.tabs as Array<{ id: string }>)[0]!.id
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    const toolbar = appWindow.locator('.toolbar')
    await expect(toolbar).toBeVisible()
    const prompt = appWindow.getByTestId('agent-take-over')

    // While agents are paused on the tab, a click offers nothing and the page keeps Ctrl+Shift+O for itself.
    const address = appWindow.locator('.toolbar .address-form')
    const toolbarHeight = (await toolbar.boundingBox())!.height
    const addressWidth = (await address.boundingBox())!.width
    await appWindow.evaluate(`window.hronaut.setTabAgentPaused(${JSON.stringify(tabId)}, true)`)
    await inPage(electronApp, url, { type: 'click' })
    await inPage(electronApp, url, { type: 'key', keyCode: 'O', modifiers: ['control', 'shift'] })
    await expect.poll(() => pageKeys(electronApp, url)).toEqual(['O'])
    await expect(prompt).toHaveCount(0)
    await appWindow.evaluate(`window.hronaut.setTabAgentPaused(${JSON.stringify(tabId)}, false)`)
    succeeded(await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult)
    await expect(appWindow.getByRole('group', { name: 'Agents in this workspace', exact: true }).getByRole('button', { name: 'Claude Code, working' })).toBeVisible()

    // Clicking the page the agent is working on offers a take over in the toolbar's free room: the toolbar keeps
    // its height and the address field its width.
    await inPage(electronApp, url, { type: 'click' })
    await expect(appWindow.getByRole('group', { name: 'Take over from Claude Code?', exact: true })).toBeVisible()
    await expect(prompt).toHaveAttribute('data-fit', 'full')
    await expect(appWindow.getByRole('status').filter({ hasText: 'Take over from Claude Code?' })).toHaveCount(1)
    const takeOver = prompt.getByRole('button', { name: 'Take over', exact: true })
    expect((await takeOver.boundingBox())!.height).toBeGreaterThanOrEqual(32)
    expect((await toolbar.boundingBox())!.height).toBe(toolbarHeight)
    expect((await address.boundingBox())!.width).toBe(addressWidth)

    // Ctrl+Shift+O pressed in the page now takes it over, and the page does not get it.
    await inPage(electronApp, url, { type: 'key', keyCode: 'O', modifiers: ['control', 'shift'] })
    const control = appWindow.getByRole('group', { name: 'You have control', exact: true })
    await expect(control).toBeVisible()
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(tabId)}))`))
      .toMatchObject({ agentPaused: true, takenOverAt: expect.any(Number) })
    expect(await pageKeys(electronApp, url)).toEqual(['O'])

    // The agent hears that the person has the tab.
    const refused = await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult
    expect(refused.isError).toBe(true)
    expect(text(refused)).toContain('the person took it over in the Hronaut window and has control')

    // Meanwhile the person clicks and goes to another page; touching it offers nothing more.
    await inPage(electronApp, url, { type: 'click' })
    const next = 'data:text/html,<title>Checkout</title><main>Checkout</main>'
    await electronApp.evaluate(({ BrowserWindow, WebContentsView }, { url, next }) => {
      const view = BrowserWindow.getAllWindows()[0]?.contentView.children.find((candidate) => (
        candidate instanceof WebContentsView && candidate.webContents.getURL() === url
      )) as Electron.WebContentsView
      void view.webContents.loadURL(next)
    }, { url, next })
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(tabId)})?.url)`)).toBe(next)
    await expect(control).toBeVisible()
    expect((await toolbar.boundingBox())!.height).toBe(toolbarHeight)
    expect((await address.boundingBox())!.width).toBe(addressWidth)

    // Hand back resumes the agent, which reads what changed.
    await control.getByRole('button', { name: 'Hand back to Claude Code', exact: true }).click()
    await expect(prompt).toHaveCount(0)
    const tabs = JSON.parse(succeeded(await client.callTool({ name: 'browser_tabs', arguments: {} }) as CallToolResult)) as Array<Record<string, unknown>>
    const handed = tabs.find((tab) => tab.id === tabId)!
    expect(handed.agentPaused).toBe(false)
    expect(handed.takenOverAt).toBeUndefined()
    expect((handed.handedBack as { note: string }).note).toMatch(new RegExp(
      '^The person had this tab for \\d+ s and handed it back\\. '
      + `The page moved from ${escaped(url)} to ${escaped(next)}\\. `
      + 'They clicked or typed in the page\\. Read the page again before you continue\\.$'
    ))
    succeeded(await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult)

    // With the tab rail in a narrower window the address field has no room to spare, so the agent's avatar
    // carries a hand badge instead, and Ctrl+Shift+O still takes over.
    await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
    await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.setSize(1440, 900) })
    await expect(appWindow.getByRole('navigation', { name: 'Tab navigation' })).toHaveClass(/vertical/)
    await expect.poll(async () => (await address.boundingBox())!.width).toBeLessThan(520)
    const railedWidth = (await address.boundingBox())!.width
    succeeded(await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult)
    await inPage(electronApp, next, { type: 'click' })
    const avatar = appWindow.getByRole('group', { name: 'Agents in this workspace', exact: true }).getByRole('button', { name: 'Claude Code, working' })
    await expect(avatar.locator('.agent-avatar-badge.take-over')).toHaveAttribute('data-kind', 'offer')
    await expect(prompt).toHaveCount(0)
    expect((await address.boundingBox())!.width).toBe(railedWidth)
    await inPage(electronApp, next, { type: 'key', keyCode: 'O', modifiers: ['control', 'shift'] })
    await expect(appWindow.getByRole('group', { name: 'Agents in this workspace', exact: true }).locator('.agent-avatar-badge.take-over[data-kind="control"]')).toHaveCount(1)
    expect((await address.boundingBox())!.width).toBe(railedWidth)
    await appWindow.evaluate("window.hronautSettings.setTabPosition('top')")
  } finally {
    await client.close()
  }
})
