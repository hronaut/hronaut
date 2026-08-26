import { createServer, type ServerResponse } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

test('fails MCP page, text, and network waits promptly on tab teardown or timeout', async ({
  appWindow,
  electronApp,
  mcpPort,
  mcpToken
}) => {
  const pendingResponses = new Set<ServerResponse>()
  const server = createServer((request, response) => {
    if (request.url === '/text-disappears') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><title>Disappearing text</title><main id="status">Loading profile</main><script>setTimeout(() => document.querySelector("#status")?.remove(), 1000)</script>')
      return
    }
    if (request.url === '/text-stays') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><title>Persistent text</title><main>Persistent status</main>')
      return
    }
    if (request.url === '/text-any') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><title>Any text</title><main id="status">Deploying</main><script>setTimeout(() => { document.querySelector("#status").textContent = "Deployment failed" }, 1000)</script>')
      return
    }
    if (request.url === '/element-states') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><title>Element states</title>
        <main>
          <button id="late-action" hidden>Delayed action</button>
          <button id="removing">Removing soon</button>
        </main>
        <script>
          setTimeout(() => { document.querySelector('#late-action').hidden = false }, 600)
          setTimeout(() => {
            const inserted = document.createElement('output')
            inserted.id = 'inserted'
            inserted.textContent = 'Inserted later'
            document.querySelector('main').append(inserted)
          }, 1_000)
          setTimeout(() => document.querySelector('#removing')?.remove(), 2_000)
        </script>`)
      return
    }
    pendingResponses.add(response)
    response.once('close', () => pendingResponses.delete(response))
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.write('<!doctype html><title>Never finished</title><main>Still loading</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const client = new Client({ name: 'hronaut-wait-close-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Wait fixture did not expose a port')
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
    await useMcpWorkspace(client, 'Wait cancellation test', false)

    const disappearingTab = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: `http://127.0.0.1:${address.port}/text-disappears`, active: true }
    }) as CallToolResult
    const disappearingTabId = (JSON.parse(text(disappearingTab)) as { activeTabId: string }).activeTabId
    const disappeared = await client.callTool({
      name: 'browser_wait',
      arguments: { tabId: disappearingTabId, textGone: 'Loading profile', timeoutMs: 5_000 }
    }) as CallToolResult
    expect(disappeared.isError).not.toBe(true)
    expect(text(disappeared)).toBe('Text disappeared: Loading profile')

    const anyTextTab = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: `http://127.0.0.1:${address.port}/text-any`, active: true }
    }) as CallToolResult
    const anyTextTabId = (JSON.parse(text(anyTextTab)) as { activeTabId: string }).activeTabId
    const anyText = await client.callTool({
      name: 'browser_wait',
      arguments: {
        tabId: anyTextTabId,
        text: ['Deployment ready', 'Deployment failed'],
        timeoutMs: 5_000
      }
    }) as CallToolResult
    expect(anyText.isError).not.toBe(true)
    expect(text(anyText)).toBe('Found text: Deployment failed')
    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(anyTextTabId)})`)

    const elementTab = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: `http://127.0.0.1:${address.port}/element-states`, active: true }
    }) as CallToolResult
    const elementTabId = (JSON.parse(text(elementTab)) as { activeTabId: string }).activeTabId
    const elementTools = await client.listTools()
    expect(elementTools.tools.find((tool) => tool.name === 'browser_wait')?.description).toContain('element')
    const elementSnapshot = await client.callTool({
      name: 'browser_snapshot',
      arguments: { tabId: elementTabId }
    }) as CallToolResult
    const removingRef = text(elementSnapshot).match(/\[(e\d+)\].*"Removing soon"/)?.[1]
    if (!removingRef) throw new Error('Removing element did not receive a snapshot ref')

    const visibleElement = await client.callTool({
      name: 'browser_wait',
      arguments: { tabId: elementTabId, selector: '#late-action', state: 'visible', timeoutMs: 5_000 }
    }) as CallToolResult
    expect(visibleElement.isError, text(visibleElement)).not.toBe(true)
    expect(text(visibleElement)).toBe('Element is visible: #late-action')
    const defaultVisibleElement = await client.callTool({
      name: 'browser_wait',
      arguments: { tabId: elementTabId, selector: '#late-action', timeoutMs: 5_000 }
    }) as CallToolResult
    expect(defaultVisibleElement.isError, text(defaultVisibleElement)).not.toBe(true)
    expect(text(defaultVisibleElement)).toBe('Element is visible: #late-action')

    const attachedElement = await client.callTool({
      name: 'browser_wait',
      arguments: { tabId: elementTabId, selector: '#inserted', state: 'attached', timeoutMs: 5_000 }
    }) as CallToolResult
    expect(attachedElement.isError, text(attachedElement)).not.toBe(true)
    expect(text(attachedElement)).toBe('Element is attached: #inserted')

    const detachedElement = await client.callTool({
      name: 'browser_wait',
      arguments: { tabId: elementTabId, ref: removingRef, state: 'detached', timeoutMs: 5_000 }
    }) as CallToolResult
    expect(detachedElement.isError, text(detachedElement)).not.toBe(true)
    expect(text(detachedElement)).toBe(`Element is detached: [${removingRef}]`)
    const hiddenMissingElement = await client.callTool({
      name: 'browser_wait',
      arguments: { tabId: elementTabId, selector: '#never-rendered', state: 'hidden', timeoutMs: 5_000 }
    }) as CallToolResult
    expect(hiddenMissingElement.isError, text(hiddenMissingElement)).not.toBe(true)
    expect(text(hiddenMissingElement)).toBe('Element is hidden: #never-rendered')

    const ambiguousElementWait = await client.callTool({
      name: 'browser_wait',
      arguments: { tabId: elementTabId, text: 'Delayed action', selector: '#late-action' }
    }) as CallToolResult
    expect(ambiguousElementWait.isError).toBe(true)
    expect(text(ambiguousElementWait)).toContain('Choose page text or an element target')
    const missingElementTarget = await client.callTool({
      name: 'browser_wait',
      arguments: { tabId: elementTabId, state: 'hidden' }
    }) as CallToolResult
    expect(missingElementTarget.isError).toBe(true)
    expect(text(missingElementTarget)).toContain('Provide ref or selector')
    const ambiguousTarget = await client.callTool({
      name: 'browser_wait',
      arguments: { tabId: elementTabId, ref: removingRef, selector: '#late-action', state: 'visible' }
    }) as CallToolResult
    expect(ambiguousTarget.isError).toBe(true)
    expect(text(ambiguousTarget)).toContain('Provide either ref or selector, not both')

    const waitingForElement = client.callTool({
      name: 'browser_wait',
      arguments: { tabId: elementTabId, selector: '#never-visible', state: 'visible', timeoutMs: 10_000 }
    }) as Promise<CallToolResult>
    await expect(appWindow.locator('[role="tab"][data-mcp-command="browser_wait"]')).toBeVisible()
    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(elementTabId)})`)
    const closedElementWait = await Promise.race([
      waitingForElement,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('element browser_wait stayed active after its tab closed')), 2_000)
      })
    ])
    expect(closedElementWait.isError).toBe(true)
    expect(text(closedElementWait)).toContain('tab closed while waiting for the page element')

    const ambiguous = await client.callTool({
      name: 'browser_wait',
      arguments: { tabId: disappearingTabId, text: 'Profile', textGone: 'Loading profile' }
    }) as CallToolResult
    expect(ambiguous.isError).toBe(true)
    expect(text(ambiguous)).toContain('Choose either text or textGone')
    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(disappearingTabId)})`)

    const persistentTab = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: `http://127.0.0.1:${address.port}/text-stays`, active: true }
    }) as CallToolResult
    const persistentTabId = (JSON.parse(text(persistentTab)) as { activeTabId: string }).activeTabId
    const persistentUrl = `http://127.0.0.1:${address.port}/text-stays`
    await expect.poll(() => electronApp.evaluate(({ webContents }, requestedUrl) => (
      webContents.getAllWebContents().some((contents) => contents.getURL() === requestedUrl)
    ), persistentUrl)).toBe(true)
    await electronApp.evaluate(({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Persistent text WebContents was not found')
      const original = page.executeJavaScript.bind(page)
      ;(globalThis as typeof globalThis & {
        __hronautStalledTextWait?: { page: Electron.WebContents; original: typeof original }
      }).__hronautStalledTextWait = { page, original }
      Object.defineProperty(page, 'executeJavaScript', {
        configurable: true,
        value: () => new Promise<never>(() => undefined)
      })
    }, persistentUrl)
    const unverifiableAbsence = await client.callTool({
      name: 'browser_wait',
      arguments: { tabId: persistentTabId, textGone: 'Already absent', timeoutMs: 100 }
    }) as CallToolResult
    expect(unverifiableAbsence.isError).toBe(true)
    expect(text(unverifiableAbsence)).toContain('Timed out waiting for text to disappear: Already absent')
    await electronApp.evaluate(() => {
      const mainGlobal = globalThis as typeof globalThis & {
        __hronautStalledTextWait?: { page: Electron.WebContents; original: Electron.WebContents['executeJavaScript'] }
      }
      const control = mainGlobal.__hronautStalledTextWait
      if (!control) throw new Error('Stalled text wait control was not installed')
      Object.defineProperty(control.page, 'executeJavaScript', { configurable: true, value: control.original })
      delete mainGlobal.__hronautStalledTextWait
    })
    const persistent = await client.callTool({
      name: 'browser_wait',
      arguments: { tabId: persistentTabId, textGone: 'Persistent status', timeoutMs: 100 }
    }) as CallToolResult
    expect(persistent.isError).toBe(true)
    expect(text(persistent)).toContain('Timed out waiting for text to disappear: Persistent status')
    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(persistentTabId)})`)

    const opened = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: `http://127.0.0.1:${address.port}/never-finishes`, active: true }
    }) as CallToolResult
    const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.loading)`)).toBe(true)

    const waiting = client.callTool({
      name: 'browser_wait',
      arguments: { tabId, timeoutMs: 10_000 }
    }) as Promise<CallToolResult>
    await expect(appWindow.locator('[role="tab"][data-mcp-command="browser_wait"]')).toBeVisible()
    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(tabId)})`)
    const result = await Promise.race([
      waiting,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('browser_wait stayed active after its tab closed')), 2_000)
      })
    ])
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('tab closed while waiting for the page')
    await expect(appWindow.locator('[role="tab"].mcp-active')).toHaveCount(0)

    const openedTextTab = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: `http://127.0.0.1:${address.port}/never-finds-text`, active: true }
    }) as CallToolResult
    const textTabId = (JSON.parse(text(openedTextTab)) as { activeTabId: string }).activeTabId
    const waitingForText = client.callTool({
      name: 'browser_wait',
      arguments: { tabId: textTabId, text: 'This text never appears', timeoutMs: 10_000 }
    }) as Promise<CallToolResult>
    await expect(appWindow.locator('[role="tab"][data-mcp-command="browser_wait"]')).toBeVisible()
    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(textTabId)})`)
    const textResult = await Promise.race([
      waitingForText,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('text browser_wait stayed active after its tab closed')), 2_000)
      })
    ])
    expect(textResult.isError).toBe(true)
    expect(text(textResult)).toContain('tab closed while waiting for page text')

    const expectNetworkWaitToFailOnRendererLoss = async (
      path: string,
      failure: 'close' | 'crash'
    ): Promise<void> => {
      const openedNetworkTab = await client.callTool({
        name: 'browser_new_tab',
        arguments: { url: `http://127.0.0.1:${address.port}${path}`, active: true }
      }) as CallToolResult
      const networkTabId = (JSON.parse(text(openedNetworkTab)) as { activeTabId: string }).activeTabId
      await expect.poll(() => electronApp.evaluate(({ webContents }, requestedPath) => (
        webContents.getAllWebContents().some((contents) => contents.getURL().includes(requestedPath))
      ), path)).toBe(true)
      const waitingForNetwork = client.callTool({
        name: 'browser_network_wait',
        arguments: {
          tabId: networkTabId,
          urlPattern: `*://127.0.0.1:${address.port}/never-matches-${failure}*`,
          phase: 'complete',
          from: 'future',
          timeoutMs: 10_000
        }
      }) as Promise<CallToolResult>
      await expect(appWindow.locator('[role="tab"][data-mcp-command="browser_network_wait"]')).toBeVisible()
      await electronApp.evaluate(({ webContents }, input) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes(input.path))
        if (!page) throw new Error(`Network wait ${input.failure} fixture WebContents was not found`)
        if (input.failure === 'close') {
          page.close()
          return
        }
        const processId = page.getOSProcessId()
        if (processId <= 0) throw new Error('Network wait crash fixture did not expose a renderer process')
        process.kill(processId, 'SIGKILL')
      }, { path, failure })
      let promptTimer: NodeJS.Timeout | undefined
      const result = await Promise.race([
        waitingForNetwork,
        new Promise<never>((_resolve, reject) => {
          promptTimer = setTimeout(() => reject(new Error(
            `browser_network_wait stayed active after its renderer ${failure === 'close' ? 'closed' : 'crashed'}`
          )), 2_000)
        })
      ]).finally(() => {
        if (promptTimer) clearTimeout(promptTimer)
      })
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('tab renderer became unavailable while waiting for network activity')
      await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(networkTabId)})`)
    }

    await expectNetworkWaitToFailOnRendererLoss('/network-renderer-teardown', 'close')
    await expectNetworkWaitToFailOnRendererLoss('/network-renderer-crash', 'crash')

    const openedTimeoutTab = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: `http://127.0.0.1:${address.port}/never-finishes-before-timeout`, active: true }
    }) as CallToolResult
    const timeoutTabId = (JSON.parse(text(openedTimeoutTab)) as { activeTabId: string }).activeTabId
    const timeoutResult = await client.callTool({
      name: 'browser_wait',
      arguments: { tabId: timeoutTabId, timeoutMs: 100 }
    }) as CallToolResult
    expect(timeoutResult.isError).toBe(true)
    expect(text(timeoutResult)).toContain('Timed out waiting for the page to finish loading')
    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(timeoutTabId)})`)

    const openedTextTimeoutTab = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: `http://127.0.0.1:${address.port}/text-never-finishes-before-timeout`, active: true }
    }) as CallToolResult
    const textTimeoutTabId = (JSON.parse(text(openedTextTimeoutTab)) as { activeTabId: string }).activeTabId
    const textTimeoutResult = await client.callTool({
      name: 'browser_wait',
      arguments: { tabId: textTimeoutTabId, text: 'Absent forever', timeoutMs: 100 }
    }) as CallToolResult
    expect(textTimeoutResult.isError).toBe(true)
    expect(text(textTimeoutResult)).toContain('Timed out waiting for text: Absent forever')
    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(textTimeoutTabId)})`)
  } finally {
    await client.close().catch(() => undefined)
    for (const response of pendingResponses) response.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
