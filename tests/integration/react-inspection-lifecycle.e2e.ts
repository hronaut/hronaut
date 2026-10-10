import type { ReactInspectionResult } from '../../src/shared/react-inspection.js'
import type { BrowserTabState, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, closeHronaut, launchHronaut } from './fixtures.js'
import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { decode, expect, rejected, test } from './react-inspection-fixtures.js'
import { waitForReactRestartMcp } from './react-inspection-startup.js'

for (const delayedDocument of [false, true]) {
test(`archive/restore and delete interrupt reads and never restore prior activation or IDs${delayedDocument ? ' with delayed restored document' : ''}`, async ({ react, appWindow, electronApp }) => {
  const first = await react.enable('/lifecycle-armed')
  await react.holdRead()
  const pending = react.react('tree').then(rejected, () => true)
  await react.entered()
  await appWindow.evaluate(id => (window as unknown as {hronaut: HronautApi}).hronaut.saveAndCloseTabGroup(id), react.workspace.id)
  await react.release()
  expect(await pending).toBe(true)
  expect(rejected(await react.react('tree', first.nodes[0]!.id))).toBe(true)
  await react.success(react.call('browser_saved_workspaces', { action: 'resume', savedWorkspaceId: react.workspace.id, resumeKey: react.workspace.resumeKey }))
  if (delayedDocument) react.holdDocument('/lifecycle-armed')
  await react.success(react.call('browser_saved_workspaces', { action: 'open', savedWorkspaceId: react.workspace.id }))
  const tabs = await react.success<BrowserTabState[]>(react.call('browser_tabs', { workspaceId: react.workspace.id }))
  const tabId = tabs.find(tab => tab.url === react.origin + '/lifecycle-armed')!.id
  const request = (action: string, subtreeId?: string) => react.call('browser_react', { workspaceId: react.workspace.id, tabId, action, ...(subtreeId ? {subtreeId} : {}) })
  await react.success(react.call('browser_select_tab', { workspaceId: react.workspace.id, tabId }))
  expect((await react.success<ReactInspectionResult>(request('status'))).status).toBe('disabled')
  expect(rejected(await request('tree', first.nodes[0]!.id))).toBe(true)
  if (delayedDocument) {
    // Opening a saved workspace returns before its HTTP document has committed.
    // An enable attempted against the still-empty native URL must remain inactive.
    expect(await react.success<ReactInspectionResult>(request('enable'))).toMatchObject({
      status: 'unavailable', enabled: false, nodes: []
    })
    react.releaseDocument()
  }
  await expect.poll(() => electronApp.context().pages().some(page => page.url() === react.origin + '/lifecycle-armed')).toBe(true)
  const reopenedPage = electronApp.context().pages().find(page => page.url() === react.origin + '/lifecycle-armed')!
  await expect(reopenedPage.locator('span')).toHaveCount(1)
  expect(await reopenedPage.evaluate('fixtureSawHook')).toBe(false)
  expect((await react.success<ReactInspectionResult>(request('enable'))).status).toBe('reload-required')
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

}

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

for (const heldListener of [false, true]) {
test(`restart never persists installation intent or revives an observation ID${heldListener ? ' while listener startup is held' : ''}`, async ({ react, electronApp, profileDirectory, mcpPort, mcpToken }) => {
  const before = await react.enable('/restart')
  const previousProcess = electronApp.process()
  await closeHronaut(electronApp)
  const args = heldListener ? ['--require', await holdRestartListener(profileDirectory)] : []
  const restarted = await launchHronaut(profileDirectory, mcpPort, 1, [], args)
  const client = new Client({name:'react-restart',version:'1'})
  let connection: Promise<unknown> | undefined
  try {
    if (heldListener) await expect.poll(() => restarted.app.evaluate(() => typeof (globalThis as RestartGlobal).__releaseReactListener)).toBe('function')
    let connecting = false
    connection = (async () => {
      await waitForReactRestartMcp(previousProcess, restarted, mcpPort)
      connecting = true
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {requestInit:{headers:{authorization:`Bearer ${mcpToken}`}}}))
    })().then(() => null, error => error)
    if (heldListener) {
      // A real native roundtrip observes the still-held server after the waiter
      // starts. The MCP connection itself must not have been attempted yet.
      expect(await restarted.app.evaluate(() => (globalThis as RestartGlobal).__reactListener?.listening)).toBe(false)
      expect(connecting, 'MCP connect must wait for its restarted listener').toBe(false)
      await restarted.app.evaluate(() => { (globalThis as RestartGlobal).__releaseReactListener!() })
    }
    expect(await connection).toBe(null)
    const call = (name: string, args: Record<string, unknown>) => client.callTool({name,arguments:args}) as Promise<CallToolResult>
    expect((await call('browser_workspaces', {action:'resume',workspaceId:react.workspace.id,resumeKey:react.workspace.resumeKey})).isError).not.toBe(true)
    expect((await call('browser_select_tab', {workspaceId:react.workspace.id,tabId:react.tabId})).isError).not.toBe(true)
    const status = await call('browser_react', {workspaceId:react.workspace.id,tabId:react.tabId,action:'status'})
    expect(status.isError).not.toBe(true)
    expect(decode<ReactInspectionResult>(status).status).toBe('disabled')
    expect(rejected(await call('browser_react', {workspaceId:react.workspace.id,tabId:react.tabId,action:'tree',subtreeId:before.nodes[0]!.id}))).toBe(true)
  } finally {
    await restarted.app.evaluate(() => { (globalThis as RestartGlobal).__releaseReactListener?.() }).catch(() => {})
    await connection
    await client.close().catch(() => {})
    await closeHronaut(restarted.app)
  }
})
}

