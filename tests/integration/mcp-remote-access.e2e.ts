import { readFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { blockFileDestination, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('opts into authenticated LAN MCP after restart and returns to localhost after disabling it', async ({ profileDirectory, mcpPort }) => {
  test.setTimeout(120_000)
  const address = Object.values(networkInterfaces()).flat().find(entry => entry?.family === 'IPv4' && !entry.internal)?.address
  if (!address) throw new Error('LAN listener regression needs a non-loopback IPv4 interface')
  const endpoint = `http://${address}:${mcpPort}/mcp`
  const health = async (token?: string): Promise<number> => {
    try {
      return (await fetch(endpoint.replace('/mcp', '/healthz'), {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(2_000)
      })).status
    } catch { return 0 }
  }
  let instance = await launchHronaut(profileDirectory, mcpPort)
  try {
    expect(await health()).toBe(0)
    await expect(instance.window.evaluate('window.hronautSettings.setMcpRemoteAccess("true")')).rejects.toThrow(/must be a boolean/)
    const restoreSettings = await blockFileDestination(join(profileDirectory, 'settings.json'))
    try {
      await expect(instance.window.evaluate('window.hronautSettings.setMcpRemoteAccess(true)')).rejects.toThrow()
    } finally { await restoreSettings() }
    await instance.window.getByRole('button', { name: 'Settings' }).click()
    await instance.window.getByRole('button', { name: /MCP security/ }).click()
    const remote = instance.window.locator('#setting-mcp-remote-access')
    await expect(remote).not.toBeChecked()
    await remote.check()
    await expect(instance.window.locator('#setting-mcp-authentication')).toBeChecked()
    await expect.poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).mcpRemoteAccess).toBe(true)
    const token = (await readFile(join(profileDirectory, 'mcp-token'), 'utf8')).trim()
    expect(await health(token)).toBe(0)
    await closeHronaut(instance.app)
    instance = await launchHronaut(profileDirectory, mcpPort)
    await expect.poll(() => health()).toBe(401)
    expect(await health('wrong')).toBe(401)
    expect(await health(token)).toBe(200)
    const client = new Client({ name: 'lan-regression', version: '1' })
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: { headers: { authorization: `Bearer ${token}` } }
      }))
      expect((await client.listTools()).tools.some(tool => tool.name === 'browser_snapshot')).toBe(true)
    } finally { await client.close() }
    await expect(instance.window.evaluate('window.hronautSettings.setMcpAuthentication(false)')).rejects.toThrow(/restart Hronaut/)
    await instance.window.evaluate('window.hronautSettings.setMcpRemoteAccess(false)')
    await expect(instance.window.evaluate('window.hronautSettings.setMcpAuthentication(false)')).rejects.toThrow(/restart Hronaut/)
    expect(await health()).toBe(401)
    await closeHronaut(instance.app)
    instance = await launchHronaut(profileDirectory, mcpPort)
    expect(await health(token)).toBe(0)
    await instance.window.evaluate('window.hronautSettings.setMcpAuthentication(false)')
    await expect.poll(async () => (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).status).toBe(200)
  } finally { await closeHronaut(instance.app) }
})
