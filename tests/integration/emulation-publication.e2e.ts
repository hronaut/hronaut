import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { createServer, type ServerResponse } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer } from './fixtures.js'
import { expect, test, text } from './capability-fixtures.js'

type Gate = { configurationCommands?: string[]; held: boolean; release(): void; restore(): void }
type Scope = typeof globalThis & { __emulationPublication?: Gate }

for (const change of ['unchanged', 'pause', 'same-url-reload'] as const) {
  test(`emulation publication retains its original certificate through audit: ${change}`, async ({ capabilities, electronApp, appWindow }) => {
    const { client, tabId, fixtureUrl } = capabilities
    const started = await client.callTool({ name: 'browser_audit_receipts', arguments: { action: 'start' } }) as CallToolResult
    expect(started.isError, text(started)).not.toBe(true)
    await electronApp.evaluate(() => {
      const { syncBuiltinESMExports } = process.getBuiltinModule('module') as typeof import('node:module')
      const fs = process.getBuiltinModule('node:fs/promises') as typeof import('node:fs/promises')
      const open = fs.open
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const gate: Gate = { held: false, release, restore: () => { release(); fs.open = open; syncBuiltinESMExports() } }
      ;(globalThis as Scope).__emulationPublication = gate
      let actionId = ''
      fs.open = async (...args: Parameters<typeof open>) => {
        const handle = await open(...args)
        if (String(args[0]).includes('/audit-receipts/') && args[1] === 'a') {
          const write = handle.writeFile.bind(handle)
          handle.writeFile = async (data, options) => {
            const event = JSON.parse(String(data)).event as { phase: string; toolName?: string; actionId?: string }
            if (event.phase === 'decision' && event.toolName === 'browser_emulate') actionId = event.actionId!
            if (event.phase === 'outcome' && event.actionId === actionId && !gate.held) { gate.held = true; await barrier }
            return write(data, options)
          }
        }
        return handle
      }
      syncBuiltinESMExports()
    })
    const pending = client.callTool({ name: 'browser_emulate', arguments: { tabId, colorScheme: 'dark' } }) as Promise<CallToolResult>
    try {
      await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__emulationPublication!.held)).toBe(true)
      if (change === 'pause') await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, true), tabId)
      if (change === 'same-url-reload') await electronApp.evaluate(async ({ webContents }, url) => { await webContents.getAllWebContents().find(p => p.getURL() === url)!.loadURL(url) }, fixtureUrl)
      await electronApp.evaluate(() => (globalThis as Scope).__emulationPublication!.release())
      const result = await pending
      expect(result.isError === true).toBe(change !== 'unchanged')
      if (change !== 'unchanged') expect(result.structuredContent).toMatchObject({ status: 'OUTCOME_UNKNOWN', effects: 'possible', retrySafe: false })
      const state = await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(t => t.id === id), tabId)
      expect(state?.emulation).toMatchObject({ colorScheme: 'dark' })
      expect(state?.emulationState).toBeUndefined()
    } finally {
      await electronApp.evaluate(() => { (globalThis as Scope).__emulationPublication?.restore(); delete (globalThis as Scope).__emulationPublication }).catch(() => undefined)
      await pending.catch(() => undefined)
    }
  })
}

