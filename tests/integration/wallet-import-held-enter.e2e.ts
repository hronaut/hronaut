import { expect, test } from './fixtures.js'

test('a held Enter that validates a wallet import leaves the wallet for review', async ({ appWindow }) => {
  await appWindow.evaluate(`(async () => {
    const status = await window.hronautWallets.status()
    if (status.managedWallets === 'passphrase-setup-required') {
      await window.hronautWallets.setupPassphrase('held-enter-wallet-import-passphrase')
    }
  })()`)
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  const dialog = appWindow.getByRole('tabpanel', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Wallets Web3 accounts and policies' }).click()
  const panel = dialog.locator('.wallet-settings')
  await panel.getByRole('tab', { name: 'Add wallet' }).click()
  await panel.getByRole('button', { name: 'Import' }).click()
  await panel.getByRole('textbox', { name: 'Name', exact: true }).fill('Held Enter import')
  await panel.getByRole('combobox', { name: 'Secret format' }).selectOption('private-key')
  const privateKey = panel.getByRole('textbox', { name: 'Private key', exact: true })
  await privateKey.fill(`0x${'02'.repeat(32)}`)
  await privateKey.focus()
  const add = panel.getByRole('button', { name: 'Add encrypted wallet' })
  const imported = () => appWindow.evaluate(`window.hronautWallets.list()
    .then((wallets) => wallets.some((wallet) => wallet.name === 'Held Enter import'))`)

  // Enter in the private key validates it, and its review hands the focus to Add encrypted wallet.
  await appWindow.keyboard.down('Enter')
  await expect(panel.getByText('Wallet validated')).toBeVisible()
  for (let repeat = 0; repeat < 6; repeat += 1) {
    await appWindow.waitForTimeout(50)
    await expect(add).toBeFocused()
    await appWindow.keyboard.down('Enter')
  }
  await appWindow.keyboard.up('Enter')
  // The held key's repeats used to add the wallet before its address could be checked.
  await expect(panel.getByText('Step 2 of 2 · Add wallet')).toBeVisible()
  expect(await imported()).toBe(false)

  await appWindow.keyboard.press('Enter')
  await expect.poll(imported).toBe(true)
})
