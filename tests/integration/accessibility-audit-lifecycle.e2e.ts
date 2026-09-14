import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('rejects an accessibility audit result captured before tab navigation', async ({ electronApp, mcpPort, mcpToken }) => {
  const fixture = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>${request.url === '/after' ? 'After' : 'Before'} audit</title><main><button></button></main>`)
  })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'accessibility-audit-lifecycle', version: '1' })
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  const decode = <T>(result: CallToolResult): T => {
    expect(result.isError).not.toBe(true)
    return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as T
  }
  let pending: Promise<CallToolResult> | undefined
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const workspace = decode<{ id: string }>(await call('browser_workspaces', {
      action: 'create', storage: 'scratch', name: 'Accessibility audit lifecycle'
    }))
    const state = decode<BrowserState>(await call('browser_new_tab', { workspaceId: workspace.id, url: `${origin}/before` }))
    const tabId = state.activeTabId!
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
      webContents.getAllWebContents().some(page => page.getURL() === url && !page.isLoading())
    ), `${origin}/before`)).toBe(true)
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      const original = page.executeJavaScriptInIsolatedWorld
      const state = globalThis as typeof globalThis & {
        __accessibilityAuditHeld?: boolean
        __accessibilityAuditRelease?: () => void
        __accessibilityAuditRestore?: () => void
      }
      state.__accessibilityAuditRestore = () => { page.executeJavaScriptInIsolatedWorld = original }
      page.executeJavaScriptInIsolatedWorld = async function (...args) {
        const value = await original.apply(this, args)
        if (args[0] !== 1001) return value
        page.executeJavaScriptInIsolatedWorld = original
        state.__accessibilityAuditHeld = true
        await new Promise<void>(resolve => { state.__accessibilityAuditRelease = resolve })
        return value
      }
    }, `${origin}/before`)

    pending = call('browser_accessibility_audit', { workspaceId: workspace.id, tabId })
    await expect.poll(() => electronApp.evaluate(() => (
      Boolean((globalThis as typeof globalThis & { __accessibilityAuditHeld?: boolean }).__accessibilityAuditHeld)
    ))).toBe(true)
    await electronApp.evaluate(async ({ webContents }, input) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === input.before)
      if (!page) throw new Error('Missing accessibility fixture page')
      await page.loadURL(input.after)
    }, { before: `${origin}/before`, after: `${origin}/after` })
    await electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __accessibilityAuditRelease?: () => void }).__accessibilityAuditRelease?.()
    ))

    const stale = await pending
    expect(stale.isError).toBe(true)
    expect(stale.content.filter(part => part.type === 'text').map(part => part.text).join('\n')).toContain('changed during the accessibility audit')
  } finally {
    await electronApp.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        __accessibilityAuditHeld?: boolean
        __accessibilityAuditRelease?: () => void
        __accessibilityAuditRestore?: () => void
      }
      state.__accessibilityAuditRelease?.()
      state.__accessibilityAuditRestore?.()
      delete state.__accessibilityAuditHeld
      delete state.__accessibilityAuditRelease
      delete state.__accessibilityAuditRestore
    })
    await pending?.catch(() => undefined)
    await client.close()
    await closeFixtureServer(fixture)
  }
})
