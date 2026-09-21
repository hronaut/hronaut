import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  return result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
}

test('rejects stale audit results after baseline changes or navigation', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><html lang="en"><title>Audit baseline lifecycle</title><main><button>Ready</button></main></html>')
  })
  await new Promise<void>((resolve, reject) => {
    fixture.once('error', reject)
    fixture.listen(0, '127.0.0.1', resolve)
  })
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Audit baseline fixture did not expose a port')
  const url = `http://127.0.0.1:${address.port}/`
  const client = new Client({ name: 'audit-baseline-lifecycle', version: '1' })
  const call = (name: string, args: Record<string, unknown>) => (
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  )
  let pendingAudit: Promise<CallToolResult> | undefined

  const holdAuditWorld = async (worldId: number): Promise<void> => {
    await electronApp.evaluate(({ webContents }, input) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === input.url)
      if (!page) throw new Error('Audit baseline fixture page was not found')
      const originalExecute = page.executeJavaScriptInIsolatedWorld
      let intercept = true
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const state = {
        held: false,
        release,
        restore: () => { page.executeJavaScriptInIsolatedWorld = originalExecute }
      }
      ;(globalThis as typeof globalThis & { __hronautAuditCapture?: typeof state }).__hronautAuditCapture = state
      page.executeJavaScriptInIsolatedWorld = async function (...args) {
        const value = await originalExecute.apply(this, args)
        if (!intercept || args[0] !== input.worldId) return value
        intercept = false
        state.held = true
        await gate
        page.executeJavaScriptInIsolatedWorld = originalExecute
        return value
      }
    }, { url, worldId })
  }
  const waitForHeldAudit = async (): Promise<void> => {
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautAuditCapture?: { held: boolean } })
        .__hronautAuditCapture?.held === true
    ))).toBe(true)
  }
  const releaseAudit = async (): Promise<void> => {
    await electronApp.evaluate(() => {
      ;(globalThis as typeof globalThis & { __hronautAuditCapture?: { release: () => void } })
        .__hronautAuditCapture?.release()
    })
  }

  try {
    await expect.poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, {
          headers: { authorization: `Bearer ${mcpToken}` }
        })).ok
      } catch {
        return false
      }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const workspace = JSON.parse(text(await call('browser_workspaces', {
      action: 'create', storage: 'scratch', name: 'Audit baseline lifecycle'
    }))) as { id: string }
    const state = JSON.parse(text(await call('browser_new_tab', {
      workspaceId: workspace.id,
      url
    }))) as BrowserState
    const tabId = state.activeTabId!
    await expect.poll(() => electronApp.evaluate(({ webContents }, targetUrl) => (
      webContents.getAllWebContents().some(page => page.getURL() === targetUrl && !page.isLoading())
    ), url)).toBe(true)

    await holdAuditWorld(1001)
    pendingAudit = call('browser_accessibility_audit', {
      workspaceId: workspace.id,
      tabId,
      action: 'set-baseline'
    })
    await waitForHeldAudit()
    const clearedAccessibility = await appWindow.evaluate(
      `window.hronaut.runAccessibilityAudit({ tabId: ${JSON.stringify(tabId)}, action: 'clear-baseline' })`
    )
    expect(clearedAccessibility).toMatchObject({ action: 'clear-baseline', baselineCleared: false })
    await releaseAudit()
    const obsoleteAccessibility = await pendingAudit
    expect(obsoleteAccessibility.isError).toBe(true)
    expect(text(obsoleteAccessibility)).toContain('Accessibility baseline changed while the audit was pending')
    const currentAccessibility = await call('browser_accessibility_audit', {
      workspaceId: workspace.id,
      tabId,
      action: 'measure'
    })
    expect(currentAccessibility.isError, text(currentAccessibility)).not.toBe(true)
    expect(JSON.parse(text(currentAccessibility))).not.toHaveProperty('baseline')

    await holdAuditWorld(1002)
    pendingAudit = call('browser_performance', {
      workspaceId: workspace.id,
      tabId,
      action: 'set-baseline',
      settleMs: 0
    })
    await waitForHeldAudit()
    const clearedPerformance = await appWindow.evaluate(
      `window.hronaut.measurePerformance({ tabId: ${JSON.stringify(tabId)}, action: 'clear-baseline', settleMs: 0 })`
    )
    expect(clearedPerformance).toMatchObject({ action: 'clear-baseline', baselineCleared: false })
    await releaseAudit()
    const obsoletePerformance = await pendingAudit
    expect(obsoletePerformance.isError).toBe(true)
    expect(text(obsoletePerformance)).toContain('Performance baseline changed while the measurement was pending')
    const currentPerformance = await call('browser_performance', {
      workspaceId: workspace.id,
      tabId,
      action: 'measure',
      settleMs: 0
    })
    expect(currentPerformance.isError, text(currentPerformance)).not.toBe(true)
    expect(JSON.parse(text(currentPerformance))).not.toHaveProperty('baseline')

    await holdAuditWorld(1002)
    pendingAudit = call('browser_performance', {
      workspaceId: workspace.id,
      tabId,
      action: 'measure',
      settleMs: 0
    })
    await waitForHeldAudit()
    await appWindow.evaluate(
      `window.hronaut.navigate({ tabId: ${JSON.stringify(tabId)}, url: ${JSON.stringify(`${url}?navigated=1`)} })`
    )
    await releaseAudit()
    const obsoleteNavigationMeasurement = await pendingAudit
    expect(obsoleteNavigationMeasurement.isError).toBe(true)
    expect(text(obsoleteNavigationMeasurement)).toContain(
      'The page changed during the performance measurement'
    )
  } finally {
    await electronApp.evaluate(() => {
      const mainGlobal = globalThis as typeof globalThis & {
        __hronautAuditCapture?: { release: () => void; restore: () => void }
      }
      mainGlobal.__hronautAuditCapture?.release()
      mainGlobal.__hronautAuditCapture?.restore()
      delete mainGlobal.__hronautAuditCapture
    })
    await pendingAudit?.catch(() => undefined)
    await client.close().catch(() => undefined)
    await closeFixtureServer(fixture)
  }
})
