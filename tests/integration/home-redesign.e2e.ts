import { createServer } from 'node:net'
import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import type { McpControlState } from '../../src/shared/types.js'
import { removeTestDirectory } from '../helpers/remove-test-directory.js'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test, type HronautInstance } from './fixtures.js'
import { BUSY_PORT_BLOCK, integrationBusyMcpPort } from './port-allocation.js'
import { answerTrustedDialog, trustedDialog, trustedDialogHeadline } from './trusted-dialog-fixture.js'

async function homePage(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.context().pages().some(page => page.url().startsWith('hronaut://home'))).toBe(true)
  return app.context().pages().find(page => page.url().startsWith('hronaut://home'))!
}

/**
 * Keeps what each system message box asked, answering Cancel, until the app closes: the setup asks in Hronaut's own
 * dialog, so a test that sees one here caught it falling back.
 */
async function recordSystemDialogs(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    const scope = globalThis as typeof globalThis & { messageBoxes?: Electron.MessageBoxOptions[] }
    scope.messageBoxes = []
    dialog.showMessageBox = (async (...args: unknown[]) => {
      scope.messageBoxes!.push(args.at(-1) as Electron.MessageBoxOptions)
      return { response: 0, checkboxChecked: false }
    }) as typeof dialog.showMessageBox
  })
}

/** Hronaut's own dialog for the setup, once Apply asked it: the file, the entry it writes and the backup it saves. */
async function expectClaudeSetupDialog(window: Page, path: string, entry: string, backup: string): Promise<void> {
  const dialog = trustedDialog(window)
  await expect(dialog).toHaveAttribute('data-variant', 'claude-setup')
  expect(await trustedDialogHeadline(window)).toBe('Add Hronaut to Claude Code?')
  await expect(dialog.getByTestId('trusted-dialog-change-path')).toHaveText(path)
  await expect(dialog.getByTestId('trusted-dialog-change-added')).toHaveText(entry)
  await expect(dialog).toContainText(`A copy of the file is saved first as ${backup}.`)
  // Enter, or a key still held from Home, keeps the file as it is.
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
}

const messageBoxes = (app: ElectronApplication): Promise<Electron.MessageBoxOptions[]> =>
  app.evaluate(() => (globalThis as typeof globalThis & { messageBoxes?: Electron.MessageBoxOptions[] }).messageBoxes ?? [])

