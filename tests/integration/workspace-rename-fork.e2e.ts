import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  return result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n')
}

test('allows agent fork and scratch creation after a human renames a protected workspace', async ({
  appWindow, electronApp, mcpPort, mcpToken
}) => {
  const seedState = await appWindow.evaluate(`window.hronaut.createWorkspace({
    name: 'Empty seed', storage: 'scratch', agentAccess: true
  })`) as BrowserState
  const seed = seedState.mcpTabGroups.find((workspace: { name: string }) => workspace.name === 'Empty seed')!
  const origins = Array.from({ length: 17 }, (_, index) => `https://site.example${index}.test`)
  const created = await appWindow.evaluate(`window.hronaut.createWorkspace({
    name: 'Original source', storage: 'fork-workspace', sourceWorkspaceId: ${JSON.stringify(seed.id)},
    origins: ${JSON.stringify(origins)}, agentAccess: true, deletionProtected: true
  })`) as BrowserState
  const source = created.mcpTabGroups.find((workspace: { name: string }) => workspace.name === 'Original source')!
  const server = createServer((request, response) => {
    if (request.url === '/sw.js') {
      response.writeHead(200, { 'content-type': 'text/javascript', 'service-worker-allowed': '/' })
      response.end(`self.addEventListener('install', () => self.skipWaiting());
        self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
        self.addEventListener('fetch', (event) => event.respondWith(new Response('<!doctype html><title>Worker page</title>',
          { headers: { 'Content-Type': 'text/html' } })));`)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Source page</title>')
  })
  const client = new Client({ name: 'rename-fork-reproduction', version: '1.0.0' })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    const sourceUrl = `http://127.0.0.1:${address.port}/source`
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(source.activeTabId)}, url: ${JSON.stringify(sourceUrl)} })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) =>
      webContents.getAllWebContents().some((contents) => contents.getURL() === url && !contents.isLoadingMainFrame()), sourceUrl))
      .toBe(true)
    await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((entry) => entry.getURL() === url)
      if (!contents) throw new Error('Missing source contents')
      await contents.executeJavaScript(`(async () => {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
          await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
        }
      })()`)
      const cookies = contents.session.cookies
      for (let index = 0; index < 219; index += 1) {
        await cookies.set({
          url: `https://site.example${index % 17}.test/`,
          name: `fixture-${index}`,
          value: `value-${index}`,
          httpOnly: index % 2 === 0
        })
      }
      const cookieCount = (await cookies.get({})).length
      if (cookieCount !== 219) throw new Error(`Expected 219 source cookies, found ${cookieCount}`)
    }, sourceUrl)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    await electronApp.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __renameTestMenu?: Electron.Menu }).__renameTestMenu = this
      }
    })
    await appWindow.locator('.tab-group-label', { hasText: 'Original source' }).click({ button: 'right' })
    await electronApp.evaluate(() => {
      const menu = (globalThis as typeof globalThis & { __renameTestMenu?: Electron.Menu }).__renameTestMenu
      const item = menu?.getMenuItemById('edit-workspace')
      if (!item?.click) throw new Error('Edit workspace action unavailable')
      ;(item.click as unknown as () => void)()
    })
    const editor = appWindow.getByRole('dialog', { name: 'Edit workspace' })
    await editor.getByLabel('Workspace name').fill('Hronaut (main)')
    await editor.getByRole('button', { name: 'Save changes' }).click()
    await expect(editor).toBeHidden()
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) =>
      state.mcpTabGroups.find((workspace) => workspace.id === ${JSON.stringify(source.id)})?.name)`))
      .toBe('Hronaut (main)')

    const sources = await client.callTool({ name: 'browser_workspaces', arguments: { action: 'list-fork-sources' } }) as CallToolResult
    expect(sources.isError, text(sources)).not.toBe(true)
    expect(JSON.parse(text(sources))).toContainEqual(expect.objectContaining({ id: source.id, name: 'Hronaut (main)', agentAccess: true }))
    const fork = await client.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'create', name: 'Agent fork', storage: 'fork-workspace', sourceWorkspaceId: source.id }
    }) as CallToolResult
    expect(fork.isError, text(fork)).not.toBe(true)
    expect(JSON.parse(text(fork))).toMatchObject({ name: 'Agent fork', agentAccess: true })
    const scratch = await client.callTool({
      name: 'browser_workspaces', arguments: { action: 'create', name: 'Agent scratch', storage: 'scratch' }
    }) as CallToolResult
    expect(scratch.isError, text(scratch)).not.toBe(true)
    expect(JSON.parse(text(scratch))).toMatchObject({ name: 'Agent scratch', agentAccess: true })
  } finally {
    try { await client.close() } finally { await closeFixtureServer(server) }
  }
})
