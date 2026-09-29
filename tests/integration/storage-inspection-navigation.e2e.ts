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
  const client = new Client({ name: 'storage-inspection-navigation-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } }
  }))
  return client
}

for (const stage of ['IndexedDB', 'quota', 'quota fallback'] as const) {
  test(`rejects storage inspection when navigation occurs during ${stage}`, async ({ electronApp, mcpPort, mcpToken }) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>Storage navigation fixture</title><main>Ready</main>')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const client = await connectClient(mcpPort, mcpToken)
    const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
    try {
      const workspace = await call('browser_workspaces', { action: 'create', name: 'Storage navigation', storage: 'scratch' })
      expect(workspace.isError, text(workspace)).not.toBe(true)
      const workspaceId = (JSON.parse(text(workspace)) as { id: string }).id
      const opened = await call('browser_new_tab', { workspaceId, url: `${origin}/before` })
      expect(opened.isError, text(opened)).not.toBe(true)
      const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
      await expect.poll(() => electronApp.evaluate(({ webContents }, origin) => webContents.getAllWebContents()
        .some(page => page.getURL() === `${origin}/before` && !page.isLoading()), origin)).toBe(true)
      await electronApp.evaluate(({ webContents }, { origin, stage }) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === `${origin}/before`)!
        const state = globalThis as typeof globalThis & { __storageRestore?: () => void }
        const originalScript = page.executeJavaScriptInIsolatedWorld
        const originalCommand = page.debugger.sendCommand
        state.__storageRestore = () => {
          page.executeJavaScriptInIsolatedWorld = originalScript
          page.debugger.sendCommand = originalCommand
        }
        page.executeJavaScriptInIsolatedWorld = async function (...args) {
          const result = await originalScript.apply(this, args)
          if ((stage === 'IndexedDB' && args[0] === 1007)
            || (stage === 'quota fallback' && args[0] === 1009)) {
            state.__storageRestore?.()
            await page.loadURL(`${origin}/after`)
          }
          return result
        }
        page.debugger.sendCommand = async function (...args) {
          if (stage === 'quota fallback' && args[0] === 'Storage.getUsageAndQuota') {
            throw new Error('Simulated unavailable quota diagnostics')
          }
          const result = await originalCommand.apply(this, args)
          if (stage === 'quota' && args[0] === 'Storage.getUsageAndQuota') {
            state.__storageRestore?.()
            await page.loadURL(`${origin}/after`)
          }
          return result
        }
      }, { origin, stage })
      const tool = stage === 'IndexedDB' ? 'browser_indexeddb' : 'browser_storage_usage'
      const stale = await call(tool, { workspaceId, tabId })
      expect(stale.isError, text(stale)).toBe(true)
      expect(text(stale)).toContain(`The page changed during ${stage === 'IndexedDB' ? 'IndexedDB' : 'storage usage'} inspection`)
      const fresh = await call(tool, { workspaceId, tabId })
      expect(fresh.isError, text(fresh)).not.toBe(true)
      expect(JSON.parse(text(fresh))).toMatchObject({ url: `${origin}/after`, origin })
    } finally {
      await electronApp.evaluate(() => {
        const state = globalThis as typeof globalThis & { __storageRestore?: () => void }
        state.__storageRestore?.()
        delete state.__storageRestore
      })
      await client.close()
      await closeFixtureServer(server)
    }
  })
}