test('sets up Claude Code from Home after a confirmation in the dialog main asks, keeping its other settings and a backup', async ({ profileDirectory, mcpPort }) => {
  // A stand-in home folder with Claude Code's settings file, written as Claude Code writes it.
  const home = await mkdtemp(join(tmpdir(), 'hronaut-claude-home-'))
  const configPath = join(home, '.claude.json')
  const settings = { numStartups: 3, theme: 'dark', mcpServers: { other: { type: 'stdio', command: 'other-server', args: ['--quiet'] } }, projects: {} }
  const original = `${JSON.stringify(settings, null, 2)}\n`
  await writeFile(configPath, original)
  const backups = async (): Promise<string[]> => (await readdir(home)).filter(name => name.startsWith('.claude.json.hronaut-backup-'))
  const previous = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR }
  let instance: HronautInstance | undefined
  try {
    // Hronaut reads the settings path once, from the environment it starts with.
    process.env.HOME = home
    process.env.CLAUDE_CONFIG_DIR = home
    try { instance = await launchHronaut(profileDirectory, mcpPort) } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
    const { app } = instance
    const page = await homePage(app)
    const endpoint = `http://127.0.0.1:${mcpPort}/mcp`
    await expect(page.locator('#endpoint')).toHaveText(endpoint)
    const entry = `"hronaut": ${JSON.stringify({ type: 'http', url: endpoint }, null, 2)}`
    const preview = page.locator('#claude-setup-preview')
    const status = page.locator('#claude-setup-status')
    const setUp = page.locator('#claude-setup').getByRole('button', { name: 'Set up Claude Code', exact: true })

    // Claude Code is found on this computer, so the first-run panel offers the setup and shows the exact change.
    const firstRun = page.locator('#home-onboarding')
    await expect(firstRun.getByText('Claude Code is on this computer. Hronaut can add itself to Claude Code for you.', { exact: true })).toBeVisible()
    await firstRun.getByRole('button', { name: 'Set up Claude Code', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Connect an agent', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#guide-name')).toHaveText('Claude Code')
    await expect(page.locator('[data-guide="claude-code"]')).toContainText('On this computer')
    await expect(preview).toBeVisible()
    await expect(preview.getByText(`Hronaut will add this server to ${configPath}:`, { exact: true })).toBeVisible()
    await expect(page.locator('#claude-setup-after')).toHaveText(entry)
    await expect(page.locator('#claude-setup-before-wrap')).toBeHidden()
    await expect(page.locator('#claude-setup-backup')).toHaveText(/^A copy of the file is saved first as \.claude\.json\.hronaut-backup-\d{8}T\d{6}Z(?:-\d+)?\.$/u)
    // The focus is on the change, not on Apply, whose confirmation a held Enter would otherwise reach.
    await expect(page.locator('pre:has(#claude-setup-after)')).toBeFocused()

    // Cancel on Home writes nothing.
    await preview.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(preview).toBeHidden()
    await expect(status).toHaveText('Nothing was changed.')
    expect(await readFile(configPath, 'utf8')).toBe(original)
    expect(await backups()).toEqual([])

    // Cancel in Hronaut's own dialog writes nothing either; the dialog repeats the file, the entry and the backup.
    await recordSystemDialogs(app)
    await setUp.click()
    await expect(preview).toBeVisible()
    const cancelledBackup = /as (\S+)\.$/u.exec(await page.locator('#claude-setup-backup').innerText())![1]!
    await preview.getByRole('button', { name: 'Apply change…', exact: true }).click()
    await expectClaudeSetupDialog(instance.window, configPath, entry, cancelledBackup)
    // A file without a Hronaut entry has nothing to replace.
    await expect(trustedDialog(instance.window).getByTestId('trusted-dialog-change-removed')).toHaveCount(0)
    await trustedDialog(instance.window).screenshot({ path: test.info().outputPath('claude-setup-dialog.png') })
    await answerTrustedDialog(instance.window, 'Cancel')
    await expect(trustedDialog(instance.window)).toBeHidden()
    await expect(status).toHaveText('Nothing was changed.')
    expect(await readFile(configPath, 'utf8')).toBe(original)
    expect(await backups()).toEqual([])

    // Confirming adds exactly the hronaut entry, keeps every other setting, its order and indentation, and the backup
    // holds the file's exact bytes.
    await setUp.click()
    await expect(preview).toBeVisible()
    const backupName = /as (\S+)\.$/u.exec(await page.locator('#claude-setup-backup').innerText())![1]!
    await preview.getByRole('button', { name: 'Apply change…', exact: true }).click()
    await expectClaudeSetupDialog(instance.window, configPath, entry, backupName)
    await answerTrustedDialog(instance.window, 'Add to Claude Code')
    await expect(status).toHaveText(`Added. Restart Claude Code and it connects here. Backup: ${backupName}.`)
    expect(await messageBoxes(app)).toEqual([])
    const expected = `${JSON.stringify({ ...settings, mcpServers: { ...settings.mcpServers, hronaut: { type: 'http', url: endpoint } } }, null, 2)}\n`
    expect(await readFile(configPath, 'utf8')).toBe(expected)
    expect(await backups()).toEqual([backupName])
    expect(await readFile(join(home, backupName), 'utf8')).toBe(original)
    // Set up now, Home offers nothing more to apply, here or on the first-run panel.
    await expect(setUp).toBeHidden()
    await page.getByRole('tab', { name: 'Workspaces', exact: true }).click()
    await expect(firstRun).toBeVisible()
    await expect(firstRun.getByRole('button', { name: 'Set up Claude Code', exact: true })).toBeHidden()
  } finally {
    if (instance) await closeHronaut(instance.app)
    await removeTestDirectory(home)
  }
})

