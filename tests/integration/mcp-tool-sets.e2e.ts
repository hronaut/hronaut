import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mcpToolCatalogForSet } from '../../src/main/mcp/server.js'
import { expect, test } from './fixtures.js'

async function listTools(mcpPort: number, mcpToken: string): Promise<string[]> {
  const client = new Client({ name: 'hronaut-tool-set-integration', version: '1.0.0' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    return (await client.listTools()).tools.map(({ name }) => name)
  } finally {
    await client.close()
  }
}

test('persists a server-wide MCP tool set and applies it to new clients', async ({
  appWindow,
  mcpPort,
  mcpToken,
  profileDirectory
}) => {
  const settingsPath = join(profileDirectory, 'settings.json')
  await expect.poll(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok
    } catch {
      return false
    }
  }).toBe(true)
  expect(new Set(await listTools(mcpPort, mcpToken))).toEqual(
    new Set(mcpToolCatalogForSet('complete').map(({ name }) => name))
  )

  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('button', { name: /MCP security/ }).click()
  const toolSet = appWindow.getByRole('combobox', { name: 'Tool set' })
  await expect(toolSet).toHaveValue('complete')

  await toolSet.selectOption('essentials')
  await expect.poll(async () => JSON.parse(await readFile(settingsPath, 'utf8')).mcpToolSet).toBe('essentials')
  const essentials = await listTools(mcpPort, mcpToken)
  expect(new Set(essentials)).toEqual(
    new Set(mcpToolCatalogForSet('essentials').map(({ name }) => name))
  )
  expect(essentials).toContain('browser_downloads')
  expect(essentials).not.toContain('browser_accessibility_audit')

  await toolSet.selectOption('qa')
  await expect.poll(async () => JSON.parse(await readFile(settingsPath, 'utf8')).mcpToolSet).toBe('qa')
  const qa = await listTools(mcpPort, mcpToken)
  expect(new Set(qa)).toEqual(new Set(mcpToolCatalogForSet('qa').map(({ name }) => name)))
  expect(qa).toContain('browser_accessibility_audit')
  expect(qa).not.toContain('browser_evaluate')
})
