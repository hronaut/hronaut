import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { closeHronaut, launchHronaut } from './fixtures.js'
import { test, expect, installLabelFault, labelFault, releaseLabelFault, restoreLabelFault } from './new-tab-label-fixtures.js'

for (const operation of ['close', 'archive'] as const) {
  test(`human ${operation} waits for admitted creation label and retains it on restore`, async ({ capabilities, electronApp, appWindow, profileDirectory }) => {
    const { client, fixtureUrl, workspace } = capabilities
    const marker = `Creation ${operation} role`
    await installLabelFault(electronApp, profileDirectory, marker, 'hold-rename')
    let creation: Promise<CallToolResult> | undefined, lifecycle: Promise<unknown> | undefined
    try {
      const prior = new Set((await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())).tabs.map(tab => tab.id))
      creation = client.callTool({ name: 'browser_new_tab', arguments: { url: fixtureUrl, label: marker } }) as Promise<CallToolResult>
      await expect.poll(async () => (await labelFault(electronApp)).entered).toBe(true)
      const id = (await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())).tabs.find(tab => !prior.has(tab.id))!.id
      lifecycle = appWindow.evaluate(({ id, operation, workspaceId }) => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        return operation === 'close' ? api.closeTab(id) : api.saveAndCloseTabGroup(workspaceId)
      }, { id, operation, workspaceId: workspace.workspaceId })
      await expect(appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabLabel(id, 'Too late'), id)).rejects.toThrow('Wait for the tab operation')
      await releaseLabelFault(electronApp)
      await creation; await lifecycle
      const current = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
      if (operation === 'close') {
        const closed = current.closedTabs.find(tab => tab.label === marker)!
        expect(closed).toBeTruthy()
        const restored = await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.reopenClosedTab(id), closed.id)
        expect(restored.tabs.some(tab => tab.label === marker)).toBe(true)
      } else {
        const restored = await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.restoreSavedTabGroup(id), workspace.workspaceId)
        expect(restored.tabs.some(tab => tab.label === marker)).toBe(true)
      }
    } finally { await restoreLabelFault(electronApp); await Promise.allSettled([creation, lifecycle].filter(Boolean)) }
  })
}

test('shutdown drains an admitted MCP creation label before restart', async ({ profileDirectory, mcpPort }) => {
  let instance: Awaited<ReturnType<typeof launchHronaut>> | undefined
  const client = new Client({ name: 'creation-shutdown', version: '1' })
  let creation: Promise<unknown> | undefined
  try {
    instance = await launchHronaut(profileDirectory, mcpPort)
    const token = (await readFile(join(profileDirectory, 'mcp-token'), 'utf8')).trim()
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
    await connectMcpWorkspace(client, 'Creation shutdown', false)
    await installLabelFault(instance.app, profileDirectory, 'Creation shutdown role', 'hold-rename')
    creation = client.callTool({ name: 'browser_new_tab', arguments: { label: 'Creation shutdown role' } }).catch(() => undefined)
    await expect.poll(async () => (await labelFault(instance!.app)).entered).toBe(true)
    await instance.app.evaluate(({ app }) => { app.quit() })
    await restoreLabelFault(instance.app)
    await creation
    await client.close().catch(() => undefined)
    await closeHronaut(instance.app)
    instance = await launchHronaut(profileDirectory, mcpPort)
    const state = await instance.window.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
    expect(state.tabs.some(tab => tab.label === 'Creation shutdown role')).toBe(true)
  } finally {
    if (instance) { await restoreLabelFault(instance.app).catch(() => undefined); await closeHronaut(instance.app) }
    await client.close().catch(() => undefined)
    await Promise.allSettled([creation].filter(Boolean))
  }
})
