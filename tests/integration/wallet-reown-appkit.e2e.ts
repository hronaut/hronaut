import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Page } from '@playwright/test'
import { parseEther, type Address } from 'viem'
import { expect, test, text } from './capability-fixtures.js'
import { ANVIL_ACCOUNT, ANVIL_ACCOUNT_KEY, deployQaToken, nativeBalance, startAnvil, tokenBalance, type AnvilChain } from './anvil.js'
import { startReownShop, type ReownShop } from './reown-appkit-shop.js'

// An agent shops on a site built on Reown AppKit, the WalletConnect modal most dApps use, against a real Anvil node.
// The shop lists Ethereum mainnet first, as most sites do, while the wallet is only on the local chain.

/** Anvil's fourth default account, a merchant with no relation to the wallet. */
const MERCHANT = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'

interface ShopRun {
  chain: AnvilChain
  shop: ReownShop
  token: Address
  walletId: string
}

async function openShop(appWindow: Page, workspaceId: string): Promise<ShopRun> {
  const chain = await startAnvil()
  try {
    const token = await deployQaToken(chain, ANVIL_ACCOUNT, 100_000_000n)
    const shop = await startReownShop({ rpcUrl: chain.url, token, merchant: MERCHANT })
    const vaultStatus = await appWindow.evaluate('window.hronautWallets.status()') as { managedWallets: string }
    if (vaultStatus.managedWallets === 'passphrase-setup-required') {
      await appWindow.evaluate(`window.hronautWallets.setupPassphrase('reown appkit shop integration passphrase')`)
    }
    const prepared = await appWindow.evaluate(`window.hronautWallets.prepareImport('evm', 'private-key', ${JSON.stringify(ANVIL_ACCOUNT_KEY)})`) as { token: string }
    const imported = await appWindow.evaluate(`window.hronautWallets.confirmImport(${JSON.stringify(prepared.token)}, {
      name: 'Shop wallet',
      network: { id: '31337', name: 'Anvil', environment: 'local', rpcUrl: ${JSON.stringify(chain.url)} },
      workspaceIds: [${JSON.stringify(workspaceId)}],
      dedicatedAgent: false
    })`) as { id: string }
    return { chain, shop, token, walletId: imported.id }
  } catch (error) {
    await chain.stop()
    throw error
  }
}

/** What an agent does on the page: reads a snapshot, finds a control by its name and clicks its ref. */
function agentOnPage(client: Client, tabId: string) {
  const call = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const result = await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return text(result)
  }
  const snapshot = () => call('browser_snapshot', {})
  return {
    call,
    snapshot,
    async click(name: RegExp, options: { native?: boolean } = {}): Promise<void> {
      let ref: string | undefined
      await expect.poll(async () => {
        ref = (await snapshot()).split('\n').find((line) => name.test(line))?.match(/^\[(e\d+)\]/)?.[1]
        return ref
      }, { message: `a control named ${name} in the snapshot` }).toBeDefined()
      await call('browser_click', { ref, ...options })
    },
    async waitForText(expected: string, timeout = 20_000): Promise<void> {
      await expect.poll(snapshot, { timeout }).toContain(expected)
    }
  }
}

test('lets an agent connect through a Reown AppKit modal and pay a shop in tokens and ETH, a person approving each step', async ({ capabilities, appWindow }) => {
  const { client, tabId, workspace } = capabilities
  const run = await openShop(appWindow, workspace.workspaceId)
  try {
    const agent = agentOnPage(client, tabId)
    await agent.call('browser_navigate', { url: run.shop.url })

    // AppKit's button and modal are web components; the agent reaches their controls through the snapshot, and a
    // trusted click reaches the button's label through the open shadow roots around it.
    await agent.click(/button "Connect Wallet"/, { native: true })
    await agent.click(/button "Hronaut INSTALLED"/, { native: true })
    const connect = appWindow.getByRole('alertdialog', { name: /Connect account/i })
    await expect(connect).toBeVisible()
    await connect.getByRole('button', { name: 'Approve exact request' }).click()
    // AppKit asked to switch to mainnet first; the refusal keeps the wallet's own chain instead of failing the connection.
    await agent.waitForText(`Connected ${ANVIL_ACCOUNT} on chain 31337`)

    await agent.click(/button "Pay 5 QAUSD"/)
    const tokenPayment = appWindow.getByRole('alertdialog', { name: /send transaction/i })
    await expect(tokenPayment).toBeVisible()
    await expect(tokenPayment.locator('.wallet-approval-token-amount')).toContainText('5 QAUSD')
    await expect(tokenPayment.locator('.wallet-approval-token-amount')).toContainText('5000000 (smallest token units)')
    await tokenPayment.getByRole('button', { name: 'Approve exact request' }).click()
    await agent.waitForText('Pay 5 QAUSD: success 0x')
    expect(await tokenBalance(run.chain, run.token, MERCHANT)).toBe(5_000_000n)
    expect(await tokenBalance(run.chain, run.token, ANVIL_ACCOUNT)).toBe(95_000_000n)

    const merchantEth = await nativeBalance(run.chain, MERCHANT)
    await agent.click(/button "Pay 0.01 ETH"/)
    const ethPayment = appWindow.getByRole('alertdialog', { name: /send transaction/i })
    await expect(ethPayment).toBeVisible()
    await ethPayment.getByRole('button', { name: 'Approve exact request' }).click()
    await agent.waitForText('Pay 0.01 ETH: success 0x')
    expect(await nativeBalance(run.chain, MERCHANT) - merchantEth).toBe(parseEther('0.01'))

    // A payment the token would refuse: the person sees the contract's reason before signing, and declines.
    await agent.click(/button "Pay 500 QAUSD"/)
    const tooMuch = appWindow.getByRole('alertdialog', { name: /send transaction/i })
    await expect(tooMuch.getByTestId('wallet-approval-revert-reason').locator('code')).toHaveText('QaToken: transfer amount exceeds balance')
    await tooMuch.getByRole('button', { name: 'Reject' }).click()
    await agent.waitForText('Pay 500 QAUSD: failed (ContractFunctionExecutionError) User rejected the request.')
    expect(await tokenBalance(run.chain, run.token, MERCHANT)).toBe(5_000_000n)
  } finally {
    run.shop.close()
    await run.chain.stop()
  }
})

