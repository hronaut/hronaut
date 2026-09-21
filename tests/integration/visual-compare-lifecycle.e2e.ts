import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  return result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
}

test('does not restore a visual baseline captured before a newer clear', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Visual comparison lifecycle</title><main>Baseline target</main>')
  })
  await new Promise<void>((resolve, reject) => {
    fixture.once('error', reject)
    fixture.listen(0, '127.0.0.1', resolve)
  })
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Visual comparison fixture did not expose a port')
  const url = `http://127.0.0.1:${address.port}/`
  const client = new Client({ name: 'visual-comparison-lifecycle', version: '1' })
  const call = (name: string, args: Record<string, unknown>) => (
    client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  )
  let pendingBaseline: Promise<CallToolResult> | undefined

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
      action: 'create', storage: 'scratch', name: 'Visual comparison lifecycle'
    }))) as { id: string }
    const state = JSON.parse(text(await call('browser_new_tab', {
      workspaceId: workspace.id,
      url
    }))) as BrowserState
    const tabId = state.activeTabId!
    await expect.poll(() => electronApp.evaluate(({ webContents }, targetUrl) => (
      webContents.getAllWebContents().some(page => page.getURL() === targetUrl && !page.isLoading())
    ), url)).toBe(true)

    await electronApp.evaluate(({ webContents }, targetUrl) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === targetUrl)
      if (!page) throw new Error('Visual comparison fixture page was not found')
      const originalCapturePage = page.capturePage.bind(page)
      const mainGlobal = globalThis as typeof globalThis & {
        __hronautVisualCaptureHeld?: boolean
        __hronautReleaseVisualCapture?: () => void
        __hronautRestoreVisualCapture?: () => void
      }
      let releaseCapture!: () => void
      const gate = new Promise<void>((resolve) => { releaseCapture = resolve })
      mainGlobal.__hronautVisualCaptureHeld = false
      mainGlobal.__hronautReleaseVisualCapture = releaseCapture
      mainGlobal.__hronautRestoreVisualCapture = () => { page.capturePage = originalCapturePage }
      page.capturePage = async (...args: Parameters<Electron.WebContents['capturePage']>) => {
        const image = await originalCapturePage(...args)
        mainGlobal.__hronautVisualCaptureHeld = true
        await gate
        page.capturePage = originalCapturePage
        return image
      }
    }, url)

    pendingBaseline = call('browser_visual_compare', {
      workspaceId: workspace.id,
      tabId,
      action: 'set-baseline',
      settleMs: 0
    })
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautVisualCaptureHeld?: boolean }).__hronautVisualCaptureHeld === true
    ))).toBe(true)

    const cleared = await appWindow.evaluate(
      `window.hronaut.visualCompare({ tabId: ${JSON.stringify(tabId)}, action: 'clear' })`
    )
    expect(cleared).toMatchObject({ status: 'empty', cleared: true })
    await electronApp.evaluate(() => {
      ;(globalThis as typeof globalThis & { __hronautReleaseVisualCapture?: () => void })
        .__hronautReleaseVisualCapture?.()
    })

    const obsolete = await pendingBaseline
    expect(obsolete.isError).toBe(true)
    expect(text(obsolete)).toContain('changed while the page capture was pending')
    const current = await call('browser_visual_compare', {
      workspaceId: workspace.id,
      tabId,
      action: 'get'
    })
    expect(current.isError, text(current)).not.toBe(true)
    expect(JSON.parse(text(current))).toMatchObject({ status: 'empty' })
  } finally {
    await electronApp.evaluate(() => {
      const mainGlobal = globalThis as typeof globalThis & {
        __hronautVisualCaptureHeld?: boolean
        __hronautReleaseVisualCapture?: () => void
        __hronautRestoreVisualCapture?: () => void
      }
      mainGlobal.__hronautReleaseVisualCapture?.()
      mainGlobal.__hronautRestoreVisualCapture?.()
      delete mainGlobal.__hronautVisualCaptureHeld
      delete mainGlobal.__hronautReleaseVisualCapture
      delete mainGlobal.__hronautRestoreVisualCapture
    })
    await pendingBaseline?.catch(() => undefined)
    await client.close().catch(() => undefined)
    await closeFixtureServer(fixture)
  }
})
