import { expect, test } from './fixtures.js'

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
