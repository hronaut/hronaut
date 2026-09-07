import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function text(result: CallToolResult): string {
  const entry = result.content.find(item => item.type === 'text')
  return entry?.type === 'text' ? entry.text : ''
}

test('serializes agent site cleanup with human workspace copies and workspace archiving', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Privacy locking fixture</title><main>Storage locking</main>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const sourceUrl = `${origin}/source`
  const targetUrl = `${origin}/target`
  const client = new Client({ name: 'workspace-privacy-locks', version: '1' })
  const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => await client.callTool({ name, arguments: args }) as CallToolResult
  try {
    await appWindow.evaluate('window.hronautSettings.setMcpAuthentication(true)')
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    const created = await call('browser_workspaces', { action: 'create', name: 'Agent owned source', storage: 'scratch' })
    expect(created.isError, text(created)).not.toBe(true)
    const source = JSON.parse(text(created)) as { id: string }
    expect((await call('browser_new_tab', { workspaceId: source.id, url: sourceUrl })).isError).not.toBe(true)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url), sourceUrl)).toBe(true)
    await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      await contents.session.cookies.set({ url, name: 'lock-cookie', value: 'retained', httpOnly: true })
      await contents.executeJavaScript("localStorage.setItem('lock-key', 'retained')")
    }, sourceUrl)
    const targetState = await appWindow.evaluate("window.hronaut.createWorkspace({ name: 'Human target', storage: 'scratch' })") as BrowserState
    const target = targetState.mcpTabGroups.find(group => group.name === 'Human target')!
    await appWindow.evaluate(`window.hronaut.navigate(${JSON.stringify({ tabId: targetState.activeTabId, url: targetUrl })})`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url), targetUrl)).toBe(true)
    await electronApp.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      const original = contents.session.cookies.set.bind(contents.session.cookies)
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const globals = globalThis as typeof globalThis & { __releasePrivacyCopy?: () => void; __privacyCopyStarted?: boolean }
      globals.__releasePrivacyCopy = release
      contents.session.cookies.set = async (...args: Parameters<Electron.Cookies['set']>) => {
        contents.session.cookies.set = original
        globals.__privacyCopyStarted = true
        await gate
        return original(...args)
      }
    }, targetUrl)
    const pendingCopy = appWindow.evaluate(`window.hronaut.transferWorkspaceStorage(${JSON.stringify({ sourceWorkspaceId: source.id, targetWorkspaceId: target.id, mode: 'copy', origins: [origin] })})`)
    try {
      await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { __privacyCopyStarted?: boolean }).__privacyCopyStarted)).toBe(true)
      const blocked = await call('browser_site_data', { workspaceId: source.id, action: 'clear', origin, dataTypes: ['cookies-and-storage'] })
      expect(blocked.isError, text(blocked)).toBe(true)
      expect(text(blocked)).toMatch(/busy.*copying workspace data/i)
      expect(await electronApp.evaluate(async ({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
        return { cookies: (await contents.session.cookies.get({})).length, value: await contents.executeJavaScript("localStorage.getItem('lock-key')") }
      }, sourceUrl)).toEqual({ cookies: 1, value: 'retained' })
    } finally {
      await electronApp.evaluate(() => (globalThis as typeof globalThis & { __releasePrivacyCopy?: () => void }).__releasePrivacyCopy?.())
      await pendingCopy
    }
    await electronApp.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      const original = contents.session.clearData.bind(contents.session)
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const globals = globalThis as typeof globalThis & { __releasePrivacyClear?: () => void; __privacyClearStarted?: boolean }
      globals.__releasePrivacyClear = release
      contents.session.clearData = async (...args: Parameters<Electron.Session['clearData']>) => {
        contents.session.clearData = original
        globals.__privacyClearStarted = true
        await gate
        return original(...args)
      }
    }, sourceUrl)
    const pendingClear = call('browser_site_data', { workspaceId: source.id, action: 'clear', origin, dataTypes: ['cookies-and-storage'] })
    try {
      await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { __privacyClearStarted?: boolean }).__privacyClearStarted)).toBe(true)
      const archiveError = await appWindow.evaluate(`window.hronaut.saveAndCloseTabGroup(${JSON.stringify(source.id)}).then(() => 'unexpected success', error => String(error.message))`)
      expect(archiveError).toMatch(/busy/i)
      const deleteError = await appWindow.evaluate(`window.hronaut.closeWorkspace(${JSON.stringify(source.id)}).then(() => 'unexpected success', error => String(error.message))`)
      expect(deleteError).toMatch(/busy/i)
    } finally {
      await electronApp.evaluate(() => (globalThis as typeof globalThis & { __releasePrivacyClear?: () => void }).__releasePrivacyClear?.())
    }
    const cleared = await pendingClear
    expect(cleared.isError, text(cleared)).not.toBe(true)
    expect(JSON.parse(text(cleared))).toMatchObject({ remaining: { cookieCount: 0 } })
    expect(await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      return contents.executeJavaScript("localStorage.getItem('lock-key')")
    }, sourceUrl)).toBeNull()
    expect(await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      return { cookies: (await contents.session.cookies.get({})).length, value: await contents.executeJavaScript("localStorage.getItem('lock-key')") }
    }, targetUrl)).toEqual({ cookies: 1, value: 'retained' })
    const archived = await appWindow.evaluate(`window.hronaut.saveAndCloseTabGroup(${JSON.stringify(source.id)})`) as BrowserState
    expect(archived.savedTabGroups.some(group => group.id === source.id)).toBe(true)
  } finally {
    await client.close()
    await closeFixtureServer(server)
  }
})
