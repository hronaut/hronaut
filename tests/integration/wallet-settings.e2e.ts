import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

const execFileAsync = promisify(execFile)

function toolText(result: CallToolResult): string {
  const item = result.content.find((entry) => entry.type === 'text')
  return item?.type === 'text' ? item.text : ''
}

test('keeps the browser available and wallet operations fail closed when wallet persistence is corrupted', async ({
  profileDirectory,
  mcpPort
}) => {
  const walletDirectory = join(profileDirectory, 'wallet')
  const auditPath = join(walletDirectory, 'audit.jsonl')
  const corrupted = '{"sequence":1,"payload":"tampered"}\n'
  await mkdir(walletDirectory, { recursive: true })
  await writeFile(auditPath, corrupted, 'utf8')

  const website = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Wallet recovery fixture</title><main>Normal browsing remains available</main>')
  })
  await new Promise<void>((resolve, reject) => {
    website.once('error', reject)
    website.listen(0, '127.0.0.1', () => {
      website.off('error', reject)
      resolve()
    })
  })
  const address = website.address()
  if (!address || typeof address === 'string') throw new Error('Wallet recovery fixture did not expose a TCP port')
  const client = new Client({ name: 'wallet-recovery-test', version: '1.0.0' })

  const instance = await launchHronaut(profileDirectory, mcpPort)
  try {
    await expect(instance.window.getByRole('button', { name: 'Home' })).toBeVisible()
    await expect(instance.window.evaluate('window.hronautWallets.status()')).resolves.toMatchObject({
      managedWallets: 'disabled',
      backend: 'integrity-failure',
      watchOnlyAvailable: false
    })
    await expect(instance.window.evaluate('window.hronautWallets.list()')).resolves.toEqual([])
    await expect(instance.window.evaluate('window.hronautWallets.listPolicies()')).resolves.toEqual([])
    await expect(instance.window.evaluate(`window.hronautWallets.addWatchOnly({
      name: 'Must remain disabled',
      chainFamily: 'evm',
      publicAddress: '0x0000000000000000000000000000000000000001',
      network: { id: '31337', name: 'Anvil', environment: 'local', rpcUrl: 'http://127.0.0.1:8545' },
      workspaceIds: []
    })`)).rejects.toThrow('Wallet service is unavailable')

    const mcpToken = (await readFile(join(profileDirectory, 'mcp-token'), 'utf8')).trim()
    await expect.poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, {
          headers: { authorization: `Bearer ${mcpToken}` }
        })).ok
      } catch {
        return false
      }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const workspaceResult = await client.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'create', name: 'Recovery workspace', color: 'blue' }
    }) as CallToolResult
    expect(workspaceResult.isError, toolText(workspaceResult)).not.toBe(true)
    const workspaceId = (JSON.parse(toolText(workspaceResult)) as { id: string }).id
    const opened = await client.callTool({
      name: 'browser_new_tab',
      arguments: { workspaceId, url: `http://127.0.0.1:${address.port}/` }
    }) as CallToolResult
    expect(opened.isError, toolText(opened)).not.toBe(true)
    const tabId = (JSON.parse(toolText(opened)) as { activeTabId: string }).activeTabId
    await expect.poll(() => instance.window.evaluate(
      'window.hronaut.getState().then((value) => value.tabs.find((entry) => entry.active)?.title)'
    )).toBe('Wallet recovery fixture')

    const walletResult = await client.callTool({
      name: 'wallet_list',
      arguments: { workspaceId, tabId }
    }) as CallToolResult
    expect(walletResult.isError).toBe(true)
    expect(toolText(walletResult)).toContain('Wallet broker is unavailable')
    expect(toolText(walletResult)).not.toContain('tampered')
    expect(await readFile(auditPath, 'utf8')).toBe(corrupted)
  } finally {
    await client.close().catch(() => undefined)
    await closeHronaut(instance.app)
    await closeFixtureServer(website)
  }
})

