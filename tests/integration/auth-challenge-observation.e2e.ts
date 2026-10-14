import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserInspectorIssuesReport } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const text = (result: CallToolResult): string => result.content.filter(item => item.type === 'text').map(item => item.type === 'text' ? item.text : '').join('\n')

test('reports observed Basic challenges by origin and request kind without answering them', async ({ electronApp, mcpPort, mcpToken }) => {
  const authorizationHeaders: string[] = []
  const server = createServer((request, response) => {
    if (request.headers.authorization) authorizationHeaders.push(request.headers.authorization)
    const path = request.url ?? '/'
    if (path.startsWith('/secret')) {
      response.writeHead(401, { 'www-authenticate': 'Basic realm="PRIVATE_REALM"', 'content-type': 'text/html' }).end('<title>Denied</title>')
    } else if (path.startsWith('/digest')) {
      response.writeHead(401, { 'www-authenticate': 'Digest realm="PRIVATE_DIGEST", nonce="n"', 'content-type': 'text/html' }).end('<title>Digest</title>')
    } else if (path === '/plain401') {
      response.writeHead(401, { 'content-type': 'text/html' }).end('<title>Plain</title>')
    } else if (path === '/page') {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Page</title><iframe src="/secret-frame?PRIVATE_FRAME=1"></iframe><script>fetch("/secret-api?token=PRIVATE_QUERY").catch(()=>{})</script>')
    } else if (path === '/many') {
      response.writeHead(200, { 'content-type': 'text/html' }).end(`<title>Many</title><script>${Array.from({ length: 10 }, (_, i) => `fetch("/secret-${i}").catch(()=>{});`).join('')}</script>`)
    } else {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Start</title>start')
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const client = new Client({ name: 'auth-challenge-test', version: '1' })
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const workspace = await call('browser_workspaces', { action: 'create', name: 'Auth challenges', storage: 'scratch' })
    const workspaceId = (JSON.parse(text(workspace)) as { id: string }).id
    const opened = await call('browser_new_tab', { workspaceId, url: `${origin}/start` })
    const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
    const visit = async (path: string, title: string) => {
      const navigated = await call('browser_navigate', { workspaceId, tabId, url: origin + path })
      expect(navigated.isError, text(navigated)).not.toBe(true)
      const ready = await call('browser_wait', { workspaceId, tabId, timeoutMs: 8_000 })
      expect(ready.isError, text(ready)).not.toBe(true)
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
        .find(page => page.getURL() === url)?.getTitle(), origin + path)).toBe(title)
    }
    const issues = async (action = 'list') => {
      const result = await call('browser_issues', { workspaceId, tabId, action })
      expect(result.isError, text(result)).not.toBe(true)
      const report = JSON.parse(text(result)) as BrowserInspectorIssuesReport
      // The page URL may be reported elsewhere; challenges carry only fixed fields.
      expect(JSON.stringify(report.authChallenges)).not.toMatch(/PRIVATE_|realm|authorization/i)
      for (const challenge of report.authChallenges) expect(Object.keys(challenge).sort()).toEqual(['observedAt', 'origin', 'request', 'scheme'])
      return report
    }
    const kinds = (report: BrowserInspectorIssuesReport) => report.authChallenges.map(({ scheme, origin, request }) => ({ scheme, origin, request }))

    expect((await issues()).authChallenges).toEqual([])
    await visit('/secret?PRIVATE_PATH=1', 'Denied')
    const main = await issues()
    expect(kinds(main)).toEqual([{ scheme: 'basic', origin, request: 'main-frame-navigation' }])
    expect(Date.parse(main.authChallenges[0]!.observedAt)).not.toBeNaN()

    // A 401 without a challenge, and non-Basic schemes, are not reported.
    await visit('/plain401', 'Plain')
    expect((await issues()).authChallenges).toEqual([])
    await visit('/digest', 'Digest')
    expect((await issues()).authChallenges).toEqual([])

    // Subframe and subresource challenges are never main-frame claims; navigation clears them.
    await visit('/page', 'Page')
    await expect.poll(async () => kinds(await issues()).map(entry => entry.request).sort()).toEqual(['subframe-navigation', 'subresource'])
    expect((await issues('clear')).authChallenges).toEqual([])
    expect((await issues()).authChallenges).toEqual([])
    await visit('/many', 'Many')
    await expect.poll(async () => (await issues()).authChallengesTruncated).toBe(true)
    expect((await issues()).authChallenges).toHaveLength(8)
    await visit('/start', 'Start')
    expect(await issues()).toMatchObject({ authChallenges: [], authChallengesTruncated: false })

    // Hronaut keeps Electron's default cancellation and never supplies credentials.
    expect(authorizationHeaders).toEqual([])
  } finally {
    await client.close().catch(() => undefined)
    await closeFixtureServer(server)
  }
})
