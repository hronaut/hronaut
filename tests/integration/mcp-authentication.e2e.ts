import { readFile, writeFile } from 'node:fs/promises'
import { get } from 'node:http'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { DEFAULT_MCP_PORT } from '../../src/shared/mcp-port.js'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('repairs a malformed profile token before starting the browser and MCP listener', async ({
  profileDirectory,
  mcpPort
}) => {
  const tokenPath = join(profileDirectory, 'mcp-token')
  await writeFile(tokenPath, 'truncated-token\n', 'utf8')

  const instance = await launchHronaut(profileDirectory, mcpPort)
  try {
    const repairedToken = (await readFile(tokenPath, 'utf8')).trim()
    expect(repairedToken).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    await expect.poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).status
      } catch {
        return 0
      }
    }).toBe(200)
    await expect(instance.window.getByRole('button', { name: 'Home' })).toBeVisible()
  } finally {
    await closeHronaut(instance.app)
  }
})

test('starts without MCP authentication and can enable or disable it in Settings', async ({
  appWindow,
  mcpPort,
  mcpToken,
  profileDirectory
}) => {
  const health = `http://127.0.0.1:${mcpPort}/healthz`
  const authorization = { authorization: `Bearer ${mcpToken}` }
  const lowercaseAuthorization = { authorization: `bearer ${mcpToken}` }
  const healthStatus = (headers?: Record<string, string>, url = health): Promise<number> => new Promise((resolve) => {
    const request = get(url, { headers, agent: false }, (response) => {
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    request.once('error', () => resolve(0))
  })
  const defaultHealth = `http://127.0.0.1:${DEFAULT_MCP_PORT}/healthz`
  await expect.poll(() => healthStatus()).toBe(200)

  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('button', { name: /MCP security/ }).click()
  const authentication = appWindow.getByRole('checkbox', { name: 'Require MCP authentication' })
  await expect(authentication).not.toBeChecked()
  await expect(appWindow.getByText('Authentication is off.')).toBeVisible()

  await authentication.check()
  await expect.poll(() => healthStatus()).toBe(401)
  await expect.poll(() => healthStatus(authorization)).toBe(200)
  await expect.poll(() => healthStatus(lowercaseAuthorization)).toBe(200)
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

  const defaultPortOwner = createServer()
  const reservedDefaultPort = await new Promise<boolean>((resolve) => {
    defaultPortOwner.once('error', () => resolve(false))
    defaultPortOwner.listen(DEFAULT_MCP_PORT, '127.0.0.1', () => resolve(true))
  })
  try {
    await appWindow.getByRole('button', { name: 'Reset to default' }).click()
    await expect(appWindow.locator('.mcp-port-status.error')).toContainText(`Could not listen on 127.0.0.1:${DEFAULT_MCP_PORT}`)
    await expect(authentication).toBeChecked()
    await expect.poll(() => healthStatus()).toBe(401)
    await expect.poll(() => healthStatus(authorization)).toBe(200)
    await expect
      .poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')))
      .toMatchObject({ mcpAuthentication: true, mcpPort: DEFAULT_MCP_PORT })
  } finally {
    if (reservedDefaultPort) {
      await closeFixtureServer(defaultPortOwner)
    }
  }

  if (reservedDefaultPort) {
    await appWindow.getByRole('button', { name: 'Reset to default' }).click()
    await expect(authentication).not.toBeChecked()
    await expect.poll(() => healthStatus(undefined, defaultHealth)).toBe(200)
    await expect.poll(() => healthStatus()).toBe(0)
    await expect
      .poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')))
      .toMatchObject({ mcpAuthentication: false, mcpPort: DEFAULT_MCP_PORT })
  }
})

test('keeps a committed MCP authentication change authoritative when the Home refresh fails', async ({
  appWindow,
  electronApp,
  mcpPort,
  mcpToken
}) => {
  const health = `http://127.0.0.1:${mcpPort}/healthz`
  const status = (authorization?: string): Promise<number> => new Promise((resolve) => {
    const request = get(health, {
      headers: authorization ? { authorization } : undefined,
      agent: false
    }, (response) => {
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    request.once('error', () => resolve(0))
  })

  await appWindow.evaluate('window.hronaut.openHome()')
  await electronApp.evaluate(({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    Object.defineProperty(home, 'reload', {
      configurable: true,
      value: () => { throw new Error('Home refresh unavailable for authentication regression test') }
    })
  })

  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('button', { name: /MCP security/ }).click()
  const authentication = appWindow.getByRole('checkbox', { name: 'Require MCP authentication' })
  await authentication.check()

  await expect(authentication).toBeChecked()
  await expect.poll(() => status()).toBe(401)
  await expect.poll(() => status(`Bearer ${mcpToken}`)).toBe(200)
  await expect(appWindow.getByRole('alert', { name: 'Setting not saved' })).toHaveCount(0)
  await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) return null
    try {
      return await home.executeJavaScript(`(() => {
        document.querySelector('[data-guide="vscode"]')?.click();
        return {
          oneClickAvailable: Boolean(document.querySelector('[data-vscode-install]')),
          guide: document.getElementById('guide-code')?.textContent
        };
      })()`)
    } catch {
      return null
    }
  })).toEqual({
    oneClickAvailable: false,
    guide: expect.stringContaining('Authorization')
  })
})

test('recovers Home setup after a committed MCP port change when its main-process reload fails', async ({
  appWindow,
  electronApp,
  mcpPort
}) => {
  const availablePort = async (): Promise<number> => {
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Could not allocate a test port')
    await closeFixtureServer(server)
    return address.port
  }
  const healthStatus = async (port: number): Promise<number> => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/healthz`)).status
    } catch {
      return 0
    }
  }
  const nextPort = await availablePort()
  const nextEndpoint = `http://127.0.0.1:${nextPort}/mcp`

  await appWindow.evaluate('window.hronaut.openHome()')
  await electronApp.evaluate(({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    Object.defineProperty(home, 'reload', {
      configurable: true,
      value: () => { throw new Error('Home refresh unavailable for port recovery regression test') }
    })
  })

  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('button', { name: /MCP security/ }).click()
  const portInput = appWindow.getByRole('spinbutton', { name: 'MCP server port' })
  await portInput.fill(String(nextPort))
  await appWindow.getByRole('button', { name: 'Apply port' }).click()

  await expect.poll(() => healthStatus(nextPort)).toBe(200)
  await expect.poll(() => healthStatus(mcpPort)).toBe(0)
  await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) return null
    try {
      return await home.executeJavaScript(`(() => {
        document.querySelector('[data-guide="opencode"]')?.click();
        return {
          endpoint: document.getElementById('endpoint')?.textContent,
          guide: document.getElementById('guide-code')?.textContent
        };
      })()`)
    } catch {
      return null
    }
  })).toEqual({
    endpoint: nextEndpoint,
    guide: expect.stringContaining(nextEndpoint)
  })
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
    await closeFixtureServer(server)
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
    await closeFixtureServer(conflict)
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
