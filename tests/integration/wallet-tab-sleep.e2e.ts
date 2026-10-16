import { expect, test } from './capability-fixtures.js'

test('keeps a dApp tab awake while its wallet approval is open, then lets it sleep', async ({ capabilities, appWindow, electronApp }) => {
  const { workspace, tabId, fixtureUrl, fixtureOrigin } = capabilities
  const vaultStatus = await appWindow.evaluate('window.hronautWallets.status()') as { managedWallets: string }
  if (vaultStatus.managedWallets === 'passphrase-setup-required') {
    await appWindow.evaluate(`window.hronautWallets.setupPassphrase('wallet tab sleep integration passphrase')`)
  }
  // Anvil's first development key. Nothing here reaches a node: the connection request is answered by Hronaut itself.
  const prepared = await appWindow.evaluate(`window.hronautWallets.prepareImport('evm', 'private-key',
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')`) as { token: string }
  await appWindow.evaluate(`window.hronautWallets.confirmImport(${JSON.stringify(prepared.token)}, {
    name: 'Tab sleep wallet', network: { id: '31337', name: 'Local', environment: 'local', rpcUrl: 'http://127.0.0.1:8545' },
    workspaceIds: [${JSON.stringify(workspace.workspaceId)}], dedicatedAgent: false
  })`)
  const requests = async () => await appWindow.evaluate('window.hronautWallets.listRequests()') as Array<{ id: string; status: string }>
  const sleeping = () => appWindow.evaluate(`window.hronaut.getState().then((state) => (
    state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.sleeping
  ))`)

  await electronApp.evaluate(({ webContents }, pageUrl) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)
    if (!page) throw new Error('Wallet tab sleep fixture WebContents was not found')
    void page.executeJavaScript(`window.walletTabSleepConnection = window.ethereum.request({ method: 'eth_requestAccounts' })
      .then((accounts) => 'connected:' + accounts.length, (error) => 'failed:' + error.code); 'requested'`)
  }, fixtureUrl)
  await expect.poll(async () => (await requests()).map(({ status }) => status)).toEqual(['awaiting-human'])

  // Another tab takes the foreground, so the dApp tab is eligible for Memory Saver except for its open approval.
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${fixtureOrigin}/other-tab`)}, active: true })`)
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.activeTabId !== ${JSON.stringify(tabId)})`)).toBe(true)
  await appWindow.evaluate('window.hronaut.sleepInactiveTabs()')
  expect(await sleeping()).toBe(false)
  await expect(appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(tabId)}, true)`))
    .rejects.toThrow('A tab waiting on a wallet request stays active.')
  expect(await sleeping()).toBe(false)
  expect((await requests()).map(({ status }) => status)).toEqual(['awaiting-human'])

  // Once the person answers, the page has its result and the tab may sleep.
  await appWindow.evaluate(`window.hronautWallets.rejectRequest(${JSON.stringify((await requests())[0]!.id)})`)
  await expect.poll(() => electronApp.evaluate(({ webContents }, pageUrl) => (
    webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)?.executeJavaScript('window.walletTabSleepConnection')
  ), fixtureUrl)).toBe('failed:4001')
  await appWindow.evaluate('window.hronaut.sleepInactiveTabs()')
  await expect.poll(sleeping).toBe(true)
})
