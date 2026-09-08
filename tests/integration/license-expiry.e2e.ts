import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { expect, test as base } from './fixtures.js'

const test = base.extend({
  profileDirectory: async ({ mcpPort }, use) => {
    const directory = await mkdtemp(join(tmpdir(), `hronaut-expired-license-${mcpPort}-`))
    try {
      await writeFile(join(directory, 'commercial-license.json'), JSON.stringify({
        version: 1, installationId: randomUUID(),
        trialStartedAt: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString(),
        lastSeenAt: new Date().toISOString()
      }))
      await use(directory)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
})

test('blocks automation after trial expiry while keeping license management accessible', async ({ appWindow, mcpPort, mcpToken }) => {
  await expect.poll(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok
    } catch {
      return false
    }
  }).toBe(true)
  const client = new Client({ name: 'expired-trial-test', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const result = await client.callTool({ name: 'browser_workspaces', arguments: { action: 'list' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('active subscription after the 10-day trial')
    await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
    await appWindow.getByRole('button', { name: /License/ }).click()
    await expect(appWindow.getByText('Your trial has ended. Subscribe to continue agent automation.')).toBeVisible()
    await expect(appWindow.getByRole('button', { name: 'Buy license ↗' })).toBeEnabled()
  } finally {
    await client.close()
  }
})
