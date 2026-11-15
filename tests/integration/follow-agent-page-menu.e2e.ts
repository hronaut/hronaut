import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

// With Follow agents on, following waited only the few seconds after the person's right-click, and then brought the
// agent's tab into view under the page's open menu, where Paste or any other item acted on the page that had left it.

const text = (result: CallToolResult) => result.content.map((part) => part.type === 'text' ? part.text : '').join('')

async function connectClient(port: number, token: string): Promise<Client> {
  await expect.poll(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/healthz`, { headers: { authorization: `Bearer ${token}` } })).ok
    } catch {
      return false
    }
  }).toBe(true)
  const client = new Client({ name: 'follow-agent-page-menu', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } }
  }))
  return client
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name, arguments: args }) as CallToolResult
  expect(result.isError, text(result)).not.toBe(true)
  return text(result)
}

type MenuScope = typeof globalThis & { __pageMenu?: Electron.Menu; __restorePageMenu?: () => void }

test('keeps the person\'s page in view while its menu is open, and follows again a while after it closes', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const notesUrl = 'data:text/html,<title>Notes</title><textarea style="width:300px;height:200px">draft</textarea>'
  const client = await connectClient(mcpPort, mcpToken)
  try {
    const { id: workspaceId } = JSON.parse(await call(client, 'browser_workspaces', { action: 'create', name: 'Agent research' })) as { id: string }
    const agentTabId = (JSON.parse(await call(client, 'browser_new_tab', { workspaceId, url: 'data:text/html,<title>Agent run</title>' })) as { activeTabId: string }).activeTabId
    const person = await appWindow.evaluate(async (url) => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const state = await api.createWorkspace({ name: 'Notes', storage: 'scratch' })
      const id = state.mcpTabGroups.find(group => group.name === 'Notes')!.id
      return (await api.newTab({ url, mcpGroupId: id, active: true })).activeTabId!
    }, notesUrl)
    await appWindow.evaluate('window.hronautSettings.setFollowAgentActivity(true)')
    const activeTab = () => appWindow.evaluate(async () => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).activeTabId)
    await expect.poll(activeTab).toBe(person)
    // A new tab starts loading only after its cookies and its turn, so the right-click waits for the notes to load.
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      return page !== undefined && !page.isLoading()
    }, notesUrl)).toBe(true)

    // The person right-clicks in their notes, and Hronaut's page menu opens as it does for them.
    await electronApp.evaluate(({ Menu }) => {
      const scope = globalThis as MenuScope
      const popup = Menu.prototype.popup
      Menu.prototype.popup = function (...args) {
        scope.__pageMenu = this
        return popup.apply(this, args)
      }
      scope.__restorePageMenu = () => { Menu.prototype.popup = popup }
    })
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      page.sendInputEvent({ type: 'mouseDown', button: 'right', x: 60, y: 40, clickCount: 1 })
      page.sendInputEvent({ type: 'mouseUp', button: 'right', x: 60, y: 40, clickCount: 1 })
    }, notesUrl)
    await expect.poll(() => electronApp.evaluate(() => (globalThis as MenuScope).__pageMenu !== undefined)).toBe(true)

    // Longer than following waits after the click: the agent's call leaves the notes in view while the menu is open.
    await appWindow.waitForTimeout(3_500)
    await call(client, 'browser_evaluate', { workspaceId, tabId: agentTabId, script: 'document.title' })
    await appWindow.waitForTimeout(500)
    expect(await activeTab()).toBe(person)

    // Once the menu closes, following waits as after the person's other input, then moves with the agent's next call.
    await electronApp.evaluate(() => { (globalThis as MenuScope).__pageMenu!.closePopup() })
    await call(client, 'browser_evaluate', { workspaceId, tabId: agentTabId, script: 'document.title' })
    await appWindow.waitForTimeout(500)
    expect(await activeTab()).toBe(person)
    await appWindow.waitForTimeout(3_000)
    await call(client, 'browser_evaluate', { workspaceId, tabId: agentTabId, script: 'document.title' })
    await expect.poll(activeTab).toBe(agentTabId)
  } finally {
    await electronApp.evaluate(() => {
      const scope = globalThis as MenuScope
      scope.__pageMenu?.closePopup()
      scope.__restorePageMenu?.()
    }).catch(() => undefined)
    await appWindow.evaluate('window.hronautSettings.setFollowAgentActivity(false)').catch(() => undefined)
    await client.close()
  }
})
