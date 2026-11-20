import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Page } from '@playwright/test'
import type { Address, Hex } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import { expect, test, text } from './capability-fixtures.js'
import { nativeBalance, startAnvil, type AnvilChain } from './anvil.js'

// An agent uses Hronaut's wallet on Reown's own live sites, which run the AppKit releases our pinned test shop
// (wallet-reown-appkit.e2e.ts) cannot move to under the Reown Community License: the AppKit lab (AppKit 2, wagmi and
// ethers) and the AppKit demo. They change without notice and need the internet, so these checks run on their own
// schedule (.github/workflows/live-sites.yml), never in CI or the release gate.
//
// The wallet's network is always a local Anvil node with the chain ID the site expects, and its key is new for each
// test, so a signature or transaction never reaches a real chain and the account holds nothing anywhere else.

const LAB = 'https://lab.reown.com/appkit'
const DEMO = 'https://demo.reown.com/'

interface LiveWallet {
  chain: AnvilChain
  address: Address
}

async function liveWallet(appWindow: Page, workspaceId: string, network: { id: string; name: string; environment: 'testnet' | 'mainnet' }): Promise<LiveWallet> {
  const chain = await startAnvil(Number(network.id))
  try {
    const key = generatePrivateKey()
    const address = privateKeyToAddress(key)
    await chain.rpc('anvil_setBalance', [address, '0xde0b6b3a7640000'])
    const vault = await appWindow.evaluate('window.hronautWallets.status()') as { managedWallets: string }
    if (vault.managedWallets === 'passphrase-setup-required') {
      await appWindow.evaluate(`window.hronautWallets.setupPassphrase('reown live sites integration passphrase')`)
    }
    const prepared = await appWindow.evaluate(`window.hronautWallets.prepareImport('evm', 'private-key', ${JSON.stringify(key)})`) as { token: string }
    await appWindow.evaluate(`window.hronautWallets.confirmImport(${JSON.stringify(prepared.token)}, {
      name: 'Live site wallet',
      network: { ...${JSON.stringify(network)}, rpcUrl: ${JSON.stringify(chain.url)} },
      workspaceIds: [${JSON.stringify(workspaceId)}],
      dedicatedAgent: false
    })`)
    return { chain, address }
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
  // The demo rewrites its address once it loads; a snapshot taken meanwhile asks for a fresh one, which the next poll takes.
  const snapshot = async (): Promise<string> => {
    const result = await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult
    return result.isError ? '' : text(result)
  }
  return {
    call,
    snapshot,
    async click(name: RegExp, options: { native?: boolean } = {}): Promise<void> {
      let ref: string | undefined
      await expect.poll(async () => {
        ref = (await snapshot()).split('\n').find((line) => name.test(line))?.match(/^\[(e\d+)\]/)?.[1]
        return ref
      }, { message: `a control named ${name} in the snapshot`, timeout: 30_000 }).toBeDefined()
      await call('browser_click', { ref, ...options })
    },
    async waitForText(expected: string | RegExp, timeout = 30_000): Promise<void> {
      await expect.poll(snapshot, { timeout }).toMatch(expected)
    },
    async pageRequests(): Promise<{ requests: Array<{ operation: string; status: string; transactionHash?: Hex }>; failedCalls?: Array<{ method: string; error: string }> }> {
      const listed = JSON.parse(await call('wallet_list', { agentName: 'Live site agent' })) as { walletSessionId: string }
      return JSON.parse(await call('wallet_page_requests', { walletSessionId: listed.walletSessionId }))
    }
  }
}

/** A person answers the wallet's approval in Hronaut's own window. */
async function personAnswers(appWindow: Page, name: RegExp, answer: 'Approve exact request' | 'Reject'): Promise<void> {
  const approval = appWindow.getByRole('alertdialog', { name })
  await expect(approval).toBeVisible({ timeout: 30_000 })
  await approval.getByRole('button', { name: answer }).click()
  await expect(approval).toBeHidden()
}

test('connects on the AppKit 2 lab with wagmi and signs, a person approving one signature and rejecting another', async ({ capabilities, appWindow }) => {
  const { client, tabId, workspace } = capabilities
  const wallet = await liveWallet(appWindow, workspace.workspaceId, { id: '11155111', name: 'Sepolia', environment: 'testnet' })
  try {
    const agent = agentOnPage(client, tabId)
    await agent.call('browser_navigate', { url: `${LAB}?name=wagmi` })
    // AppKit 2's buttons are nested web components; trusted clicks reach them through their open shadow roots.
    await agent.click(/button "Connect Wallet"/, { native: true })
    await agent.click(/button "Hronaut INSTALLED"/, { native: true })
    await personAnswers(appWindow, /Connect account/i, 'Approve exact request')
    // The lab starts on Ethereum; wagmi keeps the wallet's own network when Hronaut refuses to switch.
    await agent.waitForText(`eip155:11155111:${wallet.address}`)

    await agent.click(/button "Sign Message"/)
    await personAnswers(appWindow, /sign message/i, 'Approve exact request')
    await agent.waitForText('Signing Succeeded')

    await agent.click(/button "Sign Typed Data"/)
    await personAnswers(appWindow, /sign/i, 'Reject')
    await agent.waitForText(/Failed to sign/)

    const seen = await agent.pageRequests()
    expect(seen.requests.map(({ operation, status }) => ({ operation, status }))).toEqual(expect.arrayContaining([
      { operation: 'connect-account', status: 'confirmed' },
      { operation: 'sign-message', status: 'confirmed' },
      { operation: 'sign-message', status: 'rejected' }
    ]))
  } finally {
    await wallet.chain.stop()
  }
})

test('sends a transaction from the AppKit 2 lab with ethers after the agent picks the wallet network, a person approving it', async ({ capabilities, appWindow }) => {
  const { client, tabId, workspace } = capabilities
  const wallet = await liveWallet(appWindow, workspace.workspaceId, { id: '11155111', name: 'Sepolia', environment: 'testnet' })
  try {
    const agent = agentOnPage(client, tabId)
    await agent.call('browser_navigate', { url: `${LAB}?name=ethers` })
    // AppKit's ethers adapter makes the wallet switch to the site's network on connect, so the agent picks Sepolia,
    // the wallet's network, in the site's network list first.
    await agent.click(/button "Ethereum"/, { native: true })
    await agent.click(/button "Sepolia"/)
    await agent.waitForText('CAIP NETWORK ID eip155:11155111')
    await agent.call('browser_press', { key: 'Escape' })
    await agent.click(/button "Connect Wallet"/, { native: true })
    await agent.click(/button "Hronaut INSTALLED"/, { native: true })
    await personAnswers(appWindow, /Connect account/i, 'Approve exact request')
    await agent.waitForText(`eip155:11155111:${wallet.address}`)

    const before = await nativeBalance(wallet.chain, wallet.address)
    await agent.click(/button "Send Transaction to Vitalik"/)
    await personAnswers(appWindow, /send transaction/i, 'Approve exact request')
    let sent: Hex | undefined
    await expect.poll(async () => {
      sent = (await agent.pageRequests()).requests.find((request) => request.operation === 'sign-and-send-transaction' && request.status === 'confirmed')?.transactionHash
      return sent
    }, { timeout: 30_000 }).toMatch(/^0x[0-9a-f]{64}$/)
    const receipt = await wallet.chain.rpc<{ status: Hex; from: string }>('eth_getTransactionReceipt', [sent])
    expect(receipt).toMatchObject({ status: '0x1', from: wallet.address.toLowerCase() })
    expect(await nativeBalance(wallet.chain, wallet.address)).toBeLessThan(before)
  } finally {
    await wallet.chain.stop()
  }
})

test('connects on the AppKit demo, whose networks are all mainnets', async ({ capabilities, appWindow }) => {
  const { client, tabId, workspace } = capabilities
  // The demo lists no testnet and its ethers adapter asks the wallet to switch to Ethereum, so the wallet's network is
  // Ethereum's chain ID served by the local node. Nothing is signed.
  const wallet = await liveWallet(appWindow, workspace.workspaceId, { id: '1', name: 'Ethereum', environment: 'mainnet' })
  try {
    const agent = agentOnPage(client, tabId)
    await agent.call('browser_navigate', { url: DEMO })
    // Hronaut offers EVM and Solana, so the demo asks which one to connect.
    await agent.click(/button "Hronaut MULTICHAIN"/, { native: true })
    await agent.click(/button "EVM Networks"/, { native: true })
    await personAnswers(appWindow, /Connect account/i, 'Approve exact request')
    const shown = `${wallet.address.slice(0, 4)}...${wallet.address.slice(-6)}`
    await agent.waitForText(`button "${shown}"`)
    // With the wallet on the network the demo asked for, nothing the demo called failed.
    expect((await agent.pageRequests()).failedCalls ?? []).toEqual([])
  } finally {
    await wallet.chain.stop()
  }
})
