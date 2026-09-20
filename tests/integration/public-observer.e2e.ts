import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautSettingsApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const parse = <T>(result: CallToolResult): T => JSON.parse(result.content.find((entry) => entry.type === 'text')!.text) as T

test('keeps a clean public observer origin-scoped and read-only', async ({ appWindow, mcpPort, mcpToken }) => {
  let writes = 0
  let publicVisible = true
  const server = createServer((request, response) => {
    if (request.method === 'POST') writes += 1
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(publicVisible
      ? '<!doctype html><title>Public result</title><main><article><h1>Published result</h1><p>The independently visible release marker is public-observer-canary. This public page includes enough meaningful explanatory content to establish that the rendered result is complete, settled, and suitable for a bounded independent observation without relying on an authenticated author view.</p></article><button id="mutate">Change result</button></main>'
      : '<!doctype html><title>Publication pending</title><main><article><h1>Publication pending</h1><p>This independently rendered page is complete and meaningful, but the expected public result has not propagated or has been removed. The author context can remain unchanged while this observer representation differs.</p></article></main>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'public-observer-fixture', version: '1' })
  try {
    await expect.poll(() => fetch(`http://127.0.0.1:${mcpPort}/mcp`).then(() => true, () => false)).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => (
      await client.callTool({ name, arguments: args }) as CallToolResult
    )
    const writerWorkspace = parse<{ id: string; resumeKey: string }>(await call('browser_workspaces', {
      action: 'create',
      name: 'Public outcome writer context',
      storage: 'scratch'
    }))
    const writerOpened = parse<{ activeTabId: string }>(await call('browser_new_tab', {
      workspaceId: writerWorkspace.id,
      url: `${origin}/result`
    }))
    await call('browser_wait', {
      workspaceId: writerWorkspace.id,
      tabId: writerOpened.activeTabId,
      text: 'public-observer-canary'
    })
    const workspace = parse<{ id: string; resumeKey: string; contextClass: string; navigationPolicy: { rules: string[] } }>(
      await call('browser_workspaces', {
        action: 'create',
        name: 'Independent public observer',
        storage: 'scratch',
        contextClass: 'public-observer',
        observerOrigin: `${origin}/private-path?secret=discarded`
      })
    )
    expect(workspace).toMatchObject({
      contextClass: 'public-observer',
      navigationPolicy: { rules: [origin] }
    })
    expect(JSON.stringify(workspace)).not.toContain('private-path')
    expect(JSON.stringify(workspace)).not.toContain('secret')

    const opened = parse<{ activeTabId: string; tabs: Array<{ id: string; humanInteractionLocked: boolean }> }>(await call('browser_new_tab', {
      workspaceId: workspace.id,
      url: `${origin}/result`
    }))
    expect(opened.tabs.find((tab) => tab.id === opened.activeTabId)?.humanInteractionLocked).toBe(true)
    const unlockError = await appWindow.evaluate(`(async () => {
      try {
        await window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(opened.activeTabId)}, false)
        return ''
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    })()`)
    expect(unlockError).toContain('read-only public observer')
    const settled = await call('browser_wait', {
      workspaceId: workspace.id,
      tabId: opened.activeTabId,
      text: 'public-observer-canary'
    })
    expect(settled.isError, JSON.stringify(settled.content)).not.toBe(true)
    const observed = await call('browser_snapshot', {
      workspaceId: workspace.id,
      tabId: opened.activeTabId,
      action: 'assess-quality',
      expectedOrigin: origin,
      expectedText: 'public-observer-canary'
    })
    expect(observed.isError, JSON.stringify(observed.content)).not.toBe(true)
    expect(parse<Record<string, unknown>>(observed)).toMatchObject({
      status: 'candidate', decision: 'continue', evidenceClass: 'expected_marker'
    })

    const publicOutcome = async () => call('browser_public_outcome', {
      workspaceId: workspace.id,
      tabId: opened.activeTabId,
      writerWorkspaceId: writerWorkspace.id,
      writerTabId: writerOpened.activeTabId,
      targetUrl: `${origin}/result`,
      expectedText: 'public-observer-canary'
    })
    const missingMarker = await call('browser_public_outcome', {
      workspaceId: workspace.id,
      tabId: opened.activeTabId,
      writerWorkspaceId: writerWorkspace.id,
      writerTabId: writerOpened.activeTabId,
      targetUrl: `${origin}/result`
    })
    expect(missingMarker.isError).toBe(true)
    expect(JSON.stringify(missingMarker)).toContain('expectedText or expectedSelector')
    const credentialTarget = await call('browser_public_outcome', {
      workspaceId: workspace.id,
      tabId: opened.activeTabId,
      writerWorkspaceId: writerWorkspace.id,
      writerTabId: writerOpened.activeTabId,
      targetUrl: `http://observer-user:observer-secret@127.0.0.1:${address.port}/result`,
      expectedText: 'public-observer-canary'
    })
    expect(credentialTarget.isError).toBe(true)
    expect(JSON.stringify(credentialTarget)).not.toContain('observer-secret')
    const publicReceipt = await publicOutcome()
    expect(publicReceipt.isError, JSON.stringify(publicReceipt.content)).not.toBe(true)
    const initialReceipt = parse<Record<string, unknown>>(publicReceipt)
    expect(initialReceipt).toMatchObject({
      formatVersion: 1,
      target: { fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) },
      outcome: 'publicly_observed',
      writer: {
        contextClass: 'standard', outcome: 'writer_context_verified',
        freshness: { status: 'fresh' },
        assessment: { status: 'candidate', evidenceClass: 'expected_marker' }
      },
      observer: {
        contextClass: 'public-observer', outcome: 'publicly_observed',
        freshness: { status: 'fresh' },
        assessment: { status: 'candidate', evidenceClass: 'expected_marker' }
      },
      automaticRetryAllowed: false
    })
    expect(JSON.stringify(initialReceipt)).not.toContain('public-observer-canary')
    expect(JSON.stringify(initialReceipt)).not.toContain('/result')
    expect(JSON.stringify(initialReceipt)).not.toContain(origin)

    publicVisible = false
    await call('browser_navigate', { workspaceId: workspace.id, tabId: opened.activeTabId, url: `${origin}/result` })
    await call('browser_wait', {
      workspaceId: workspace.id, tabId: opened.activeTabId, textGone: 'public-observer-canary'
    })
    expect(parse<Record<string, unknown>>(await publicOutcome())).toMatchObject({
      outcome: 'not_publicly_observed',
      writer: { outcome: 'writer_context_verified' },
      observer: {
        outcome: 'not_publicly_observed',
        assessment: { status: 'needs_review', evidenceClass: 'expected_marker_missing' }
      },
      automaticRetryAllowed: false
    })

    publicVisible = true
    await call('browser_navigate', { workspaceId: workspace.id, tabId: opened.activeTabId, url: `${origin}/result` })
    await call('browser_wait', {
      workspaceId: workspace.id, tabId: opened.activeTabId, text: 'public-observer-canary'
    })
    expect(parse<Record<string, unknown>>(await publicOutcome())).toMatchObject({
      outcome: 'publicly_observed',
      writer: { outcome: 'writer_context_verified' },
      observer: { outcome: 'publicly_observed' }
    })

    publicVisible = false
    await call('browser_navigate', { workspaceId: workspace.id, tabId: opened.activeTabId, url: `${origin}/result` })
    await call('browser_wait', {
      workspaceId: workspace.id, tabId: opened.activeTabId, textGone: 'public-observer-canary'
    })
    expect(parse<Record<string, unknown>>(await publicOutcome())).toMatchObject({
      outcome: 'not_publicly_observed', observer: { outcome: 'not_publicly_observed' }
    })

    await call('browser_navigate', {
      workspaceId: workspace.id, tabId: opened.activeTabId, url: `${origin}/different-target`
    })
    expect(parse<Record<string, unknown>>(await publicOutcome())).toMatchObject({
      outcome: 'reconciliation_required',
      observer: { outcome: 'reconciliation_required', freshness: { status: 'reconciliation_required' } },
      automaticRetryAllowed: false
    })

    const mutation = await call('browser_click', {
      workspaceId: workspace.id,
      tabId: opened.activeTabId,
      selector: '#mutate'
    })
    expect(mutation.isError).toBe(true)
    expect(JSON.stringify(mutation)).toContain('read-only public observer')
    expect(writes).toBe(0)

    const escaped = await call('browser_navigate', {
      workspaceId: workspace.id,
      tabId: opened.activeTabId,
      url: `http://localhost:${address.port}/result`
    })
    expect(escaped.isError).toBe(true)
    expect(JSON.stringify(escaped)).toContain('blocked')

    const profileInput = (name: string, workspaceIds: string[]) => ({
      name,
      preset: 'essentials' as const,
      workspaceIds,
      origins: [origin],
      expiresInMinutes: 60
    })
    const observerOnly = await appWindow.evaluate(input => (
      window as unknown as { hronautSettings: HronautSettingsApi }
    ).hronautSettings.createMcpCapabilityProfile(input), profileInput('Observer-only receipt', [workspace.id]))
    const bothContexts = await appWindow.evaluate(input => (
      window as unknown as { hronautSettings: HronautSettingsApi }
    ).hronautSettings.createMcpCapabilityProfile(input), profileInput(
      'Two-context receipt', [workspace.id, writerWorkspace.id]
    ))
    await appWindow.evaluate(() => (
      window as unknown as { hronautSettings: HronautSettingsApi }
    ).hronautSettings.setMcpAuthentication(true))
    const restrictedCall = async (credential: string): Promise<CallToolResult> => {
      const restricted = new Client({ name: 'public-observer-restricted-fixture', version: '1' })
      try {
        await restricted.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
          requestInit: { headers: { authorization: `Bearer ${credential}` } }
        }))
        await restricted.callTool({
          name: 'browser_workspaces',
          arguments: { action: 'resume', workspaceId: workspace.id, resumeKey: workspace.resumeKey }
        })
        const writerResume = await restricted.callTool({
          name: 'browser_workspaces',
          arguments: {
            action: 'resume', workspaceId: writerWorkspace.id, resumeKey: writerWorkspace.resumeKey
          }
        }) as CallToolResult
        if (writerResume.isError) return writerResume
        return await restricted.callTool({
          name: 'browser_public_outcome',
          arguments: {
            workspaceId: workspace.id,
            tabId: opened.activeTabId,
            writerWorkspaceId: writerWorkspace.id,
            writerTabId: writerOpened.activeTabId,
            targetUrl: `${origin}/result`,
            expectedText: 'public-observer-canary'
          }
        }) as CallToolResult
      } finally {
        await restricted.close().catch(() => undefined)
      }
    }
    const deniedWriterScope = await restrictedCall(observerOnly.credential)
    expect(deniedWriterScope).toMatchObject({
      isError: true,
      structuredContent: {
        status: 'POLICY_REJECTED',
        policyDecision: { firstDenyingRule: 'workspace' }
      }
    })
    expect(JSON.stringify(deniedWriterScope)).not.toContain(writerWorkspace.id)
    const authorizedContexts = await restrictedCall(bothContexts.credential)
    expect(authorizedContexts.isError, JSON.stringify(authorizedContexts)).not.toBe(true)
    expect(parse<Record<string, unknown>>(authorizedContexts)).toMatchObject({
      outcome: 'reconciliation_required',
      automaticRetryAllowed: false
    })
  } finally {
    await client.close()
    await closeFixtureServer(server)
  }
})
