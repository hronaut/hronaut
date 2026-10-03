import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
import type { PersistedBrowserState } from '../../src/main/browser/tab-store.js'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

async function connect(profile: string, port: number): Promise<Client> {
  const token = (await readFile(join(profile, 'mcp-token'), 'utf8')).trim()
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/healthz`)).ok } catch { return false }
  }).toBe(true)
  const client = new Client({ name: 'workspace-selection-restart', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } }
  }))
  return client
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name, arguments: args }) as CallToolResult
  const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
  expect(result.isError, text).not.toBe(true)
  return text
}

for (const homeState of ['closed', 'background', 'active'] as const) {
  test(`restores each workspace selection with Home ${homeState}`, async ({ profileDirectory, mcpPort }) => {
    const server = createServer((request, response) => {
      const title = request.url === '/a2' ? 'Selection A2' : request.url === '/a1' ? 'Selection A1' : 'Selection B1'
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
      response.end(`<!doctype html><title>${title}</title><h1>${title}</h1>`)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture server')
    const origin = `http://127.0.0.1:${address.port}`
    let instance = await launchHronaut(profileDirectory, mcpPort)
    let client: Client | undefined
    try {
      client = await connect(profileDirectory, mcpPort)
      const a = JSON.parse(await call(client, 'browser_workspaces', { action: 'create', name: 'Workspace A' })) as { id: string; resumeKey: string }
      const b = JSON.parse(await call(client, 'browser_workspaces', { action: 'create', name: 'Workspace B' })) as { id: string }
      const open = async (workspaceId: string, path: string): Promise<string> => {
        const state = JSON.parse(await call(client!, 'browser_new_tab', { workspaceId, url: `${origin}/${path}`, active: true })) as BrowserState
        await call(client!, 'browser_wait', { workspaceId, tabId: state.activeTabId, selector: 'h1' })
        return state.activeTabId!
      }
      const a1 = await open(a.id, 'a1')
      const a2 = await open(a.id, 'a2')
      const b1 = await open(b.id, 'b1')
      await instance.window.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), b1)
      const before = await instance.window.evaluate('window.hronaut.getState()') as BrowserState
      const homeId = before.tabs.find(tab => tab.url.startsWith('hronaut://home'))!.id
      if (homeState === 'closed') await instance.window.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), homeId)
      if (homeState === 'active') await instance.window.evaluate('window.hronaut.openHome()')
      const globalId = homeState === 'active' ? homeId : b1
      await client.close()
      client = undefined
      const child = instance.app.process()
      await closeHronaut(instance.app)
      expect(child.exitCode).toBe(0)
      const saved = JSON.parse(await readFile(join(profileDirectory, 'tabs.json'), 'utf8')) as PersistedBrowserState
      expect(saved.tabs.map(tab => tab.id)).toEqual(homeState === 'closed' ? [a1, a2, b1] : [homeId, a1, a2, b1])
      expect(saved.activeTabId).toBe(globalId)
      expect(saved.mcpTabGroups?.find(group => group.id === a.id)?.activeTabId).toBe(a2)
      instance = await launchHronaut(profileDirectory, mcpPort)
      const restored = await instance.window.evaluate('window.hronaut.getState()') as BrowserState
      expect.soft(restored.activeTabId).toBe(globalId)
      expect.soft(restored.mcpTabGroups.find(group => group.id === a.id)?.activeTabId).toBe(a2)
      expect(restored.mcpTabGroups.find(group => group.id === b.id)?.activeTabId).toBe(b1)
      // A fresh MCP connection must resume authority; omitted-tab reads then use
      // the remembered selection inside A, without selecting A globally.
      client = await connect(profileDirectory, mcpPort)
      await call(client, 'browser_workspaces', { action: 'resume', workspaceId: a.id, resumeKey: a.resumeKey })
      const snapshot = await call(client, 'browser_snapshot', { workspaceId: a.id })
      expect.soft(snapshot).toContain('Selection A2')
      expect.soft(snapshot).not.toContain('Selection A1')
      expect((await instance.window.evaluate('window.hronaut.getState()') as BrowserState).activeTabId).toBe(globalId)
      await instance.window.evaluate('window.hronaut.openHome()')
      await expect.poll(() => instance.app.context().pages().some(page => page.url().startsWith('hronaut://home'))).toBe(true)
      const home = instance.app.context().pages().find(page => page.url().startsWith('hronaut://home'))!
      await home.getByRole('article', { name: 'Workspace A', exact: true }).getByRole('button', { name: 'Open workspace', exact: true }).click()
      expect((await instance.window.evaluate('window.hronaut.getState()') as BrowserState).activeTabId).toBe(a2)
    } finally {
      await client?.close()
      await closeHronaut(instance.app)
      await closeFixtureServer(server)
    }
  })
}

