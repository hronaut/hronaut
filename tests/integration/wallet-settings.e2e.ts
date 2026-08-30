import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

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
    await new Promise<void>((resolve) => website.close(() => resolve()))
  }
})

test('keeps trusted Wallets settings usable at desktop and minimum window sizes', async ({ appWindow }, testInfo) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  const dialog = appWindow.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Wallets Web3 accounts and policies' }).click()
  const panel = dialog.locator('.wallet-settings')

  await expect(panel.getByRole('heading', { name: 'Wallets', exact: true })).toBeVisible()
  await expect(panel.getByText(/trusted main process/i)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Generate' })).toBeVisible()
  await appWindow.screenshot({ path: testInfo.outputPath('wallets-desktop.png') })

  await appWindow.setViewportSize({ width: 760, height: 520 })
  await expect(panel.getByRole('button', { name: 'Watch only' })).toBeVisible()
  const layout = await appWindow.evaluate<{
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
  await appWindow.screenshot({ path: testInfo.outputPath('wallets-minimum.png') })

  expect(layout.pageOverflow).toBeLessThanOrEqual(1)
  expect(layout.dialogOverflow).toBeLessThanOrEqual(1)
  expect(layout.panelOverflow).toBeLessThanOrEqual(1)
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
