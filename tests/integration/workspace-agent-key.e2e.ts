import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication } from '@playwright/test'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

const HOME_READY_TIMEOUT_MS = 20_000
const text = (result: CallToolResult): string => result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')

async function homeScript<T>(app: ElectronApplication, script: string): Promise<T> {
  return app.evaluate(async ({ webContents }, source) => {
    const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    return home.executeJavaScript(source)
  }, script) as Promise<T>
}

test('the person copies a workspace key from Home, and a new agent continues in that workspace with it', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const state = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.createWorkspace({ name: 'Handed shop', storage: 'scratch' }))
  const workspaceId = state.mcpTabGroups.find(group => group.name === 'Handed shop')!.id
  const homeTab = state.tabs.find(tab => tab.url.startsWith('hronaut://home'))?.id
  expect(homeTab).toBeTruthy()
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.selectTab(id), homeTab!)
  const cardScript = `[...document.querySelectorAll('.home-workspace-card')].find(card => card.getAttribute('aria-label') === 'Handed shop')`
  await expect.poll(() => homeScript(electronApp, `Boolean(${cardScript})`), { timeout: HOME_READY_TIMEOUT_MS }).toBe(true)
  await electronApp.evaluate(({ clipboard }) => clipboard.writeText('before'))

  // Copy key for an agent, from the card's menu.
  await homeScript(electronApp, `(() => {
    const menu = ${cardScript}.querySelector('.card-menu')
    menu.open = true
    menu.querySelector('[data-workspace-action="copy-agent-key"]').click()
  })()`)
  await expect.poll(() => homeScript(electronApp, `document.getElementById('workspace-notice').textContent`))
    .toBe('Key for “Handed shop” copied. Paste it into your agent’s chat.')
  const copied = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  // Home shows the notice but never holds the key: only main and the clipboard have it.
  expect(await homeScript(electronApp, 'document.documentElement.outerHTML.includes("hrw1_")')).toBe(false)
  const call = JSON.parse(/call browser_workspaces with (\{.*?\}) and keep working there/.exec(copied)?.[1] ?? 'null') as Record<string, unknown> | null
  expect(call, copied).toMatchObject({ action: 'resume', workspaceId })

  const client = new Client({ name: 'Handed agent', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
  }))
  try {
    const tool = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
    // Without the key, the new agent cannot use the person's workspace.
    expect((await tool('browser_new_tab', { workspaceId, url: 'data:text/html,<title>Before</title>' })).isError).toBe(true)
    const resumed = await tool('browser_workspaces', call!)
    expect(resumed.isError, text(resumed)).not.toBe(true)
    expect(JSON.parse(text(resumed)).id).toBe(workspaceId)
    const opened = await tool('browser_new_tab', { workspaceId, url: 'data:text/html,<title>Handed page</title>' })
    expect(opened.isError, text(opened)).not.toBe(true)
    await expect.poll(() => appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
      .then(next => next.tabs.filter(tab => tab.mcpGroupId === id).map(tab => tab.title)), workspaceId)).toContain('Handed page')
  } finally {
    await client.close()
  }
})
