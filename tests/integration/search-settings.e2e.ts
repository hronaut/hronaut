import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { expect, test } from './fixtures.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'

const primaryModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

test('uses the selected search engine for address-bar and MCP searches', async ({
  appWindow,
  electronApp,
  mcpPort,
  mcpToken,
  profileDirectory
}) => {
  let releaseFirstFixtureResponse = (): void => undefined
  const firstFixtureResponseGate = new Promise<void>((resolve) => {
    releaseFirstFixtureResponse = resolve
  })
  let fixtureRequestCount = 0
  const server = createServer(async (_request, response) => {
    fixtureRequestCount += 1
    if (fixtureRequestCount === 1) await firstFixtureResponseGate
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Search redirect fixture</title><main>Search redirected locally</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Search fixture server did not expose a port')
  const redirectUrl = `http://127.0.0.1:${address.port}/`

  const client = new Client({ name: 'hronaut-search-settings-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
  })

  try {
    const settingsButton = appWindow.getByRole('button', { name: 'Settings' })
    await settingsButton.click()
    const settingsDialog = appWindow.getByRole('dialog', { name: 'Settings' })
    await appWindow.keyboard.press(`${primaryModifier}+Shift+P`)
    await expect(settingsDialog).toBeVisible()
    await expect(appWindow.getByRole('dialog', { name: 'Commands' })).toHaveCount(0)
    await appWindow.getByRole('button', { name: /Search engine/ }).click()
    const searchSettings = appWindow.getByRole('dialog', { name: 'Settings' }).locator('.settings-content')
    await expect(searchSettings.getByRole('radio')).toHaveCount(5)
    await searchSettings.getByTestId('search-engine-duckduckgo').click()
    await expect(searchSettings.getByTestId('search-engine-duckduckgo')).toHaveAttribute('aria-checked', 'true')
    await expect.poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).searchEngine).toBe('duckduckgo')
    await appWindow.getByRole('button', { name: 'Reset to default' }).click()
    await expect(searchSettings.getByTestId('search-engine-google')).toHaveAttribute('aria-checked', 'true')
    await expect.poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).searchEngine).toBe('google')
    await searchSettings.getByTestId('search-engine-duckduckgo').click()
    await expect(searchSettings.getByTestId('search-engine-duckduckgo')).toHaveAttribute('aria-checked', 'true')
    await expect.poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).searchEngine).toBe('duckduckgo')

    await electronApp.evaluate(({ session }, localRedirectUrl) => {
      const globalState = globalThis as typeof globalThis & { __hronautCapturedSearchUrls?: string[] }
      globalState.__hronautCapturedSearchUrls = []
      session.fromPartition('persist:hronaut').webRequest.onBeforeRequest(
        { urls: ['https://duckduckgo.com/*'] },
        (details, callback) => {
          globalState.__hronautCapturedSearchUrls?.push(details.url)
          callback({ redirectURL: localRedirectUrl })
        }
      )
    }, redirectUrl)

    await appWindow.getByRole('button', { name: 'Close settings' }).click()
    await expect(settingsButton).toBeFocused()
    await appWindow.getByRole('button', { name: 'New tab' }).click()
    const addressBar = appWindow.getByRole('combobox', { name: 'Address' })
    await addressBar.fill('human search phrase')
    await addressBar.press('Enter')
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautCapturedSearchUrls?: string[] }).__hronautCapturedSearchUrls
    ))).toEqual(['https://duckduckgo.com/?q=human%20search%20phrase'])

    await addressBar.click()
    await addressBar.press(`${primaryModifier}+A`)
    releaseFirstFixtureResponse()
    await expect(appWindow.getByRole('tab', { name: /Search redirect fixture/ })).toBeVisible()
    await addressBar.pressSequentially('person@example.com')
    await addressBar.press('Enter')
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautCapturedSearchUrls?: string[] }).__hronautCapturedSearchUrls
    ))).toEqual([
      'https://duckduckgo.com/?q=human%20search%20phrase',
      'https://duckduckgo.com/?q=person%40example.com'
    ])

    await client.connect(transport)
    await useMcpWorkspace(client, 'Search settings tests')
    await electronApp.evaluate(({ webContents }, localRedirectUrl) => {
      const globalState = globalThis as typeof globalThis & { __hronautCapturedSearchUrls?: string[] }
      const sessions = new Set(webContents.getAllWebContents().map((contents) => contents.session))
      for (const browserSession of sessions) {
        browserSession.webRequest.onBeforeRequest(
          { urls: ['https://duckduckgo.com/*'] },
          (details, callback) => {
            globalState.__hronautCapturedSearchUrls?.push(details.url)
            callback({ redirectURL: localRedirectUrl })
          }
        )
      }
    }, redirectUrl)
    await client.callTool({ name: 'browser_navigate', arguments: { url: 'agent search phrase' } })
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautCapturedSearchUrls?: string[] }).__hronautCapturedSearchUrls
    ))).toEqual([
      'https://duckduckgo.com/?q=human%20search%20phrase',
      'https://duckduckgo.com/?q=person%40example.com',
      'https://duckduckgo.com/?q=agent%20search%20phrase'
    ])
  } finally {
    releaseFirstFixtureResponse()
    await client.close().catch(() => undefined)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
