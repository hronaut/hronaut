import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserAccessibilityAudit, BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('compares a volatile accessibility baseline without carrying it to another tab', async ({ electronApp, appWindow, mcpPort, mcpToken }) => {
  const fixture = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><html lang="en"><title>Accessibility comparison</title><main><button id="save"></button><img id="hero" alt="Hero"></main></html>')
  })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'accessibility-comparison', version: '1' })
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  const decode = <T>(result: CallToolResult): T => {
    expect(result.isError).not.toBe(true)
    return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as T
  }
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const workspace = decode<{ id: string }>(await call('browser_workspaces', {
      action: 'create', storage: 'scratch', name: 'Accessibility comparison'
    }))
    const state = decode<BrowserState>(await call('browser_new_tab', { workspaceId: workspace.id, url: `${origin}/before` }))
    const tabId = state.activeTabId!
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
      webContents.getAllWebContents().some(page => page.getURL() === url && !page.isLoading())
    ), `${origin}/before`)).toBe(true)

    const baseline = decode<BrowserAccessibilityAudit>(await call('browser_accessibility_audit', {
      workspaceId: workspace.id,
      tabId,
      action: 'set-baseline',
      maxViolations: 50,
      maxNodesPerViolation: 3
    }))
    expect(baseline).toMatchObject({ action: 'set-baseline', baseline: { url: `${origin}/before`, truncated: false } })
    expect(baseline.violations).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'button-name' })]))

    await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)
      if (!page) throw new Error('Missing accessibility comparison page')
      await page.executeJavaScript(`(() => {
        document.querySelector('#save').setAttribute('aria-label', 'Save');
        document.querySelector('#hero').removeAttribute('alt');
      })()`)
    }, `${origin}/before`)
    const compared = decode<BrowserAccessibilityAudit>(await call('browser_accessibility_audit', {
      workspaceId: workspace.id,
      tabId,
      maxViolations: 50,
      maxNodesPerViolation: 3
    }))
    expect(compared.comparison).toMatchObject({ comparable: true, sameUrl: true })
    expect(compared.comparison?.newFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'image-alt', targets: expect.arrayContaining(['#hero']) })
    ]))
    expect(compared.comparison?.resolvedFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: 'button-name', targets: expect.arrayContaining(['#save']) })
    ]))

    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: /Run accessibility audit/ }).click()
    const accessibilityPanel = appWindow.getByRole('dialog', { name: 'Accessibility' })
    await expect(accessibilityPanel).toContainText('New findings')
    await expect(accessibilityPanel).toContainText('Images must have alternative text · image-alt')
    await expect(accessibilityPanel).toContainText('Buttons must have discernible text · button-name')
    await accessibilityPanel.getByRole('button', { name: 'Close accessibility audit' }).click()

    decode<BrowserState>(await call('browser_navigate', { workspaceId: workspace.id, tabId, url: `${origin}/after` }))
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
      webContents.getAllWebContents().some(page => page.getURL() === url && !page.isLoading())
    ), `${origin}/after`)).toBe(true)
    const afterNavigation = decode<BrowserAccessibilityAudit>(await call('browser_accessibility_audit', {
      workspaceId: workspace.id,
      tabId,
      maxViolations: 50,
      maxNodesPerViolation: 3
    }))
    expect(afterNavigation.comparison).toMatchObject({ comparable: true, sameUrl: false })

    const cleared = decode<BrowserAccessibilityAudit>(await call('browser_accessibility_audit', {
      workspaceId: workspace.id,
      tabId,
      action: 'clear-baseline',
      maxViolations: 50,
      maxNodesPerViolation: 3
    }))
    expect(cleared).toMatchObject({ action: 'clear-baseline', baselineCleared: true })
    expect(cleared).not.toHaveProperty('baseline')
    expect(cleared).not.toHaveProperty('comparison')

    decode<BrowserState>(await call('browser_close_tab', { workspaceId: workspace.id, tabId }))
    const replacement = decode<BrowserState>(await call('browser_new_tab', { workspaceId: workspace.id, url: `${origin}/replacement` }))
    const replacementAudit = decode<BrowserAccessibilityAudit>(await call('browser_accessibility_audit', {
      workspaceId: workspace.id,
      tabId: replacement.activeTabId,
      maxViolations: 50,
      maxNodesPerViolation: 3
    }))
    expect(replacementAudit).not.toHaveProperty('baseline')
    expect(replacementAudit).not.toHaveProperty('comparison')
  } finally {
    await client.close()
    await closeFixtureServer(fixture)
  }
})