test('on a new profile, requires the MCP token and sets up Claude Code with it', async ({ profileDirectory, mcpPort }) => {
  // A profile saved without the authentication setting starts with the default, as a new install does.
  await writeFile(join(profileDirectory, 'settings.json'), `${JSON.stringify({ theme: 'system', tabPosition: 'top', mcpToolSet: 'complete' }, null, 2)}\n`)
  const home = await mkdtemp(join(tmpdir(), 'hronaut-claude-home-'))
  const configPath = join(home, '.claude.json')
  const settings = { numStartups: 1, mcpServers: { hronaut: { type: 'http', url: `http://127.0.0.1:${mcpPort}/mcp` } } }
  await writeFile(configPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o644 })
  const previous = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR }
  let instance: HronautInstance | undefined
  try {
    process.env.HOME = home
    process.env.CLAUDE_CONFIG_DIR = home
    try { instance = await launchHronaut(profileDirectory, mcpPort) } finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
    const { app } = instance
    const token = (await readFile(join(profileDirectory, 'mcp-token'), 'utf8')).trim()
    // 0 while the listener is still starting.
    const health = (authorization?: string): Promise<number> =>
      fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: authorization ? { authorization } : {} }).then(response => response.status, () => 0)
    await expect.poll(() => health()).toBe(401)
    expect(await health(`Bearer ${token}`)).toBe(200)
    expect(JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8'))).toMatchObject({ mcpAuthentication: true })

    // Claude Code points at this address without the token, so Home offers to update its entry.
    const page = await homePage(app)
    const endpoint = `http://127.0.0.1:${mcpPort}/mcp`
    const preview = page.locator('#claude-setup-preview')
    const status = page.locator('#claude-setup-status')
    const firstRun = page.locator('#home-onboarding')
    await firstRun.getByRole('button', { name: 'Set up Claude Code', exact: true }).click()
    await expect(page.locator('#guide-name')).toHaveText('Claude Code')
    await expect(preview).toBeVisible()
    await expect(page.locator('#claude-setup-after')).toHaveText(`"hronaut": ${JSON.stringify({ type: 'http', url: endpoint, headers: { Authorization: 'Bearer •••' } }, null, 2)}`)
    await expect(page.locator('#claude-setup-token')).toHaveText('Hronaut writes the actual MCP token where ••• appears.')
    await expect(page.locator('#claude-setup-before')).toHaveText(`"hronaut": ${JSON.stringify({ type: 'http', url: endpoint }, null, 2)}`)
    // The token itself never reaches Home.
    expect(await page.content()).not.toContain(token)

    await recordSystemDialogs(app)
    const backupName = /as (\S+)\.$/u.exec(await page.locator('#claude-setup-backup').innerText())![1]!
    await preview.getByRole('button', { name: 'Apply change…', exact: true }).click()
    const shownEntry = `"hronaut": ${JSON.stringify({ type: 'http', url: endpoint, headers: { Authorization: 'Bearer •••' } }, null, 2)}`
    await expectClaudeSetupDialog(instance.window, configPath, shownEntry, backupName)
    const dialog = trustedDialog(instance.window)
    await expect(dialog.getByTestId('trusted-dialog-change-removed')).toHaveText(`"hronaut": ${JSON.stringify({ type: 'http', url: endpoint }, null, 2)}`)
    await expect(dialog).toContainText('Hronaut writes the actual MCP token where ••• appears.')
    // The token never reaches the shell either.
    expect(await instance.window.content()).not.toContain(token)
    await answerTrustedDialog(instance.window, 'Add to Claude Code')
    await expect(status).toHaveText(`Added. Restart Claude Code and it connects here. Backup: ${backupName}.`)
    expect(await messageBoxes(app)).toEqual([])
    const written = JSON.parse(await readFile(configPath, 'utf8')) as { mcpServers: { hronaut: { headers: { Authorization: string } } } }
    expect(written).toEqual({ numStartups: 1, mcpServers: { hronaut: { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${token}` } } } })
    // The file now holds the token, so it is for this account alone.
    if (process.platform !== 'win32') expect((await stat(configPath)).mode & 0o777).toBe(0o600)
    // What Claude Code will send is what the listener takes.
    expect(await health(written.mcpServers.hronaut.headers.Authorization)).toBe(200)
    await expect(page.locator('#claude-setup').getByRole('button', { name: /Claude Code$/ })).toBeHidden()
  } finally {
    if (instance) await closeHronaut(instance.app)
    await removeTestDirectory(home)
  }
})

/** Holds `port` on the MCP host, as another app would, until closed. */
async function occupy(port: number): Promise<ReturnType<typeof createServer>> {
  const owner = createServer(socket => socket.destroy())
  await new Promise<void>((resolve, reject) => {
    owner.once('error', reject)
    owner.listen(port, '127.0.0.1', () => resolve())
  })
  return owner
}

/** Hronaut's state once its listener failed on the busy port, with the free port it offers instead. */
async function offeredPort(instance: HronautInstance, busyPort: number): Promise<number> {
  await expect.poll(() => instance.window.evaluate('window.hronautMcp.getState()'))
    .toMatchObject({ status: 'error', errorCode: 'port-in-use', failedPort: busyPort, suggestedPort: expect.any(Number) })
  const { suggestedPort } = await instance.window.evaluate('window.hronautMcp.getState()') as McpControlState
  // The offer comes from this worker's own block, clear of every other worker's ports.
  expect(suggestedPort).toBeGreaterThan(busyPort)
  expect(suggestedPort).toBeLessThan(busyPort + BUSY_PORT_BLOCK)
  return suggestedPort!
}

/** Startup offers the free port in Hronaut's own dialog over the window; Not now leaves the offer to Home and the popover. */
async function dismissStartupPortDialog(instance: HronautInstance, busyPort: number, suggested: number): Promise<void> {
  const dialog = trustedDialog(instance.window)
  await expect(dialog).toHaveAttribute('data-topic', 'agent-connection')
  expect(await trustedDialogHeadline(instance.window)).toBe(`Another app is using port ${busyPort}`)
  await expect(dialog.getByRole('button', { name: `Use port ${suggested}`, exact: true })).toBeVisible()
  await answerTrustedDialog(instance.window, 'Not now')
  await expect(dialog).toBeHidden()
}

async function expectListeningOn(instance: HronautInstance, profileDirectory: string, port: number): Promise<void> {
  await expect.poll(() => instance.window.evaluate('window.hronautMcp.getState().then(state => state.status)')).toBe('ready')
  await expect.poll(async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).mcpPort).toBe(port)
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/healthz`)).ok } catch { return false }
  }).toBe(true)
}

