import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  return result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
}

test('rejects stale snapshot and memory baselines after newer lifecycle changes', async ({
  appWindow,
  electronApp,
  mcpPort,
  mcpToken
}) => {
  const fixture = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><html lang="en"><title>Baseline lifecycle ${request.url}</title><main><button>Ready</button></main></html>`)
  })
  await new Promise<void>((resolve, reject) => {
    fixture.once('error', reject)
    fixture.listen(0, '127.0.0.1', resolve)
  })
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Baseline lifecycle fixture did not expose a port')
  const url = `http://127.0.0.1:${address.port}/`
  const client = new Client({ name: 'snapshot-memory-baseline-lifecycle', version: '1' })
  const call = (name: string, args: Record<string, unknown>) => (
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  )
  let pending: Promise<CallToolResult> | undefined

  const holdSnapshot = async (targetUrl: string): Promise<void> => {
    await electronApp.evaluate(({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === requestedUrl)
      if (!page) throw new Error('Baseline lifecycle page was not found')
      const original = page.executeJavaScript.bind(page)
      let intercept = true
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const state = {
        held: false,
        release,
        restore: () => { page.executeJavaScript = original }
      }
      ;(globalThis as typeof globalThis & { __hronautBaselineCapture?: typeof state }).__hronautBaselineCapture = state
      page.executeJavaScript = async (code: string, userGesture?: boolean) => {
        const value = await original(code, userGesture)
        if (!intercept || !code.includes('const MAX_CHARS =')) return value
        intercept = false
        state.held = true
        await gate
        page.executeJavaScript = original
        return value
      }
    }, targetUrl)
  }
  const holdMemory = async (targetUrl: string): Promise<void> => {
    await electronApp.evaluate(({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === requestedUrl)
      if (!page) throw new Error('Baseline lifecycle page was not found')
      const original = page.debugger.sendCommand.bind(page.debugger)
      let intercept = true
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const state = {
        held: false,
        release,
        restore: () => { page.debugger.sendCommand = original }
      }
      ;(globalThis as typeof globalThis & { __hronautBaselineCapture?: typeof state }).__hronautBaselineCapture = state
      page.debugger.sendCommand = async (...args: Parameters<typeof page.debugger.sendCommand>) => {
        const value = await original(...args)
        if (!intercept || args[0] !== 'Performance.getMetrics') return value
        intercept = false
        state.held = true
        await gate
        page.debugger.sendCommand = original
        return value
      }
    }, targetUrl)
  }
  const waitForHeldCapture = async (): Promise<void> => {
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautBaselineCapture?: { held: boolean } })
        .__hronautBaselineCapture?.held === true
    ))).toBe(true)
  }
  const releaseCapture = async (): Promise<void> => {
    await electronApp.evaluate(() => {
      ;(globalThis as typeof globalThis & { __hronautBaselineCapture?: { release: () => void } })
        .__hronautBaselineCapture?.release()
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
      action: 'create', storage: 'scratch', name: 'Snapshot and memory baseline lifecycle'
    }))) as { id: string }
    const state = JSON.parse(text(await call('browser_new_tab', {
      workspaceId: workspace.id,
      url
    }))) as BrowserState
    const tabId = state.activeTabId!
    await expect.poll(() => electronApp.evaluate(({ webContents }, targetUrl) => (
      webContents.getAllWebContents().some(page => page.getURL() === targetUrl && !page.isLoading())
    ), url)).toBe(true)

    await holdSnapshot(url)
    pending = call('browser_snapshot', {
      workspaceId: workspace.id,
      tabId,
      action: 'set-baseline'
    })
    await waitForHeldCapture()
    const clearedSnapshot = await call('browser_snapshot', {
      workspaceId: workspace.id,
      tabId,
      action: 'clear-baseline'
    })
    expect(clearedSnapshot.isError, text(clearedSnapshot)).not.toBe(true)
    expect(clearedSnapshot.structuredContent).toMatchObject({ cleared: false, baselineId: null })
    await releaseCapture()
    const obsoleteSnapshot = await pending
    expect(obsoleteSnapshot.isError).toBe(true)
    expect(text(obsoleteSnapshot)).toContain('Snapshot baseline changed while capture was pending')
    const snapshotState = await call('browser_snapshot', {
      workspaceId: workspace.id,
      tabId,
      action: 'clear-baseline'
    })
    expect(snapshotState.structuredContent).toMatchObject({ cleared: false, baselineId: null })

    const activeSnapshot = await call('browser_snapshot', {
      workspaceId: workspace.id,
      tabId,
      action: 'set-baseline'
    })
    expect(activeSnapshot.isError, text(activeSnapshot)).not.toBe(true)
    const baselineId = (activeSnapshot.structuredContent as { baselineId: string }).baselineId
    await holdSnapshot(url)
    pending = call('browser_snapshot', {
      workspaceId: workspace.id,
      tabId,
      action: 'delta',
      baselineId
    })
    await waitForHeldCapture()
    const clearedDuringDelta = await call('browser_snapshot', {
      workspaceId: workspace.id,
      tabId,
      action: 'clear-baseline',
      baselineId
    })
    expect(clearedDuringDelta.structuredContent).toMatchObject({ cleared: true, baselineId })
    await releaseCapture()
    const obsoleteDelta = await pending
    expect(obsoleteDelta.isError).toBe(true)
    expect(text(obsoleteDelta)).toContain('Snapshot baseline changed while delta capture was pending')

    await holdMemory(url)
    pending = call('browser_memory', {
      workspaceId: workspace.id,
      tabId,
      action: 'set-baseline'
    })
    await waitForHeldCapture()
    const clearedMemory = await appWindow.evaluate(
      `window.hronaut.measureMemory({ tabId: ${JSON.stringify(tabId)}, action: 'clear-baseline' })`
    )
    expect(clearedMemory).toMatchObject({ action: 'clear-baseline', cleared: false })
    await releaseCapture()
    const obsoleteMemory = await pending
    expect(obsoleteMemory.isError).toBe(true)
    expect(text(obsoleteMemory)).toContain('Memory baseline changed while the measurement was pending')
    const currentMemory = await call('browser_memory', {
      workspaceId: workspace.id,
      tabId,
      action: 'measure'
    })
    expect(currentMemory.isError, text(currentMemory)).not.toBe(true)
    expect(JSON.parse(text(currentMemory))).not.toHaveProperty('baseline')

    await holdMemory(url)
    pending = call('browser_memory', {
      workspaceId: workspace.id,
      tabId,
      action: 'measure'
    })
    await waitForHeldCapture()
    const navigatedUrl = `${url}?navigated=1`
    await appWindow.evaluate(
      `window.hronaut.navigate({ tabId: ${JSON.stringify(tabId)}, url: ${JSON.stringify(navigatedUrl)} })`
    )
    await releaseCapture()
    const obsoleteMemoryNavigation = await pending
    expect(obsoleteMemoryNavigation.isError).toBe(true)
    expect(text(obsoleteMemoryNavigation)).toContain('The page changed during the memory measurement')
  } finally {
    await electronApp.evaluate(() => {
      const mainGlobal = globalThis as typeof globalThis & {
        __hronautBaselineCapture?: { release: () => void; restore: () => void }
      }
      mainGlobal.__hronautBaselineCapture?.release()
      mainGlobal.__hronautBaselineCapture?.restore()
      delete mainGlobal.__hronautBaselineCapture
    })
    await pending?.catch(() => undefined)
    await client.close().catch(() => undefined)
    await closeFixtureServer(fixture)
  }
})
