import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { HronautApi, HronautSettingsApi } from '../../src/shared/types.js'
import type { HumanWaitingRecord } from '../../src/shared/human-waiting.js'
import { expect, test, text } from './capability-fixtures.js'

for (const approvedButton of ['omitted', 'left', 'right'] as const) {
  test(`review binds ${approvedButton} button and rejects a different native button`, async ({ capabilities, electronApp, appWindow }) => {
    const { client, tabId, fixtureUrl, workspace } = capabilities
    await electronApp.evaluate(async ({ webContents }, url) => {
      await webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript("document.body.innerHTML='<button id=target>Open menu</button>';window.buttonEvents=[];document.querySelector('button').oncontextmenu=e=>{e.preventDefault();buttonEvents.push('right')};document.querySelector('button').onclick=()=>buttonEvents.push('left');void 0")
    }, fixtureUrl)
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, true), tabId)
    const args = { workspaceId: workspace.workspaceId, tabId, selector: '#target', native: true, ...(approvedButton === 'omitted' ? {} : { button: approvedButton }) }
    const approve = async () => {
      const proposed = await client.callTool({ name: 'browser_human_waiting', arguments: { action: 'request', runId: randomUUID(), decision: 'approve-action', timeoutMs: 60_000,
      review: { toolName: 'browser_click', arguments: args, reversibility: 'unknown', representation: 'bounded-description', description: 'Open the fixture menu only' } } }) as CallToolResult
    expect(proposed.isError, text(proposed)).not.toBe(true)
    const record = JSON.parse(text(proposed)) as HumanWaitingRecord
    await appWindow.evaluate(async id => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const continuity = await api.reviewWorkspaceContinuity(id)
      await api.reconcileWorkspaceContinuity(id, continuity.reviewId!, true)
    }, workspace.workspaceId)
    const approved = await appWindow.evaluate(record => (window as unknown as { hronaut: HronautApi }).hronaut.changeHumanWaiting(record.workspaceId, record.id, record.revision, 'resolve', { accountAndTargetVerified: true }), record)
    return { reviewId: approved.id, reviewRevision: approved.revision }
    }
    const review = await approve()
    const mismatched = await client.callTool({ name: 'browser_click', arguments: { ...args, ...review, button: approvedButton === 'right' ? 'left' : 'right' } }) as CallToolResult
    expect(mismatched.isError, text(mismatched)).toBe(true)
    const events = () => electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('window.buttonEvents'), fixtureUrl)
    expect(await events()).toEqual([])
    const freshReview = await approve()
    const accepted = await client.callTool({ name: 'browser_click', arguments: { ...args, ...freshReview } }) as CallToolResult
    expect(accepted.isError, text(accepted)).not.toBe(true)
    expect(await events()).toEqual([approvedButton === 'right' ? 'right' : 'left'])
    const replay = await client.callTool({ name: 'browser_click', arguments: { ...args, ...freshReview } }) as CallToolResult
    expect(replay.isError).toBe(true)
    expect(await events()).toHaveLength(1)
  })
}

for (const allowed of ['left', 'right'] as const) {
  test(`capability button constraint permits only explicit ${allowed}`, async ({ capabilities, electronApp, appWindow, mcpPort }) => {
    const { client: owner, tabId, fixtureUrl, workspace } = capabilities
    await owner.callTool({ name: 'browser_workspaces', arguments: { action: 'release-ownership', workspaceId: workspace.workspaceId } })
    await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setMcpAuthentication(true))
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabHumanInteractionLocked(id, true), tabId)
    await electronApp.evaluate(async ({ webContents }, url) => { await webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript("document.body.innerHTML='<button id=target>Menu</button>';window.buttonEvents=[];document.querySelector('button').oncontextmenu=e=>{e.preventDefault();buttonEvents.push('right')};document.querySelector('button').onclick=()=>buttonEvents.push('left');void 0") }, fixtureUrl)
    const grant = await appWindow.evaluate(button => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.createMcpCapabilityProfile({ name: 'Exact click button', preset: 'complete', argumentConstraints: { 'browser_click.button': [button] } }), allowed)
    const client = new Client({ name: 'exact-button', version: '1' })
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${grant.credential}` } } }))
      await connectMcpWorkspace(client, 'Button scope', false, workspace)
      for (const button of [undefined, allowed === 'left' ? 'right' : 'left']) {
        const denied = await client.callTool({ name: 'browser_click', arguments: { tabId, selector: '#target', native: true, ...(button ? { button } : {}) } }) as CallToolResult
        expect(denied.isError).toBe(true)
        expect(denied.structuredContent).toMatchObject({ status: 'POLICY_REJECTED' })
      }
      expect(await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('window.buttonEvents'), fixtureUrl)).toEqual([])
      const accepted = await client.callTool({ name: 'browser_click', arguments: { tabId, selector: '#target', native: true, button: allowed } }) as CallToolResult
      expect(accepted.isError, text(accepted)).not.toBe(true)
      expect(await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.executeJavaScript('window.buttonEvents'), fixtureUrl)).toEqual([allowed])
    } finally { await client.close() }
  })
}