test('keeps trusted Wallets settings usable at desktop and minimum window sizes', async ({ appWindow, electronApp }, testInfo) => {
  await appWindow.setViewportSize({ width: 1200, height: 760 })
  const walletStatus = await appWindow.evaluate('window.hronautWallets.status()') as { managedWallets: string }
  if (walletStatus.managedWallets === 'passphrase-setup-required') {
    await appWindow.evaluate(`window.hronautWallets.setupPassphrase('docker-wallet-settings-passphrase')`)
  }
  await appWindow.evaluate(`window.hronautWallets.addWatchOnly({
    name: 'Wallet to rename',
    chainFamily: 'evm',
    publicAddress: '0x0000000000000000000000000000000000000001',
    network: { id: '31337', name: 'Anvil', environment: 'local', rpcUrl: 'http://127.0.0.1:8545' },
    workspaceIds: []
  })`)
  await appWindow.evaluate(`window.hronaut.newTab({
    url: 'data:text/html,<title>Wallet settings hit testing</title><main>Website fixture</main>',
    active: true
  })`)
  await appWindow.getByRole('button', { name: /Block human page input/ }).click()
  await expect(appWindow.getByRole('button', { name: /Allow human page input/ })).toHaveAttribute('aria-pressed', 'true')
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  const dialog = appWindow.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('combobox', { name: 'Interface size' }).selectOption('1.25')
  await dialog.getByRole('combobox', { name: 'Tab position' }).selectOption('left')
  await dialog.getByRole('button', { name: 'Wallets Web3 accounts and policies' }).click()
  const panel = dialog.locator('.wallet-settings')

  await expect.poll(() => appWindow.locator('.settings-overlay').evaluate((element) => (
    getComputedStyle(element).getPropertyValue('-webkit-app-region')
  ))).toBe('no-drag')
  await expect.poll(() => panel.getByText('Name', { exact: true }).evaluate((element) => (
    getComputedStyle(element).getPropertyValue('-webkit-app-region')
  ))).toBe('no-drag')
  await expect(panel.getByRole('heading', { name: 'Wallets', exact: true })).toBeVisible()
  await expect(panel.getByText(/trusted main process/i)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Generate', exact: true })).toBeVisible()
  await expect(panel.getByRole('heading', { name: 'Your wallets' })).toBeVisible()
  await expect(panel.getByText('1 configured')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Lock signing keys' })).toHaveCount(0)
  const watchOnlyAutomationNote = panel.getByText(/watch-only wallets cannot sign/i)
  await expect(watchOnlyAutomationNote).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Add bounded policy' })).toHaveCount(0)
  await watchOnlyAutomationNote.scrollIntoViewIfNeeded()
  await appWindow.screenshot({ path: testInfo.outputPath('wallet-watch-only-automation.png') })
  await panel.getByLabel('Wallet to manage').scrollIntoViewIfNeeded()
  await appWindow.screenshot({ path: testInfo.outputPath('wallets-vault-control.png') })

  await panel.getByRole('button', { name: 'Import' }).click()
  await expect(panel.getByRole('textbox', { name: 'Mnemonic / recovery phrase' })).toHaveJSProperty('tagName', 'TEXTAREA')
  await panel.getByRole('combobox', { name: 'Secret format' }).selectOption('private-key')
  const privateKey = panel.getByRole('textbox', { name: 'Private key', exact: true })
  await expect(privateKey).toHaveAttribute('type', 'password')
  await panel.getByRole('button', { name: 'Generate' }).click()

  await panel.getByRole('button', { name: 'Rename' }).click()
  const renameInput = panel.getByRole('textbox', { name: 'Wallet name' })
  await expect(renameInput).toHaveValue('Wallet to rename')
  await renameInput.fill('Renamed inside Electron')
  await appWindow.screenshot({ path: testInfo.outputPath('wallet-rename-editor.png') })
  await panel.getByRole('button', { name: 'Save name' }).click()
  await expect.poll(() => appWindow.evaluate(`window.hronautWallets.list().then(
    (wallets) => wallets.find((wallet) => wallet.publicAddress === '0x0000000000000000000000000000000000000001')?.name
  )`)).toBe('Renamed inside Electron')

  await panel.getByRole('button', { name: 'Change RPC endpoint' }).click()
  const configuredRpc = panel.getByRole('textbox', { name: 'JSON-RPC URL' }).last()
  await expect(configuredRpc).toHaveValue('http://127.0.0.1:8545')
  await configuredRpc.fill('http://127.0.0.1:9545')
  await panel.getByRole('button', { name: 'Save RPC endpoint' }).click()
  await expect.poll(() => appWindow.evaluate(`window.hronautWallets.list().then(
    (wallets) => wallets.find((wallet) => wallet.publicAddress === '0x0000000000000000000000000000000000000001')?.network.rpcUrl
  )`)).toBe('http://127.0.0.1:9545')

  const configuredAccess = panel.locator('.wallet-configured-access')
  await configuredAccess.getByLabel('Any workspace').click()
  await expect(configuredAccess.getByText(/includes workspaces created later/i)).toBeVisible()
  await panel.getByRole('button', { name: 'Save workspace access' }).click()
  await expect.poll(() => appWindow.evaluate(`window.hronautWallets.list().then(
    (wallets) => wallets.find((wallet) => wallet.publicAddress === '0x0000000000000000000000000000000000000001')?.availableInAllWorkspaces
  )`)).toBe(true)

  const walletName = panel.getByRole('textbox', { name: 'Name', exact: true })
  await walletName.scrollIntoViewIfNeeded()
  const walletNameBounds = await walletName.boundingBox()
  const browserWindow = await electronApp.browserWindow(appWindow)
  const contentBounds = await browserWindow.evaluate((window) => window.getContentBounds())
  const shellZoom = await appWindow.evaluate(() => window.devicePixelRatio)
  if (!walletNameBounds || !contentBounds) throw new Error('Wallet name input did not expose native screen coordinates')
  await execFileAsync('python3', [
    join(process.cwd(), 'tests/integration/x11-input.py'),
    String(contentBounds.x + Math.round((walletNameBounds.x + walletNameBounds.width / 2) * shellZoom)),
    String(contentBounds.y + Math.round((walletNameBounds.y + walletNameBounds.height / 2) * shellZoom)),
    '--click'
  ])
  await expect(walletName).toBeFocused()
  await appWindow.keyboard.type('QA wallet')
  await expect(walletName).toHaveValue('QA wallet')

  await appWindow.getByRole('button', { name: 'Close settings' }).click()
  await appWindow.getByRole('button', { name: /Allow human page input/ }).click()
  await expect(appWindow.getByRole('button', { name: /Block human page input/ })).toHaveAttribute('aria-pressed', 'false')
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await dialog.getByRole('button', { name: 'Wallets Web3 accounts and policies' }).click()
  await walletName.click()
  await expect(walletName).toBeFocused()
  await appWindow.keyboard.type('QA wallet after unlock')
  await expect(walletName).toHaveValue('QA wallet after unlock')

  const chain = panel.getByRole('combobox', { name: 'Chain' })
  await chain.click()
  await expect(chain).toBeFocused()
  await execFileAsync('python3', [
    join(process.cwd(), 'tests/integration/x11-input.py'),
    '0',
    '0',
    '--shortcut=Down'
  ])
  await execFileAsync('python3', [
    join(process.cwd(), 'tests/integration/x11-input.py'),
    '0',
    '0',
    '--shortcut=Return'
  ])
  await expect(chain).toHaveValue('solana')
  await expect(panel.getByRole('combobox', { name: 'Network preset' })).toHaveValue('solana-devnet')
  await expect(panel.getByRole('textbox', { name: 'Solana cluster' })).toHaveValue('devnet')
  await expect(panel.getByRole('textbox', { name: 'Solana RPC endpoint' })).toHaveValue('https://api.devnet.solana.com')

  await chain.selectOption('tron')
  await expect(panel.getByRole('textbox', { name: 'TRON network' })).toHaveValue('shasta')
  const preset = panel.getByRole('combobox', { name: 'Network preset' })
  await preset.click()
  await expect(preset).toBeFocused()
  await execFileAsync('python3', [
    join(process.cwd(), 'tests/integration/x11-input.py'),
    '0',
    '0',
    '--shortcut=Down'
  ])
  await execFileAsync('python3', [
    join(process.cwd(), 'tests/integration/x11-input.py'),
    '0',
    '0',
    '--shortcut=Return'
  ])
  await expect(preset).toHaveValue('tron-nile')
  await expect(panel.getByRole('textbox', { name: 'Full node HTTP URL' })).toHaveValue('https://nile.trongrid.io')

  await preset.selectOption('custom')
  const tronNetwork = panel.getByRole('textbox', { name: 'TRON network' })
  await expect(tronNetwork).toBeEnabled()
  await tronNetwork.fill('qa-private')
  await panel.getByRole('textbox', { name: 'Network name' }).fill('QA private TRON')
  await panel.getByRole('textbox', { name: 'Full node HTTP URL' }).fill('http://127.0.0.1:8090')
  await panel.getByRole('combobox', { name: 'Environment' }).selectOption('local')

  await panel.getByRole('button', { name: 'Watch only' }).click()
  const publicAddress = panel.getByRole('textbox', { name: 'Public address' })
  await publicAddress.click()
  await expect(publicAddress).toBeFocused()
  await appWindow.keyboard.type('TQAInteractiveWalletAddress')
  await expect(publicAddress).toHaveValue('TQAInteractiveWalletAddress')
  await appWindow.screenshot({ path: testInfo.outputPath('wallets-desktop.png') })
  const desktopLayout = await appWindow.evaluate<{
    pageOverflow: number
    dialogOverflow: number
    panelOverflow: number
    left: number
    right: number
    viewport: number
  }>(`(() => {
    const dialog = document.querySelector('.settings-dialog')
    const panel = document.querySelector('.wallet-settings')
    const rect = dialog?.getBoundingClientRect()
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      dialogOverflow: dialog ? dialog.scrollWidth - dialog.clientWidth : 1,
      panelOverflow: panel ? panel.scrollWidth - panel.clientWidth : 1,
      left: rect?.left ?? -1,
      right: rect?.right ?? Number.POSITIVE_INFINITY,
      viewport: window.innerWidth
    }
  })()`)
  expect(desktopLayout.pageOverflow).toBeLessThanOrEqual(1)
  expect(desktopLayout.dialogOverflow).toBeLessThanOrEqual(1)
  expect(desktopLayout.panelOverflow).toBeLessThanOrEqual(1)
  expect(desktopLayout.left).toBeGreaterThanOrEqual(0)
  expect(desktopLayout.right).toBeLessThanOrEqual(desktopLayout.viewport)

  await appWindow.setViewportSize({ width: 760, height: 520 })
  await expect(panel.getByRole('button', { name: 'Watch only' })).toBeVisible()
  const layout = await appWindow.evaluate<{
    pageOverflow: number
    dialogOverflow: number
    panelOverflow: number
    visiblePanelHeight: number
    left: number
    right: number
    viewport: number
  }>(`(() => {
    const dialog = document.querySelector('.settings-dialog')
    const panel = document.querySelector('.wallet-settings')
    const rect = dialog?.getBoundingClientRect()
    const panelRect = panel?.getBoundingClientRect()
    return {
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      dialogOverflow: dialog ? dialog.scrollWidth - dialog.clientWidth : 1,
      panelOverflow: panel ? panel.scrollWidth - panel.clientWidth : 1,
      visiblePanelHeight: rect && panelRect
        ? Math.max(0, Math.min(rect.bottom, panelRect.bottom) - Math.max(rect.top, panelRect.top))
        : 0,
      left: rect?.left ?? -1,
      right: rect?.right ?? Number.POSITIVE_INFINITY,
      viewport: window.innerWidth
    }
  })()`)
  await appWindow.screenshot({ path: testInfo.outputPath('wallets-minimum.png') })

  expect(layout.pageOverflow).toBeLessThanOrEqual(1)
  expect(layout.dialogOverflow).toBeLessThanOrEqual(1)
  expect(layout.panelOverflow).toBeLessThanOrEqual(1)
  expect(layout.visiblePanelHeight).toBeGreaterThan(120)
  expect(layout.left).toBeGreaterThanOrEqual(0)
  expect(layout.right).toBeLessThanOrEqual(layout.viewport)
})

test('discards a generated wallet when recovery material is not confirmed', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(`(async () => {
    const status = await window.hronautWallets.status()
    if (status.managedWallets === 'passphrase-setup-required') {
      await window.hronautWallets.setupPassphrase('docker-wallet-test-passphrase')
    }
  })()`)
  await electronApp.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  })

  await expect(appWindow.evaluate(`window.hronautWallets.generate({
    name: 'Discarded wallet',
    chainFamily: 'evm',
    network: { id: '31337', name: 'Anvil', environment: 'local', rpcUrl: 'http://127.0.0.1:8545' },
    workspaceIds: []
  })`)).rejects.toThrow('Wallet creation cancelled before recovery confirmation')
  await expect.poll(() => appWindow.evaluate('window.hronautWallets.list()')).toEqual([])
})

