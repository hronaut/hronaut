import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_MCP_PORT } from '../../src/shared/mcp-port.js'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('starts with safe defaults when persisted profile stores contain JSON null', async ({
  mcpPort,
  profileDirectory
}) => {
  await Promise.all([
    writeFile(join(profileDirectory, 'settings.json'), 'null\n', 'utf8'),
    writeFile(join(profileDirectory, 'window-state.json'), 'null\n', 'utf8'),
    writeFile(join(profileDirectory, 'bookmarks.json'), 'null\n', 'utf8'),
    writeFile(join(profileDirectory, 'history.json'), 'null\n', 'utf8'),
    writeFile(join(profileDirectory, 'site-permissions.json'), 'null\n', 'utf8'),
    writeFile(join(profileDirectory, 'credentials.json'), 'null\n', 'utf8'),
    writeFile(join(profileDirectory, 'tabs.json'), 'null\n', 'utf8')
  ])

  const { app, window } = await launchHronaut(profileDirectory, mcpPort)
  try {
    await expect(window.getByRole('button', { name: 'Home' })).toBeVisible()
    await expect.poll(() => window.evaluate('window.hronautSettings.get()')).toMatchObject({
      mcpPort,
      theme: 'system'
    })
  } finally {
    await closeHronaut(app)
  }
})

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
