import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const parse = <T>(result: CallToolResult): T => JSON.parse(result.content.find((entry) => entry.type === 'text')!.text) as T

test('classifies bounded observation quality without leaking task evidence', async ({ mcpPort, mcpToken }) => {
  const pages: Record<string, string> = {
    '/empty': '<!doctype html><title>App</title><div id="root"></div>',
    '/login': '<!doctype html><title>Sign in</title><main><h1>Sign in to continue</h1><form><input name="email"><input type="password"><button>Sign in</button></form></main>',
    '/challenge': '<!doctype html><title>Just a moment...</title><main><h1>Verify you are human</h1><div class="cf-turnstile"></div></main>',
    '/challenge-article': '<!doctype html><title>Just a moment: diagnosing slow pages</title><main><article><h1>Just a moment: diagnosing slow pages</h1><p>This article explains why loading indicators can remain visible, how to distinguish network delay from renderer work, and which bounded observations help diagnose a slow application without mistaking ordinary explanatory content for an automated browser challenge.</p></article></main>',
    '/noise': `<!doctype html><title>Portal</title><header><nav>${Array.from({ length: 18 }, (_, index) => `<a href="/item-${index}">Navigation item ${index}</a>`).join('')}</nav></header><div role="dialog">We use cookies. <button>Accept all cookies</button><button>Manage cookies</button></div>`,
    '/missing': '<!doctype html><title>404 - Page not found</title><main><h1>Page not found</h1><p>The requested page does not exist.</p></main>',
    '/useful': '<!doctype html><title>Migration guide</title><main><article><h1>Migration guide</h1><p>This guide explains the supported migration procedure, preparation steps, validation checks, rollback conditions, and final verification for a production workspace.</p><p>Expected evidence marker: release-ready-canary.</p></article></main>'
  }
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(pages[new URL(request.url ?? '/', 'http://fixture').pathname] ?? pages['/missing'])
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'observation-quality-fixture', version: '1' })
  try {
    await expect.poll(() => fetch(`http://127.0.0.1:${mcpPort}/mcp`).then(() => true, () => false)).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => await client.callTool({ name, arguments: args }) as CallToolResult
    const workspace = parse<{ id: string }>(await call('browser_workspaces', { action: 'create', name: 'Observation quality fixtures', storage: 'scratch' }))
    const opened = parse<{ tabId: string }>(await call('browser_new_tab', { workspaceId: workspace.id, url: `${origin}/empty` }))
    const assess = async (path: string, options: Record<string, unknown> = {}) => {
      const navigation = await call('browser_navigate', { workspaceId: workspace.id, tabId: opened.tabId, url: `${origin}${path}` })
      expect(navigation.isError).not.toBe(true)
      const result = await call('browser_snapshot', {
        workspaceId: workspace.id,
        tabId: opened.tabId,
        action: 'assess-quality',
        ...options
      })
      expect(result.isError, result.content.find((entry) => entry.type === 'text')?.text).not.toBe(true)
      return parse<Record<string, unknown>>(result)
    }

    expect(await assess('/empty')).toMatchObject({ status: 'empty_content', decision: 'stop' })
    expect(await assess('/login')).toMatchObject({ status: 'login_wall', decision: 'stop' })
    expect(await assess('/challenge')).toMatchObject({ status: 'challenge', decision: 'stop' })
    expect(await assess('/challenge-article')).toMatchObject({ status: 'candidate', decision: 'continue' })
    expect(await assess('/noise')).toMatchObject({ status: 'needs_review', decision: 'review' })
    expect(await assess('/missing')).toMatchObject({ status: 'soft_404', decision: 'stop' })
    expect(await assess('/useful')).toMatchObject({ status: 'candidate', decision: 'continue', evidenceClass: 'semantic_content' })
    expect(await assess('/useful', { expectedOrigin: 'https://unexpected.example' }))
      .toMatchObject({ status: 'wrong_origin', decision: 'stop' })
    expect(await assess('/useful', { expectedText: 'missing-private-marker' }))
      .toMatchObject({ status: 'needs_review', decision: 'stop', evidenceClass: 'expected_marker_missing' })
    expect(await assess('/useful', { expectedSelector: 'main article' }))
      .toMatchObject({ status: 'candidate', decision: 'continue', evidenceClass: 'expected_marker' })
    const marked = await assess('/useful?token=observation-secret#private-fragment', { expectedText: 'release-ready-canary' })
    expect(marked).toMatchObject({ status: 'candidate', decision: 'continue', evidenceClass: 'expected_marker' })
    expect(JSON.stringify(marked)).not.toContain('release-ready-canary')
    expect(JSON.stringify(marked)).not.toContain('observation-secret')
    expect(JSON.stringify(marked)).not.toContain('private-fragment')
  } finally {
    await client.close()
    await closeFixtureServer(server)
  }
})