test('lets an agent pay a Reown AppKit shop on its own within a wallet policy, and leaves a larger payment to a person', async ({ capabilities, appWindow }) => {
  const { client, tabId, workspace } = capabilities
  const run = await openShop(appWindow, workspace.workspaceId)
  try {
    await appWindow.evaluate(`window.hronautWallets.setPolicy(${JSON.stringify({
      id: 'shop-payments', name: 'Shop payments', mode: 'bounded-auto', walletId: run.walletId,
      workspaceId: workspace.workspaceId, networkIds: ['31337'], origins: [run.shop.origin], destinations: [MERCHANT],
      contracts: [run.token], methods: ['erc20.transfer'], maxTokenAmount: '10', maxFee: '0.01',
      expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), maximumOperationCount: 5,
      requireSuccessfulSimulation: true, allowMessageSigning: false, allowWebsiteSignIn: true
    })})`)
    const agent = agentOnPage(client, tabId)
    await agent.call('browser_navigate', { url: run.shop.url })
    const approvals = appWindow.getByRole('alertdialog')

    // The policy lets the shop connect and take payments up to 10 QAUSD without a click.
    await agent.click(/button "Connect Wallet"/)
    await agent.click(/button "Hronaut INSTALLED"/)
    await agent.waitForText(`Connected ${ANVIL_ACCOUNT} on chain 31337`)
    await agent.click(/button "Pay 5 QAUSD"/)
    await agent.waitForText('Pay 5 QAUSD: success 0x')
    await expect(approvals).toHaveCount(0)
    expect(await tokenBalance(run.chain, run.token, MERCHANT)).toBe(5_000_000n)

    // The agent can also pay through its own wallet tools, within the same policy. Its first use of the account asks
    // a person, once; the payment then goes out without a click.
    const listed = JSON.parse(await agent.call('wallet_list', { agentName: 'Shop agent' })) as { walletSessionId: string }
    const transfer = `0xa9059cbb${MERCHANT.slice(2).toLowerCase().padStart(64, '0')}${(3_000_000n).toString(16).padStart(64, '0')}`
    const pay = async () => JSON.parse(await agent.call('wallet_request', {
      walletSessionId: listed.walletSessionId, walletId: run.walletId, action: 'sign-and-send', transaction: { to: run.token, data: transfer }
    })) as { status: string; request: { id: string; operation: string; status: string } }
    expect(await pay()).toMatchObject({ status: 'permission-required', request: { operation: 'connect-account', status: 'awaiting-human' } })
    const agentAccess = appWindow.getByRole('alertdialog', { name: /Connect account/i })
    await agentAccess.getByRole('button', { name: 'Approve exact request' }).click()
    await expect(approvals).toHaveCount(0)
    const requested = await pay()
    expect(requested).toMatchObject({ status: 'requested', request: { operation: 'sign-and-send-transaction' } })
    expect(requested.request.status).not.toBe('awaiting-human')
    await expect.poll(async () => (JSON.parse(await agent.call('wallet_request_status', {
      walletSessionId: listed.walletSessionId, requestId: requested.request.id
    })) as { status: string }).status, { timeout: 20_000 }).toBe('confirmed')
    await expect(approvals).toHaveCount(0)
    expect(await tokenBalance(run.chain, run.token, MERCHANT)).toBe(8_000_000n)

    // Over the limit, the payment waits for a person, who declines it.
    await agent.click(/button "Pay 500 QAUSD"/)
    const tooMuch = appWindow.getByRole('alertdialog', { name: /send transaction/i })
    await expect(tooMuch).toBeVisible()
    await tooMuch.getByRole('button', { name: 'Reject' }).click()
    await agent.waitForText('Pay 500 QAUSD: failed (ContractFunctionExecutionError) User rejected the request.')
    expect(await tokenBalance(run.chain, run.token, MERCHANT)).toBe(8_000_000n)
  } finally {
    run.shop.close()
    await run.chain.stop()
  }
})
