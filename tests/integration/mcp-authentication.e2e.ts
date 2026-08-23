import { readFile } from 'node:fs/promises'
import { get } from 'node:http'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { DEFAULT_MCP_PORT } from '../../src/shared/mcp-port.js'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('starts without MCP authentication and can enable or disable it in Settings', async ({
  appWindow,
  mcpPort,
  mcpToken,
  profileDirectory
}) => {
  const health = `http://127.0.0.1:${mcpPort}/healthz`
  const authorization = { authorization: `Bearer ${mcpToken}` }
  const healthStatus = (headers?: Record<string, string>, url = health): Promise<number> => new Promise((resolve) => {
    const request = get(url, { headers, agent: false }, (response) => {
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    request.once('error', () => resolve(0))
  })
  const defaultHealth = `http://127.0.0.1:${DEFAULT_MCP_PORT}/healthz`
  const defaultPortWasOccupied = await healthStatus(undefined, defaultHealth) !== 0
  await expect.poll(() => healthStatus()).toBe(200)

  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('button', { name: /MCP security/ }).click()
  const authentication = appWindow.getByRole('checkbox', { name: 'Require MCP authentication' })
  await expect(authentication).not.toBeChecked()
  await expect(appWindow.getByText('Authentication is off.')).toBeVisible()

  await authentication.check()
  await expect.poll(() => healthStatus()).toBe(401)
  await expect.poll(() => healthStatus(authorization)).toBe(200)
  await expect
    .poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).mcpAuthentication)
    .toBe(true)

  appWindow.once('dialog', (dialog) => dialog.accept())
  await authentication.uncheck()
  await expect.poll(() => healthStatus()).toBe(200)
  await expect
    .poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).mcpAuthentication)
    .toBe(false)

  await authentication.check()
  await expect.poll(() => healthStatus()).toBe(401)
  await appWindow.getByRole('button', { name: 'Reset to default' }).click()
  await expect(authentication).not.toBeChecked()
  if (defaultPortWasOccupied) {
    await expect(appWindow.locator('.mcp-port-status.error')).toContainText(`Could not listen on 127.0.0.1:${DEFAULT_MCP_PORT}`)
    await expect.poll(() => healthStatus()).toBe(200)
    await expect
      .poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')))
      .toMatchObject({ mcpAuthentication: false, mcpPort })
  } else {
    await expect.poll(() => healthStatus(undefined, defaultHealth)).toBe(200)
    await expect.poll(() => healthStatus()).toBe(0)
    await expect
      .poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')))
      .toMatchObject({ mcpAuthentication: false, mcpPort: DEFAULT_MCP_PORT })
  }
})

test('moves the live MCP listener to a validated available port and rolls back on conflicts', async ({
  appWindow,
  electronApp,
  mcpPort,
  mcpToken,
  profileDirectory
}) => {
  const authorization = { authorization: `Bearer ${mcpToken}` }
  const status = async (port: number): Promise<number> => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/healthz`, { headers: authorization })).status
    } catch {
      return 0
    }
  }
  const availablePort = async (): Promise<number> => {
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Could not allocate a test port')
    await new Promise<void>((resolve) => server.close(() => resolve()))
    return address.port
  }

  const nextPort = await availablePort()
  await expect.poll(() => status(mcpPort)).toBe(200)
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('button', { name: /MCP security/ }).click()
  const portInput = appWindow.getByRole('spinbutton', { name: 'MCP server port' })
  await expect(portInput).toHaveValue(String(mcpPort))
  await portInput.fill(String(nextPort))
  await appWindow.getByRole('button', { name: 'Apply port' }).click()

  await expect(appWindow.getByText(`MCP port ${nextPort} is active.`)).toBeVisible()
  await expect.poll(() => status(nextPort)).toBe(200)
  await expect.poll(() => status(mcpPort)).toBe(0)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.mcpUrl)')).toBe(`http://127.0.0.1:${nextPort}/mcp`)
  await expect.poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).mcpPort).toBe(nextPort)

  const conflict = createServer()
  await new Promise<void>((resolve, reject) => {
    conflict.once('error', reject)
    conflict.listen(0, '127.0.0.1', () => resolve())
  })
  try {
    const conflictAddress = conflict.address()
    if (!conflictAddress || typeof conflictAddress === 'string') throw new Error('Could not reserve a conflicting port')
    await portInput.fill(String(conflictAddress.port))
    await appWindow.getByRole('button', { name: 'Apply port' }).click()
    await expect(appWindow.locator('.mcp-port-status.error')).toContainText(`Could not listen on 127.0.0.1:${conflictAddress.port}`)
    await expect.poll(() => status(nextPort)).toBe(200)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.mcpUrl)')).toBe(`http://127.0.0.1:${nextPort}/mcp`)
  } finally {
    await new Promise<void>((resolve) => conflict.close(() => resolve()))
  }

  await closeHronaut(electronApp)
  const restarted = await launchHronaut(profileDirectory)
  try {
    await expect.poll(() => status(nextPort)).toBe(200)
    await expect.poll(() => restarted.window.evaluate('window.hronaut.getState().then((state) => state.mcpUrl)')).toBe(`http://127.0.0.1:${nextPort}/mcp`)
    await restarted.window.getByRole('button', { name: 'Settings' }).click()
    await restarted.window.getByRole('button', { name: /MCP security/ }).click()
    await expect(restarted.window.getByRole('spinbutton', { name: 'MCP server port' })).toHaveValue(String(nextPort))
  } finally {
    await closeHronaut(restarted.app)
  }
})