test('an already-started same-origin commit vetoes queued restoration before another configuration command', async ({ capabilities, electronApp, appWindow }) => {
  let heldResponse: ServerResponse | undefined
  let hold = false
  const server = createServer((request, response) => {
    if (request.url !== '/document') { response.end(); return }
    if (hold) heldResponse = response
    else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><link rel="icon" href="data:,"><title>Original document</title>Original') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture address missing')
  const url = `http://127.0.0.1:${address.port}/document`
  const { tabId, fixtureUrl } = capabilities
  type Outcome = { isError: boolean; error?: string }
  type Renderer = { hronaut: HronautApi; pendingRestore?: Promise<Outcome> }
  let predecessor: Promise<Outcome> | undefined
  try {
    await electronApp.evaluate(async ({ webContents }, input) => { await webContents.getAllWebContents().find(p => p.getURL() === input.from)!.loadURL(input.to) }, { from: fixtureUrl, to: url })
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
      const api = page.debugger, original = api.sendCommand
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const gate: Gate = { configurationCommands: [], held: false, release, restore: () => { release(); api.sendCommand = original } }
      ;(globalThis as Scope).__emulationPublication = gate
      api.sendCommand = async (method, ...args) => {
        if (/^(Emulation\.|Animation\.|Overlay\.|Network\.(set|emulate|override))/.test(method)) gate.configurationCommands!.push(method)
        const result = await original.call(api, method, ...args)
        if (!gate.held && method === 'Emulation.setEmulatedMedia') { gate.held = true; await barrier }
        return result
      }
    }, url)
    // Establish an actual queue predecessor before navigation starts. This
    // avoids assuming that background input-guard commands have already settled.
    predecessor = appWindow.evaluate(async id => {
      try { await (window as unknown as Renderer).hronaut.resetTabEmulation(id); return { isError: false } }
      catch (error) { return { isError: true, error: String(error) } }
    }, tabId)
    await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__emulationPublication!.held)).toBe(true)
    hold = true
    await electronApp.evaluate(({ webContents }, url) => { webContents.getAllWebContents().find(p => p.getURL() === url)!.reload() }, url)
    await expect.poll(() => Boolean(heldResponse)).toBe(true)
    // Restoration is admitted after did-start-navigation, but before commit.
    // IPC getState is a barrier after its manager invocation has queued.
    await appWindow.evaluate(async id => {
      const scope = window as unknown as Renderer
      scope.pendingRestore = scope.hronaut.recoverTabEmulation(id).then(() => ({ isError: false }), error => ({ isError: true, error: String(error) }))
      await scope.hronaut.getState()
    }, tabId)
    const beforeCommit = await electronApp.evaluate(() => (globalThis as Scope).__emulationPublication!.configurationCommands!)
    expect(beforeCommit).toContain('Emulation.setEmulatedMedia')
    heldResponse!.setHeader('Content-Type', 'text/html')
    heldResponse!.end('<!doctype html><link rel="icon" href="data:,"><title>Replacement document</title>Replacement')
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!.getTitle(), url)).toBe('Replacement document')
    await electronApp.evaluate(() => (globalThis as Scope).__emulationPublication!.release())
    expect((await predecessor).isError).toBe(true)
    const result = await appWindow.evaluate(() => (window as unknown as Renderer).pendingRestore!)
    expect(result.isError).toBe(true)
    expect(result.error).toContain('Emulation target changed')
    expect(await electronApp.evaluate(() => (globalThis as Scope).__emulationPublication!.configurationCommands)).toEqual(beforeCommit)
    const state = await appWindow.evaluate(async id => (await (window as unknown as Renderer).hronaut.getState()).tabs.find(t => t.id === id), tabId)
    expect(state?.emulationState).toMatchObject({ application: 'unknown', retainedSettings: { colorScheme: 'auto' } })
  } finally {
    heldResponse?.end()
    await electronApp.evaluate(() => { (globalThis as Scope).__emulationPublication?.restore(); delete (globalThis as Scope).__emulationPublication }).catch(() => undefined)
    await predecessor?.catch(() => undefined)
    await appWindow.evaluate(async () => { await (window as unknown as Renderer).pendingRestore; delete (window as unknown as Renderer).pendingRestore }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})

test('session termination cannot release workspace ownership while cancelled emulation is still native-pending', async ({ capabilities, electronApp, mcpPort, mcpToken }) => {
  const { client, tabId, fixtureUrl, workspace } = capabilities
  await electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(p => p.getURL() === url)!
    const api = page.debugger, original = api.sendCommand
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const gate: Gate = { held: false, release, restore: () => { release(); api.sendCommand = original } }
    ;(globalThis as Scope).__emulationPublication = gate
    api.sendCommand = async (method, ...args) => {
      const result = await original.call(api, method, ...args)
      if (!gate.held && method === 'Emulation.setEmulatedMedia') { gate.held = true; await barrier }
      return result
    }
  }, fixtureUrl)
  const transport = client.transport as StreamableHTTPClientTransport
  const send = transport.send.bind(transport)
  let delivered = false
  transport.send = async (message, options) => { await send(message, options); if ('method' in message && message.method === 'notifications/cancelled') delivered = true }
  const abort = new AbortController()
  const pending = client.callTool({ name: 'browser_emulate', arguments: { tabId, colorScheme: 'dark' } }, undefined, { signal: abort.signal }).catch(() => undefined)
  const replacement = new Client({ name: 'emulation-replacement', version: '1.0.0' })
  try {
    await expect.poll(() => electronApp.evaluate(() => (globalThis as Scope).__emulationPublication!.held)).toBe(true)
    abort.abort()
    await expect.poll(() => delivered).toBe(true)
    await pending
    await transport.terminateSession()
    await replacement.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    await connectMcpWorkspace(replacement, 'Emulation replacement', false, workspace)
    const ownership = await replacement.callTool({ name: 'browser_workspaces', arguments: { action: 'ownership-status', workspaceId: workspace.workspaceId } }) as CallToolResult
    expect(JSON.parse(text(ownership)).writeLease).toMatchObject({ status: 'busy', holder: 'other' })
    const overlapping = await replacement.callTool({ name: 'browser_emulate', arguments: { tabId, recover: true } }) as CallToolResult
    expect(overlapping.isError).toBe(true)
    await electronApp.evaluate(() => (globalThis as Scope).__emulationPublication!.release())
    await expect.poll(async () => (await replacement.callTool({ name: 'browser_workspaces', arguments: { action: 'claim-ownership', workspaceId: workspace.workspaceId } }) as CallToolResult).isError === true).toBe(false)
    const retained = await replacement.callTool({ name: 'browser_emulate', arguments: { tabId } }) as CallToolResult
    expect(JSON.parse(text(retained))).toMatchObject({ application: 'unknown', retainedSettings: { colorScheme: 'auto' } })
  } finally {
    transport.send = send
    await electronApp.evaluate(() => { (globalThis as Scope).__emulationPublication?.restore(); delete (globalThis as Scope).__emulationPublication }).catch(() => undefined)
    await pending
    await replacement.close()
  }
})