test('confirms a validated private-key import through the trusted Settings IPC boundary', async ({ appWindow }, testInfo) => {
  await appWindow.evaluate(`(async () => {
    const status = await window.hronautWallets.status()
    if (status.managedWallets === 'passphrase-setup-required') {
      await window.hronautWallets.setupPassphrase('docker-wallet-import-passphrase')
    }
  })()`)

  await appWindow.getByRole('button', { name: 'Settings' }).click()
  const dialog = appWindow.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Wallets Web3 accounts and policies' }).click()
  const panel = dialog.locator('.wallet-settings')
  await panel.getByRole('button', { name: 'Import' }).click()
  const walletName = panel.getByRole('textbox', { name: 'Name', exact: true })
  await walletName.fill('Imported through Settings')
  await panel.getByRole('combobox', { name: 'Secret format' }).selectOption('private-key')
  await panel.getByRole('textbox', { name: 'Private key', exact: true }).fill(`0x${'01'.repeat(32)}`)
  await panel.getByRole('button', { name: 'Validate and review' }).click()
  await expect(panel.getByText('Step 2 of 2 · Add wallet')).toBeVisible()
  await expect(panel.getByText('Wallet validated')).toBeVisible()
  await expect(panel.getByText('No workspace access')).toBeVisible()
  await expect(panel.getByRole('textbox', { name: 'Private key', exact: true })).toHaveCount(0)
  await appWindow.screenshot({ path: testInfo.outputPath('wallet-import-review.png') })
  await panel.getByRole('button', { name: 'Add encrypted wallet' }).click()

  const walletSelector = panel.getByRole('combobox', { name: 'Wallet to manage' })
  await expect(walletName).toHaveValue('')
  await expect(walletSelector).toBeFocused()
  await expect(walletSelector.locator('option:checked')).toContainText('Imported through Settings')
  await expect.poll(() => appWindow.evaluate(`window.hronautWallets.list().then(
    (wallets) => wallets.some((wallet) => wallet.name === 'Imported through Settings')
  )`)).toBe(true)
  await expect(panel.getByRole('alert')).toHaveCount(0)
})