for (const selection of ['missing-workspace', 'missing-global', 'invalid-workspace', 'other-workspace', 'invalid-global', 'empty'] as const) {
  test(`keeps startup fallback behavior for ${selection} selection`, async ({ profileDirectory }) => {
    let instance = await launchHronaut(profileDirectory)
    try {
      const ids = await instance.window.evaluate(async () => {
        const browser = (window as unknown as { hronaut: HronautApi }).hronaut
        let state = await browser.createWorkspace({ name: 'Fallback A', storage: 'scratch' })
        const a = state.mcpTabGroups.find(group => group.name === 'Fallback A')!.id
        const a1 = state.activeTabId!
        state = await browser.newTab({ mcpGroupId: a, url: 'about:blank', active: true })
        const a2 = state.activeTabId!
        state = await browser.createWorkspace({ name: 'Fallback B', storage: 'scratch' })
        const b1 = state.activeTabId!
        await browser.closeTab(state.tabs.find(tab => tab.url.startsWith('hronaut://home'))!.id)
        return { a, a1, a2, b1 }
      })
      await closeHronaut(instance.app)
      const path = join(profileDirectory, 'tabs.json')
      const saved = JSON.parse(await readFile(path, 'utf8')) as PersistedBrowserState
      const group = saved.mcpTabGroups!.find(group => group.id === ids.a)!
      if (selection === 'missing-workspace') delete group.activeTabId
      if (selection === 'missing-global') saved.activeTabId = null
      if (selection === 'invalid-workspace') group.activeTabId = '01912345-6789-7abc-8def-0123456789ab'
      if (selection === 'other-workspace') group.activeTabId = ids.b1
      if (selection === 'invalid-global') saved.activeTabId = '01912345-6789-7abc-8def-0123456789ab'
      if (selection === 'empty') {
        saved.tabs = []
        saved.mcpTabGroups = []
        saved.activeTabId = null
      }
      await writeFile(path, JSON.stringify(saved))
      instance = await launchHronaut(profileDirectory)
      const restored = await instance.window.evaluate('window.hronaut.getState()') as BrowserState
      if (selection === 'missing-workspace' || selection === 'missing-global') {
        expect(restored.tabs.map(tab => tab.id)).toEqual([ids.a1, ids.a2, ids.b1])
        expect(restored.mcpTabGroups.find(group => group.id === ids.a)?.activeTabId).toBe(ids.a1)
        expect(restored.activeTabId).toBe(selection === 'missing-global' ? ids.a1 : ids.b1)
      } else {
        // Invalid persisted identities still reject the saved layout; startup
        // creates Home rather than selecting an unrelated tab or workspace.
        expect(restored.mcpTabGroups).toEqual([])
        expect(restored.tabs).toEqual([expect.objectContaining({ url: 'hronaut://home/', active: true })])
        expect(restored.activeTabId).toBe(restored.tabs[0]!.id)
      }
    } finally {
      await closeHronaut(instance.app)
    }
  })
}
