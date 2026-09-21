import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  return result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
}

test('does not restore a storage baseline captured before a newer clear', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Storage comparison lifecycle</title><script>
      localStorage.setItem('lifecycle', 'baseline');
      sessionStorage.setItem('lifecycle', 'baseline');
    </script>`)
  })
  await new Promise<void>((resolve, reject) => {
    fixture.once('error', reject)
    fixture.listen(0, '127.0.0.1', resolve)
  })
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Storage comparison fixture did not expose a port')
  const url = `http://127.0.0.1:${address.port}/`
  const client = new Client({ name: 'storage-comparison-lifecycle', version: '1' })
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
      action: 'create', storage: 'scratch', name: 'Storage comparison lifecycle'
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
      if (!page) throw new Error('Storage comparison fixture page was not found')
      const originalExecuteJavaScript = page.executeJavaScript.bind(page)
      const mainGlobal = globalThis as typeof globalThis & {
        __hronautStorageCaptureHeld?: boolean
        __hronautReleaseStorageCapture?: () => void
        __hronautRestoreStorageCapture?: () => void
      }
      let releaseCapture!: () => void
      const gate = new Promise<void>((resolve) => { releaseCapture = resolve })
      mainGlobal.__hronautStorageCaptureHeld = false
      mainGlobal.__hronautReleaseStorageCapture = releaseCapture
      mainGlobal.__hronautRestoreStorageCapture = () => { page.executeJavaScript = originalExecuteJavaScript }
      page.executeJavaScript = async (code: string, userGesture?: boolean) => {
        const value = await originalExecuteJavaScript(code, userGesture)
        if (!code.includes('const fingerprint = (value) =>')) return value
        mainGlobal.__hronautStorageCaptureHeld = true
        await gate
        page.executeJavaScript = originalExecuteJavaScript
        return value
      }
    }, url)

    pendingBaseline = call('browser_storage_changes', {
      workspaceId: workspace.id,
      tabId,
      action: 'baseline'
    })
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautStorageCaptureHeld?: boolean }).__hronautStorageCaptureHeld === true
    ))).toBe(true)

    const cleared = await appWindow.evaluate(
      `window.hronaut.storageChanges({ tabId: ${JSON.stringify(tabId)}, action: 'clear' })`
    )
    expect(cleared).toMatchObject({ status: 'empty', action: 'clear' })
    await electronApp.evaluate(() => {
      ;(globalThis as typeof globalThis & { __hronautReleaseStorageCapture?: () => void })
        .__hronautReleaseStorageCapture?.()
    })

    const obsolete = await pendingBaseline
    expect(obsolete.isError).toBe(true)
    expect(text(obsolete)).toContain('changed while the page snapshot was pending')
    const current = await call('browser_storage_changes', {
      workspaceId: workspace.id,
      tabId,
      action: 'get'
    })
    expect(current.isError, text(current)).not.toBe(true)
    expect(JSON.parse(text(current))).toMatchObject({ status: 'empty' })
  } finally {
    await electronApp.evaluate(() => {
      const mainGlobal = globalThis as typeof globalThis & {
        __hronautStorageCaptureHeld?: boolean
        __hronautReleaseStorageCapture?: () => void
        __hronautRestoreStorageCapture?: () => void
      }
      mainGlobal.__hronautReleaseStorageCapture?.()
      mainGlobal.__hronautRestoreStorageCapture?.()
      delete mainGlobal.__hronautStorageCaptureHeld
      delete mainGlobal.__hronautReleaseStorageCapture
      delete mainGlobal.__hronautRestoreStorageCapture
    })
    await pendingBaseline?.catch(() => undefined)
    await client.close().catch(() => undefined)
    await closeFixtureServer(fixture)
  }
})