test('moves the MCP listener to the free port Home offers when its port is busy', async ({ profileDirectory }, testInfo) => {
  const busyPort = integrationBusyMcpPort(process.env.HRONAUT_TEST_SHARD_INDEX, testInfo.parallelIndex)
  const owner = await occupy(busyPort)
  let instance: HronautInstance | undefined
  try {
    instance = await launchHronaut(profileDirectory, busyPort)
    const suggested = await offeredPort(instance, busyPort)
    await dismissStartupPortDialog(instance, busyPort, suggested)
    const page = await homePage(instance.app)
    const problem = page.getByRole('alert').filter({ hasText: `Another app is using port ${busyPort}` })
    await expect(problem).toBeVisible()
    await expect(problem).toContainText('Hronaut can use a free port instead')
    await problem.getByRole('button', { name: `Use port ${suggested}`, exact: true }).click()

    // Home reloads on the new address, without the alert, and the port is saved for the next start.
    await expectListeningOn(instance, profileDirectory, suggested)
    await expect(page.locator('#mcp-port-problem')).toBeHidden()
    await page.locator('.status-details > summary').click()
    await expect(page.locator('#endpoint')).toBeVisible()
    await expect(page.locator('#endpoint')).toHaveText(`http://127.0.0.1:${suggested}/mcp`)
  } finally {
    if (instance) await closeHronaut(instance.app)
    await closeFixtureServer(owner)
  }
})

test('moves the MCP listener to the free port offered in the agent status popover', async ({ profileDirectory }, testInfo) => {
  const busyPort = integrationBusyMcpPort(process.env.HRONAUT_TEST_SHARD_INDEX, testInfo.parallelIndex)
  const owner = await occupy(busyPort)
  let instance: HronautInstance | undefined
  try {
    instance = await launchHronaut(profileDirectory, busyPort)
    const { window } = instance
    const suggested = await offeredPort(instance, busyPort)
    await dismissStartupPortDialog(instance, busyPort, suggested)
    await window.getByRole('button', { name: 'Agents can’t connect', exact: true }).click()
    const problem = window.getByRole('alert').filter({ hasText: `Another app is using port ${busyPort}` })
    await expect(problem).toBeVisible()
    await problem.getByRole('button', { name: `Use port ${suggested}`, exact: true }).click()

    // The popover shows the new address, and focus moves to copying it once the offer is gone.
    await expectListeningOn(instance, profileDirectory, suggested)
    await expect(problem).toBeHidden()
    await expect(window.locator('.mcp-readiness-summary code')).toHaveText(`http://127.0.0.1:${suggested}/mcp`)
    await expect(window.getByRole('button', { name: 'Copy URL', exact: true })).toBeFocused()
    await window.keyboard.press('Escape')
    await expect(window.getByRole('button', { name: 'Ready for agents', exact: true })).toBeVisible()
  } finally {
    if (instance) await closeHronaut(instance.app)
    await closeFixtureServer(owner)
  }
})
