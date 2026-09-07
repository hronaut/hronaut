import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const resultText = (result: CallToolResult): string => {
  const content = result.content.find((entry) => entry.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

test('forks disabled archived workspace data without source access and honors clone revocation', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Workspace fork fixture</title><main>Fork fixture</main>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'arbitrary-workspace-fork', version: '1' })
  const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => await client.callTool({ name, arguments: args }) as CallToolResult
  try {
    const state = await appWindow.evaluate(`window.hronaut.createWorkspace(${JSON.stringify({ name: 'Human restricted source', storage: 'scratch', agentAccess: false, navigationPolicy: { mode: 'restricted', rules: [origin] } })})`) as BrowserState
    const source = state.mcpTabGroups.find((workspace) => workspace.name === 'Human restricted source')!
    expect(source.agentAccess).toBe(false)
    const sourceUrl = `${origin}/source`
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(state.activeTabId)}, url: ${JSON.stringify(sourceUrl)} })`)
    await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((entry) => entry.getURL() === url)
      if (!contents) throw new Error('Missing source page')
      await contents.executeJavaScript("localStorage.setItem('fork-proof', 'original')")
      await contents.session.cookies.set({ url, name: 'fork-cookie', value: 'original', httpOnly: true })
    }, sourceUrl)
    await appWindow.evaluate(`window.hronaut.saveAndCloseTabGroup(${JSON.stringify(source.id)})`)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    const catalog = await call('browser_workspaces', { action: 'list-fork-sources' })
    expect(catalog.isError, resultText(catalog)).not.toBe(true)
    const entry = JSON.parse(resultText(catalog)).find((workspace: { id: string }) => workspace.id === source.id)
    expect(entry).toEqual({ id: source.id, name: source.name, color: source.color, archived: true, agentAccess: false })
    const created = await call('browser_workspaces', { action: 'create', name: 'Isolated agent fork', storage: 'fork-workspace', sourceWorkspaceId: source.id })
    expect(created.isError, resultText(created)).not.toBe(true)
    const fork = JSON.parse(resultText(created)) as { id: string; resumeKey: string; agentAccess: boolean }
    expect(fork.id).not.toBe(source.id)
    expect(fork.agentAccess).toBe(true)
    const afterFork = await appWindow.evaluate('window.hronaut.getState()') as BrowserState
    expect(afterFork.savedTabGroups.find((workspace) => workspace.id === source.id)?.agentAccess).toBe(false)
    expect(afterFork.mcpTabGroups.some((workspace) => workspace.id === source.id)).toBe(false)
    expect(afterFork.tabs.filter((tab) => tab.mcpGroupId === fork.id).map((tab) => tab.url)).toEqual(['about:blank'])
    for (const [tool, args] of [
      ['browser_tabs', { workspaceId: source.id }],
      ['browser_saved_workspaces', { action: 'open', savedWorkspaceId: source.id }]
    ] as const) expect((await call(tool, args)).isError).toBe(true)
    const forkUrl = `${origin}/fork`
    const opened = await call('browser_new_tab', { workspaceId: fork.id, url: forkUrl })
    expect(opened.isError, resultText(opened)).not.toBe(true)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
      webContents.getAllWebContents().some((contents) => contents.getURL() === url && !contents.isLoadingMainFrame())
    ), forkUrl)).toBe(true)
    expect(await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)
      if (!contents) throw new Error('Missing fork page')
      return { value: await contents.executeJavaScript("localStorage.getItem('fork-proof')"), cookies: (await contents.session.cookies.get({ name: 'fork-cookie' })).map((cookie) => cookie.value) }
    }, forkUrl)).toEqual({ value: 'original', cookies: ['original'] })
    expect((await call('browser_new_tab', { workspaceId: fork.id, url: 'https://example.com/' })).isError).toBe(true)
    await appWindow.evaluate(`window.hronaut.updateTabGroup(${JSON.stringify(fork.id)}, { agentAccess: false })`)
    expect((await call('browser_tabs', { workspaceId: fork.id })).isError).toBe(true)
    expect((await call('browser_workspaces', { action: 'resume', workspaceId: fork.id, resumeKey: fork.resumeKey })).isError).toBe(true)
    await appWindow.evaluate(`window.hronaut.updateTabGroup(${JSON.stringify(fork.id)}, { agentAccess: true })`)
    expect((await call('browser_tabs', { workspaceId: fork.id })).isError).not.toBe(true)
  } finally {
    await client.close()
    await closeFixtureServer(server)
  }
})
