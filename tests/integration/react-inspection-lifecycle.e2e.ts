import type { ReactInspectionResult } from '../../src/shared/react-inspection.js'
import type { BrowserTabState, HronautApi } from '../../src/shared/types.js'
import { closeHronaut, launchHronaut } from './fixtures.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { decode, expect, rejected, test } from './react-inspection-fixtures.js'

test('archive/restore and delete interrupt reads and never restore prior activation or IDs', async ({ react, appWindow, electronApp }) => {
  const first = await react.enable('/lifecycle-armed')
  await react.holdRead()
  const pending = react.react('tree').then(rejected, () => true)
  await react.entered()
  await appWindow.evaluate(id => (window as unknown as {hronaut: HronautApi}).hronaut.saveAndCloseTabGroup(id), react.workspace.id)
  await react.release()
  expect(await pending).toBe(true)
  expect(rejected(await react.react('tree', first.nodes[0]!.id))).toBe(true)
  await react.success(react.call('browser_saved_workspaces', { action: 'resume', savedWorkspaceId: react.workspace.id, resumeKey: react.workspace.resumeKey }))
  await react.success(react.call('browser_saved_workspaces', { action: 'open', savedWorkspaceId: react.workspace.id }))
  const tabs = await react.success<BrowserTabState[]>(react.call('browser_tabs', { workspaceId: react.workspace.id }))
  const tabId = tabs.find(tab => tab.url === react.origin + '/lifecycle-armed')!.id
  const request = (action: string, subtreeId?: string) => react.call('browser_react', { workspaceId: react.workspace.id, tabId, action, ...(subtreeId ? {subtreeId} : {}) })
  await react.success(react.call('browser_select_tab', { workspaceId: react.workspace.id, tabId }))
  expect((await react.success<ReactInspectionResult>(request('status'))).status).toBe('disabled')
  expect(rejected(await request('tree', first.nodes[0]!.id))).toBe(true)
  await react.success(request('enable'))
  await react.success(react.call('browser_navigate', { workspaceId: react.workspace.id, tabId, url: react.origin + '/restored' }))
  // Navigation completion does not guarantee that React has committed its fixture tree.
  await expect.poll(() => electronApp.context().pages().some(page => page.url() === react.origin + '/restored')).toBe(true)
  const restoredPage = electronApp.context().pages().find(page => page.url() === react.origin + '/restored')!
  await expect(restoredPage.locator('span')).toHaveCount(1)
  const restored = await react.success<ReactInspectionResult>(request('tree'))
  expect(restored.status).toBe('ready')
  expect(restored.nodes.length).toBeGreaterThan(0)
  const restoredNodeId = restored.nodes[0]!.id
  expect(restored.installationId).not.toBe(first.installationId)
  expect(rejected(await request('tree', first.nodes[0]!.id))).toBe(true)
  await appWindow.evaluate(id => (window as unknown as {hronaut: HronautApi}).hronaut.closeWorkspace(id), react.workspace.id)
  expect(rejected(await request('tree', restoredNodeId))).toBe(true)
  expect(await electronApp.evaluate(({webContents}, url) => webContents.getAllWebContents().some(page => page.getURL() === url), react.origin + '/restored')).toBe(false)
})

test('failed deletion rollback recreates the tab with inspection off', async ({ react, electronApp, appWindow }) => {
  const first = await react.enable('/delete-rollback')
  await electronApp.evaluate(({ webContents }, id) => {
    const session = webContents.fromId(id)!.session
    const original = session.clearData.bind(session)
    ;(globalThis as typeof globalThis & {__restoreReactClearData?: () => void}).__restoreReactClearData = () => { session.clearData = original }
    session.clearData = async () => { throw new Error('Synthetic deletion failure') }
  }, react.contentsId)
  try {
    await expect(appWindow.evaluate(id => (window as unknown as {hronaut: HronautApi}).hronaut.closeWorkspace(id), react.workspace.id)).rejects.toThrow()
    await react.success(react.call('browser_select_tab', { workspaceId: react.workspace.id, tabId: react.tabId }))
    expect((await react.success<ReactInspectionResult>(react.react('status'))).status).toBe('disabled')
    expect(rejected(await react.react('tree', first.nodes[0]!.id))).toBe(true)
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === react.origin + '/delete-rollback')).toBe(true)
    const restored = electronApp.context().pages().find(page => page.url() === react.origin + '/delete-rollback')!
    await expect(restored.locator('span')).toHaveCount(1)
    expect(await restored.evaluate('fixtureSawHook')).toBe(false)
  } finally {
    await electronApp.evaluate(() => {
      const state = globalThis as typeof globalThis & {__restoreReactClearData?: () => void}
      state.__restoreReactClearData?.(); delete state.__restoreReactClearData
    })
  }
})

test('restart never persists installation intent or revives an observation ID', async ({ react, electronApp, profileDirectory, mcpPort, mcpToken }) => {
  const before = await react.enable('/restart')
  await closeHronaut(electronApp)
  const restarted = await launchHronaut(profileDirectory, mcpPort)
  const client = new Client({name:'react-restart',version:'1'})
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {requestInit:{headers:{authorization:`Bearer ${mcpToken}`}}}))
    const call = (name: string, args: Record<string, unknown>) => client.callTool({name,arguments:args}) as Promise<CallToolResult>
    expect((await call('browser_workspaces', {action:'resume',workspaceId:react.workspace.id,resumeKey:react.workspace.resumeKey})).isError).not.toBe(true)
    expect((await call('browser_select_tab', {workspaceId:react.workspace.id,tabId:react.tabId})).isError).not.toBe(true)
    const status = await call('browser_react', {workspaceId:react.workspace.id,tabId:react.tabId,action:'status'})
    expect(status.isError).not.toBe(true)
    expect(decode<ReactInspectionResult>(status).status).toBe('disabled')
    expect(rejected(await call('browser_react', {workspaceId:react.workspace.id,tabId:react.tabId,action:'tree',subtreeId:before.nodes[0]!.id}))).toBe(true)
  } finally {
    await client.close().catch(() => {})
    await closeHronaut(restarted.app)
  }
})
