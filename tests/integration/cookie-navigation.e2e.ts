import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

async function connectClient(port: number, token: string): Promise<Client> {
  await expect.poll(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/healthz`, {
        headers: { authorization: `Bearer ${token}` }
      })).ok
    } catch {
      return false
    }
  }).toBe(true)
  const client = new Client({ name: 'cookie-navigation-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } }
  }))
  return client
}

for (const action of ['list', 'set'] as const) {
  test(`keeps cookie ${action} scoped to the original origin during navigation`, async ({ electronApp, mcpPort, mcpToken }) => {
    const beforeServer = createServer((_request, response) => response.end('<!doctype html><title>Before</title>'))
    const afterServer = createServer((_request, response) => response.end('<!doctype html><title>After</title>'))
    await new Promise<void>(resolve => beforeServer.listen(0, '127.0.0.1', resolve))
    await new Promise<void>(resolve => afterServer.listen(0, '127.0.0.2', resolve))
    const beforeOrigin = `http://127.0.0.1:${(beforeServer.address() as AddressInfo).port}`
    const afterOrigin = `http://127.0.0.2:${(afterServer.address() as AddressInfo).port}`
    const client = await connectClient(mcpPort, mcpToken)
    const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
    try {
      const workspace = await call('browser_workspaces', { action: 'create', name: 'Cookie navigation', storage: 'scratch' })
      expect(workspace.isError, text(workspace)).not.toBe(true)
      const workspaceId = (JSON.parse(text(workspace)) as { id: string }).id
      const opened = await call('browser_new_tab', { workspaceId, url: `${beforeOrigin}/before` })
      expect(opened.isError, text(opened)).not.toBe(true)
      const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
      await expect.poll(() => electronApp.evaluate(({ webContents }, origin) => webContents.getAllWebContents()
        .some(page => page.getURL() === `${origin}/before` && !page.isLoading()), beforeOrigin)).toBe(true)
      await electronApp.evaluate(async ({ webContents }, { beforeOrigin, afterOrigin }) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === `${beforeOrigin}/before`)!
        const store = page.session.cookies
        await store.set({ url: beforeOrigin, name: 'marker', value: 'original-site', path: '/' })
        await store.set({ url: afterOrigin, name: 'marker', value: 'destination-site', path: '/' })
        const original = store.get
        const state = globalThis as typeof globalThis & { __cookieRestore?: () => void }
        state.__cookieRestore = () => { store.get = original }
        store.get = async function (...args) {
          const result = await original.apply(this, args)
          if (args[0].url === `${beforeOrigin}/before`) {
            state.__cookieRestore?.()
            await page.loadURL(`${afterOrigin}/after`)
          }
          return result
        }
      }, { beforeOrigin, afterOrigin })
      const result = await call('browser_storage', {
        workspaceId, tabId, kind: 'cookies', action, includeValues: true,
        ...(action === 'set' ? { key: 'written', value: 'original-write' } : {})
      })
      expect(result.isError, text(result)).not.toBe(true)
      const report = JSON.parse(text(result)) as { items: Array<{ key: string; value: string }> }
      expect(report).toMatchObject({ url: `${beforeOrigin}/before`, origin: beforeOrigin })
      expect(report.items).toContainEqual(expect.objectContaining({ key: 'marker', value: 'original-site' }))
      expect(text(result)).not.toContain('destination-site')
      if (action === 'set') {
        expect(report).toMatchObject({ changed: true })
        expect(report.items).toContainEqual(expect.objectContaining({ key: 'written', value: 'original-write' }))
      }
      const fresh = await call('browser_storage', { workspaceId, tabId, kind: 'cookies', action: 'list', includeValues: true })
      expect(fresh.isError, text(fresh)).not.toBe(true)
      expect(JSON.parse(text(fresh))).toMatchObject({ url: `${afterOrigin}/after`, origin: afterOrigin })
      expect(text(fresh)).toContain('destination-site')
      expect(text(fresh)).not.toContain('original-write')
    } finally {
      await electronApp.evaluate(() => {
        const state = globalThis as typeof globalThis & { __cookieRestore?: () => void }
        state.__cookieRestore?.()
        delete state.__cookieRestore
      })
      await client.close()
      await closeFixtureServer(beforeServer)
      await closeFixtureServer(afterServer)
    }
  })
}
