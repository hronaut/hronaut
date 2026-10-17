import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication, Page } from '@playwright/test'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { AgentPresenceSnapshot, AgentStepHistoryEntry } from '../../src/shared/agent-presence.js'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

type TestWindow = {
  hronaut: HronautApi
  hronautAgentPresence: {
    get: () => Promise<AgentPresenceSnapshot>
    steps: (request: { clientKey: string; workspaceId: string; known: string[] }) => Promise<AgentStepHistoryEntry[] | null>
  }
}

function succeeded(result: CallToolResult): string {
  const content = result.content.find(item => item.type === 'text')
  const text = content?.type === 'text' ? content.text : ''
  expect(result.isError, text).not.toBe(true)
  return text
}

async function clickInCard(electronApp: ElectronApplication, selector: string): Promise<void> {
  await electronApp.evaluate(async ({ BrowserWindow }, selector) => {
    const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find((child) => (
      'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().endsWith('agent-card.html')
    )) as Electron.WebContentsView
    await view.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`)
  }, selector)
}

async function cardShown(electronApp: ElectronApplication): Promise<boolean> {
  return electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children.some((child) => (
    'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().endsWith('agent-card.html') && child.getVisible()
  )))
}

/** The agent's steps as the shell reads them, with whether each has its picture. */
async function steps(appWindow: Page, name: string): Promise<Array<{ step: string; tabId?: string; pictured: boolean }>> {
  return appWindow.evaluate(async (name) => {
    const presence = (window as unknown as TestWindow).hronautAgentPresence
    const snapshot = await presence.get()
    for (const [workspaceId, agents] of Object.entries(snapshot.workspaces)) {
      const agent = agents.find((candidate) => candidate.name === name)
      if (!agent) continue
      const entries = await presence.steps({ clientKey: agent.clientKey, workspaceId, known: [] }) ?? []
      return entries.map((entry) => ({ step: entry.step, ...(entry.tabId ? { tabId: entry.tabId } : {}), pictured: entry.thumbnail?.dataUrl?.startsWith('data:image/jpeg;base64,') === true }))
    }
    return []
  }, name)
}

test('shows an agent\'s last steps with a picture of the page after each, from its card', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(request.url?.startsWith('/receipt')
      ? '<!doctype html><title>Receipt</title><body style="background:#0b6e4f;color:white"><h1>Thanks</h1></body>'
      : '<!doctype html><title>Checkout</title><body style="background:#f4d35e"><button>Review order</button></body>')
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The checkout fixture did not expose a port')
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
  }).toBe(true)
  const client = new Client({ name: 'Claude Code', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
  try {
    await connectMcpWorkspace(client, 'All steps', false)
    const results: string[] = []
    const call = async (name: string, args: Record<string, unknown>) => {
      const text = succeeded(await client.callTool({ name, arguments: args }) as CallToolResult)
      results.push(text)
      return text
    }
    const opened = JSON.parse(await call('browser_new_tab', { url: `http://127.0.0.1:${address.port}/checkout`, active: true }))
    const checkoutTab = (opened.tabs as Array<{ id: string }>)[0]!.id
    await appWindow.evaluate((tabId) => (window as unknown as TestWindow).hronaut.selectTab(tabId), checkoutTab)
    const snapshot = await call('browser_snapshot', { tabId: checkoutTab })
    const review = /\[(e\d+)\] button[^[]*?Review order/.exec(snapshot)?.[1]
    expect(review, snapshot).toBeTruthy()
    await call('browser_click', { tabId: checkoutTab, ref: review })
    // A step on the tab in view gets a picture once the tab settles. Whether the earlier steps get theirs depends on
    // how soon the next step followed, so only the last one is certain.
    await expect.poll(async () => (await steps(appWindow, 'Claude Code'))[0], { timeout: 10_000 }).toEqual({ step: 'click', tabId: checkoutTab, pictured: true })
    expect((await steps(appWindow, 'Claude Code')).map(({ step, tabId }) => [step, tabId])).toEqual([['click', checkoutTab], ['read', checkoutTab], ['openTab', checkoutTab]])
    // Another tab of the workspace, so Show tab has somewhere to go back from.
    const second = JSON.parse(await call('browser_new_tab', { url: `http://127.0.0.1:${address.port}/receipt`, active: true }))
    const receiptTab = (second.tabs as Array<{ id: string }>).find((tab) => tab.id !== checkoutTab)?.id ?? (second.tabs as Array<{ id: string }>)[0]!.id
    await appWindow.evaluate((tabId) => (window as unknown as TestWindow).hronaut.selectTab(tabId), receiptTab)
    await call('browser_tabs', {})
    await expect.poll(async () => (await steps(appWindow, 'Claude Code')).map((step) => step.step), { timeout: 10_000 }).toEqual(['working', 'openTab', 'click', 'read', 'openTab'])

    const avatar = appWindow.getByRole('group', { name: 'Agents in this workspace', exact: true }).getByRole('button', { name: /^Claude Code, / })
    await avatar.click()
    await expect.poll(() => cardShown(electronApp)).toBe(true)
    await clickInCard(electronApp, '[data-action="all-steps"]')
    const dialog = appWindow.getByRole('dialog', { name: 'Steps by Claude Code' })
    await expect(dialog).toBeVisible()
    await expect.poll(() => cardShown(electronApp)).toBe(false)
    await expect(dialog).toHaveAccessibleDescription('Up to 20 of its latest steps in All steps, newest first.')
    const checkout = dialog.getByRole('region', { name: 'Checkout' })
    await expect(checkout.getByRole('listitem')).toHaveCount(3)
    await expect(checkout.getByRole('listitem').first()).toContainText('Clicked “Review order”')
    // The picture is a real JPEG of the page, drawn small.
    const picture = checkout.getByRole('listitem').first().locator('img')
    await expect(picture).toHaveAttribute('src', /^data:image\/jpeg;base64,/u)
    expect(await picture.evaluate((image: HTMLImageElement) => image.decode().then(() => [image.naturalWidth > 0, image.naturalWidth <= 320, image.naturalHeight <= 200]))).toEqual([true, true, true])
    await expect(dialog.getByRole('region', { name: 'Not on a tab' })).toContainText('Finished a step')

    await checkout.getByRole('button', { name: 'Show tab Checkout' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => appWindow.evaluate(async () => (await (window as unknown as TestWindow).hronaut.getState()).activeTabId)).toBe(checkoutTab)

    // Esc closes it, and pictures never reach agents.
    await avatar.click()
    await expect.poll(() => cardShown(electronApp)).toBe(true)
    await clickInCard(electronApp, '[data-action="all-steps"]')
    await expect(dialog).toBeVisible()
    await appWindow.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    for (const result of results) expect(result).not.toContain('data:image/jpeg')
  } finally {
    await client.close()
    await closeFixtureServer(server)
  }
})
