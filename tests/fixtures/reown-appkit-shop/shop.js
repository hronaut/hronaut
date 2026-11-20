// A small shop built the way many dApps are: Reown AppKit (the WalletConnect modal) with its wagmi adapter.
// The test page sets window.__shopConfig with the local chain's RPC URL, the token and the merchant.
// The shop lists Ethereum mainnet first, as most sites do, so AppKit asks the wallet to switch to it on connect.
import { createAppKit } from '@reown/appkit'
import { defineChain, mainnet } from '@reown/appkit/networks'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { sendTransaction, waitForTransactionReceipt, watchAccount, writeContract } from '@wagmi/core'
import { erc20Abi, parseEther, parseUnits } from 'viem'

const { rpcUrl, token, merchant, projectId } = window.__shopConfig

const localChain = defineChain({
  id: 31337,
  caipNetworkId: 'eip155:31337',
  chainNamespace: 'eip155',
  name: 'Hronaut QA chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } }
})

const wagmiAdapter = new WagmiAdapter({ networks: [mainnet, localChain], projectId })
const config = wagmiAdapter.wagmiConfig

const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks: [mainnet, localChain],
  projectId,
  metadata: { name: 'Hronaut QA shop', description: 'A test shop', url: location.origin, icons: [] },
  enableCoinbase: false,
  features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, history: false, send: false }
})
window.__shop = { appKit, log: [] }

const status = document.getElementById('status')
watchAccount(config, {
  onChange(account) {
    status.textContent = account.status === 'connected'
      ? `Connected ${account.address} on chain ${account.chainId}`
      : `Not connected (${account.status})`
  }
})

const log = (line) => {
  window.__shop.log.push(line)
  const item = document.createElement('li')
  item.textContent = line
  document.getElementById('log').append(item)
}

const pay = (button, label, send) => document.getElementById(button).addEventListener('click', async () => {
  log(`${label}: waiting for the wallet`)
  try {
    const hash = await send()
    const receipt = await waitForTransactionReceipt(config, { hash, chainId: localChain.id })
    log(`${label}: ${receipt.status} ${hash}`)
  } catch (error) {
    log(`${label}: failed (${error?.name ?? 'Error'}) ${error?.shortMessage ?? error?.message ?? error}`)
  }
})

const transfer = (amount) => writeContract(config, {
  address: token, abi: erc20Abi, functionName: 'transfer', args: [merchant, parseUnits(amount, 6)], chainId: localChain.id
})
pay('pay-token', 'Pay 5 QAUSD', () => transfer('5'))
pay('pay-too-much', 'Pay 500 QAUSD', () => transfer('500'))
pay('pay-eth', 'Pay 0.01 ETH', () => sendTransaction(config, { to: merchant, value: parseEther('0.01'), chainId: localChain.id }))