test('restart readiness rejects unrelated healthy listeners and times out while its own listener is held', async ({ electronApp, profileDirectory, mcpPort }) => {
  const previousProcess = electronApp.process()
  await closeHronaut(electronApp)
  const restarted = await launchHronaut(profileDirectory, mcpPort, 1, [], ['--require', await holdRestartListener(profileDirectory)])
  let requests = 0
  const foreign = createServer((_request, response) => {
    requests += 1
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, name: 'hronaut' }))
  })
  try {
    await expect.poll(() => restarted.app.evaluate(() => typeof (globalThis as RestartGlobal).__releaseReactListener)).toBe('function')
    await new Promise<void>(resolve => foreign.listen(mcpPort, '127.0.0.1', resolve))
    // Even a valid health payload at the correct port is insufficient until
    // this restarted process confirms ownership of its ready listener.
    expect((await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok).toBe(true)
    await expect(waitForReactRestartMcp(previousProcess, restarted, mcpPort, 500)).rejects.toThrow('Restarted MCP listener must become ready')
    expect(requests).toBe(1)
    expect(await restarted.app.evaluate(() => (globalThis as RestartGlobal).__reactListener?.listening)).toBe(false)
  } finally {
    await closeFixtureServer(foreign)
    await restarted.app.evaluate(() => { (globalThis as RestartGlobal).__releaseReactListener?.() }).catch(() => {})
    await closeHronaut(restarted.app)
  }
})

type RestartGlobal = typeof globalThis & { __releaseReactListener?: () => void; __reactListener?: { listening: boolean } }

async function holdRestartListener(directory: string): Promise<string> {
  const hook = join(directory, 'hold-react-listener.cjs')
  await writeFile(hook, `
    const { Server } = require('node:http');
    const original = Server.prototype.listen;
    Server.prototype.listen = function (...args) {
      const port = typeof args[0] === 'object' ? args[0].port : args[0];
      if (Number(port) !== Number(process.env.HRONAUT_MCP_PORT)) return original.apply(this, args);
      Server.prototype.listen = original;
      globalThis.__reactListener = this;
      globalThis.__releaseReactListener = () => { delete globalThis.__releaseReactListener; original.apply(this, args); };
      return this;
    };
  `)
  return hook
}
