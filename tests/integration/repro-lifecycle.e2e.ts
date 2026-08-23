import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

test('contains a rejected delayed Repro scroll capture', async ({
  appWindow,
  electronApp,
  mcpPort,
  mcpToken
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Repro rejection fixture</title><main style="height: 2000px">Scrollable Repro fixture</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const client = new Client({ name: 'hronaut-repro-rejection-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Repro fixture did not expose a port')
    await expect.poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, {
          headers: { authorization: `Bearer ${mcpToken}` }
        })).ok
      } catch {
        return false
      }
    }).toBe(true)
    await client.connect(transport)
    await useMcpWorkspace(client, 'Repro rejection test', false)
    const opened = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: `http://127.0.0.1:${address.port}/`, active: true }
    }) as CallToolResult
    const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Repro rejection fixture')

    const started = await client.callTool({
      name: 'browser_repro',
      arguments: { tabId, action: 'start' }
    }) as CallToolResult
    expect(started.isError, text(started)).not.toBe(true)

    await electronApp.evaluate(({ BrowserWindow, WebContentsView }) => {
      const view = BrowserWindow.getAllWindows()
        .flatMap((window) => window.contentView.children)
        .find((candidate): candidate is InstanceType<typeof WebContentsView> => (
          candidate instanceof WebContentsView && candidate.webContents.getTitle() === 'Repro rejection fixture'
        ))
      if (!view) throw new Error('Repro rejection fixture view was not found')
      const originalExecuteJavaScript = view.webContents.executeJavaScript.bind(view.webContents)
      let rejectScrollCapture = true
      Object.defineProperty(view.webContents, 'executeJavaScript', {
        configurable: true,
        value: (code: string, userGesture?: boolean) => {
          if (rejectScrollCapture && code === '(() => ({ x: Math.round(scrollX), y: Math.round(scrollY) }))()') {
            rejectScrollCapture = false
            ;(globalThis as typeof globalThis & { __hronautReproScrollIntercepted?: boolean })
              .__hronautReproScrollIntercepted = true
            return Promise.reject(new Error('Repro scroll renderer unavailable for regression test'))
          }
          return originalExecuteJavaScript(code, userGesture)
        }
      })
      const mainGlobal = globalThis as typeof globalThis & {
        __hronautUnhandledReproRejection?: string | null
        __hronautUnhandledReproRejectionListener?: (reason: unknown) => void
      }
      mainGlobal.__hronautUnhandledReproRejection = null
      mainGlobal.__hronautUnhandledReproRejectionListener = (reason) => {
        ;(globalThis as typeof globalThis & { __hronautUnhandledReproRejection?: string | null })
          .__hronautUnhandledReproRejection = reason instanceof Error ? reason.message : String(reason)
      }
      process.once('unhandledRejection', mainGlobal.__hronautUnhandledReproRejectionListener)
      view.webContents.focus()
      view.webContents.sendInputEvent({ type: 'mouseDown', x: 100, y: 100, button: 'left', clickCount: 1 })
      view.webContents.sendInputEvent({ type: 'mouseUp', x: 100, y: 100, button: 'left', clickCount: 1 })
    })
    await appWindow.waitForTimeout(450)

    const capture = await electronApp.evaluate(() => {
      const mainGlobal = globalThis as typeof globalThis & {
        __hronautUnhandledReproRejection?: string | null
        __hronautUnhandledReproRejectionListener?: (reason: unknown) => void
        __hronautReproScrollIntercepted?: boolean
      }
      const captured = mainGlobal.__hronautUnhandledReproRejection
      const intercepted = mainGlobal.__hronautReproScrollIntercepted === true
      if (mainGlobal.__hronautUnhandledReproRejectionListener) {
        process.off('unhandledRejection', mainGlobal.__hronautUnhandledReproRejectionListener)
      }
      delete mainGlobal.__hronautUnhandledReproRejection
      delete mainGlobal.__hronautUnhandledReproRejectionListener
      delete mainGlobal.__hronautReproScrollIntercepted
      return { captured, intercepted }
    })
    const stopped = await client.callTool({
      name: 'browser_repro',
      arguments: { tabId, action: 'stop' }
    }) as CallToolResult
    expect(stopped.isError, text(stopped)).not.toBe(true)
    expect(capture.intercepted).toBe(true)
    expect(capture.captured).toBeNull()
  } finally {
    await client.close().catch(() => undefined)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
