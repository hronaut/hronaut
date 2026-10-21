import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// A website's sign-in popup, such as "Sign in with Google", got no window: window.open() returned null, so the site
// reported the popup as blocked, and the tab Hronaut opened had no window.opener to send the result back to. Once
// signed in, the popup's window.close() left a tab saying its page was no longer available.

const BUTTON = 'position: fixed; left: 10px; top: 10px; width: 160px; height: 32px'

const APP = `<!doctype html><title>App</title>
<button id="sign-in" style="${BUTTON}" onclick="
  window.signInPopup = window.open('/sign-in', 'sign-in', 'width=480,height=640')
  document.title = window.signInPopup ? 'Waiting for sign-in' : 'Popup blocked'
">Sign in</button>
<script>
  addEventListener('message', (event) => {
    if (event.origin === location.origin && event.source === window.signInPopup) document.title = 'Signed in as ' + event.data
  })
</script>`

const SIGN_IN = `<!doctype html><title>Sign in</title>
<button id="continue" style="${BUTTON}" onclick="window.opener.postMessage('ada', location.origin); window.close()">Continue</button>`

test('a sign-in popup answers the page that opened it and closes its tab', async ({ appWindow, mcpPort, mcpToken }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(request.url === '/sign-in' ? SIGN_IN : APP)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Page fixture did not expose a port')
  const client = new Client({ name: 'hronaut-sign-in-popup-test', version: '1.0.0' })
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const text = async (name: string, args: Record<string, unknown>): Promise<string> => {
      const result = await client.callTool({ name, arguments: args }) as CallToolResult
      const value = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
      if (result.isError) throw new Error(value)
      return value
    }
    const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => JSON.parse(await text(name, args)) as T
    // The tool returns a string as it is, so each script returns JSON.
    const evaluate = (tabId: string, script: string): Promise<unknown> =>
      call<unknown>('browser_evaluate', { workspaceId, tabId, script: `JSON.stringify(${script})` })
    const workspaceId = (await call<{ id: string }>('browser_workspaces', { action: 'create', name: 'Sign-in popup' })).id
    const appTabId = (await call<{ activeTabId: string }>('browser_new_tab', { workspaceId, url: `http://127.0.0.1:${address.port}/` })).activeTabId
    await text('browser_wait', { workspaceId, tabId: appTabId, selector: '#sign-in', state: 'visible' })

    const click = await call<{ tabsOpenedDuringClick?: { tabIds: string[] } }>('browser_click', { workspaceId, tabId: appTabId, selector: '#sign-in' })
    expect(await evaluate(appTabId, 'document.title')).toBe('Waiting for sign-in')
    expect(click.tabsOpenedDuringClick?.tabIds, JSON.stringify(click)).toHaveLength(1)
    const popupTabId = click.tabsOpenedDuringClick!.tabIds[0]!
    await text('browser_wait', { workspaceId, tabId: popupTabId, selector: '#continue', state: 'visible' })
    // The popup is a tab of the same workspace, with Hronaut's page script like any other tab.
    expect(await evaluate(popupTabId, '({ opener: window.opener !== null, bridge: typeof window.__hronautWalletBridge })'))
      .toEqual({ opener: true, bridge: 'object' })

    // The two pages can read each other's, so while the person has the popup the agent in the app tab waits too.
    const setPaused = (tabId: string, paused: boolean, takeOver?: boolean) => appWindow.evaluate(
      ({ tabId, paused, takeOver }) => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(tabId, paused, { takeOver }),
      { tabId, paused, takeOver })
    await setPaused(popupTabId, true, true)
    await expect(evaluate(appTabId, 'document.title')).rejects.toThrow('Agents are paused for this target')
    await setPaused(appTabId, false)
    expect(await evaluate(popupTabId, 'document.title')).toBe('Sign in')

    // The popup closes its tab during the click, so the click may report that it cannot tell the outcome.
    const signIn = await client.callTool({ name: 'browser_click', arguments: { workspaceId, tabId: popupTabId, selector: '#continue' } }) as CallToolResult
    if (signIn.isError) expect(JSON.stringify(signIn.content)).toContain('OUTCOME_UNKNOWN')
    await expect.poll(() => evaluate(appTabId, 'document.title')).toBe('Signed in as ada')
    await expect.poll(async () => (await call<Array<{ id: string }>>('browser_tabs', { workspaceId })).map(tab => tab.id))
      .toEqual([appTabId])
    expect(await evaluate(appTabId, 'window.signInPopup.closed')).toBe(true)
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
