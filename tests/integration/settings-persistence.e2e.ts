import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_MCP_PORT } from '../../src/shared/mcp-port.js'
import { expect, test } from './fixtures.js'

test('does not persist the current-launch MCP port override through unrelated settings changes', async ({
  appWindow,
  mcpPort,
  profileDirectory
}) => {
  expect(mcpPort).not.toBe(DEFAULT_MCP_PORT)
  await expect.poll(() => appWindow.evaluate('window.hronautSettings.get()')).toMatchObject({
    mcpPort,
    theme: 'system'
  })

  await appWindow.evaluate("window.hronautSettings.setTheme('dark')")

  const settingsPath = join(profileDirectory, 'settings.json')
  await expect.poll(async () => JSON.parse(await readFile(settingsPath, 'utf8'))).toMatchObject({
    mcpPort: DEFAULT_MCP_PORT,
    theme: 'dark'
  })

  await appWindow.evaluate(`window.hronautSettings.setMcpPort(${mcpPort})`)
  await expect.poll(async () => JSON.parse(await readFile(settingsPath, 'utf8'))).toMatchObject({
    mcpPort,
    theme: 'dark'
  })
})
