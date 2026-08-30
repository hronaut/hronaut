import type { WalletChainFamily, WalletNetwork } from './wallet.js'

export interface WalletNetworkPreset {
  key: string
  chainFamily: WalletChainFamily
  network: WalletNetwork
  publicEndpoint: boolean
}

function preset(
  key: string,
  chainFamily: WalletChainFamily,
  id: string,
  name: string,
  environment: WalletNetwork['environment'],
  rpcUrl: string,
  publicEndpoint = true
): WalletNetworkPreset {
  return Object.freeze({
    key,
    chainFamily,
    network: Object.freeze({ id, name, environment, rpcUrl }),
    publicEndpoint
  })
}

// EVM defaults are copied from the viem 2.56 chain catalog. They are intentionally
// stored as values so an application upgrade never rewrites an existing wallet.
const EVM_PRESETS = [
  preset('evm-11155111', 'evm', '11155111', 'Sepolia', 'testnet', 'https://11155111.rpc.thirdweb.com'),
  preset('evm-1', 'evm', '1', 'Ethereum', 'mainnet', 'https://ethereum.reth.rs/rpc'),
  preset('evm-560048', 'evm', '560048', 'Hoodi', 'testnet', 'https://rpc.hoodi.ethpandaops.io'),
  preset('evm-8453', 'evm', '8453', 'Base', 'mainnet', 'https://mainnet.base.org'),
  preset('evm-84532', 'evm', '84532', 'Base Sepolia', 'testnet', 'https://sepolia.base.org'),
  preset('evm-42161', 'evm', '42161', 'Arbitrum One', 'mainnet', 'https://arb1.arbitrum.io/rpc'),
  preset('evm-421614', 'evm', '421614', 'Arbitrum Sepolia', 'testnet', 'https://sepolia-rollup.arbitrum.io/rpc'),
  preset('evm-10', 'evm', '10', 'OP Mainnet', 'mainnet', 'https://mainnet.optimism.io'),
  preset('evm-11155420', 'evm', '11155420', 'OP Sepolia', 'testnet', 'https://sepolia.optimism.io'),
  preset('evm-137', 'evm', '137', 'Polygon', 'mainnet', 'https://polygon.drpc.org'),
  preset('evm-80002', 'evm', '80002', 'Polygon Amoy', 'testnet', 'https://polygon-amoy.drpc.org'),
  preset('evm-43114', 'evm', '43114', 'Avalanche', 'mainnet', 'https://api.avax.network/ext/bc/C/rpc'),
  preset('evm-43113', 'evm', '43113', 'Avalanche Fuji', 'testnet', 'https://api.avax-test.network/ext/bc/C/rpc'),
  preset('evm-56', 'evm', '56', 'BNB Smart Chain', 'mainnet', 'https://56.rpc.thirdweb.com'),
  preset('evm-97', 'evm', '97', 'BNB Smart Chain Testnet', 'testnet', 'https://data-seed-prebsc-1-s1.bnbchain.org:8545'),
  preset('evm-204', 'evm', '204', 'opBNB', 'mainnet', 'https://opbnb-mainnet-rpc.bnbchain.org'),
  preset('evm-5611', 'evm', '5611', 'opBNB Testnet', 'testnet', 'https://opbnb-testnet-rpc.bnbchain.org'),
  preset('evm-100', 'evm', '100', 'Gnosis', 'mainnet', 'https://rpc.gnosischain.com'),
  preset('evm-59144', 'evm', '59144', 'Linea Mainnet', 'mainnet', 'https://rpc.linea.build'),
  preset('evm-59141', 'evm', '59141', 'Linea Sepolia', 'testnet', 'https://rpc.sepolia.linea.build'),
  preset('evm-534352', 'evm', '534352', 'Scroll', 'mainnet', 'https://rpc.scroll.io'),
  preset('evm-534351', 'evm', '534351', 'Scroll Sepolia', 'testnet', 'https://sepolia-rpc.scroll.io'),
  preset('evm-324', 'evm', '324', 'ZKsync Era', 'mainnet', 'https://mainnet.era.zksync.io'),
  preset('evm-300', 'evm', '300', 'ZKsync Sepolia', 'testnet', 'https://sepolia.era.zksync.dev'),
  preset('evm-42220', 'evm', '42220', 'Celo', 'mainnet', 'https://forno.celo.org'),
  preset('evm-44787', 'evm', '44787', 'Celo Alfajores', 'testnet', 'https://alfajores-forno.celo-testnet.org'),
  preset('evm-81457', 'evm', '81457', 'Blast', 'mainnet', 'https://rpc.blast.io'),
  preset('evm-168587773', 'evm', '168587773', 'Blast Sepolia', 'testnet', 'https://sepolia.blast.io'),
  preset('evm-5000', 'evm', '5000', 'Mantle', 'mainnet', 'https://rpc.mantle.xyz'),
  preset('evm-5003', 'evm', '5003', 'Mantle Sepolia', 'testnet', 'https://rpc.sepolia.mantle.xyz'),
  preset('evm-1284', 'evm', '1284', 'Moonbeam', 'mainnet', 'https://rpc.api.moonbeam.network'),
  preset('evm-1287', 'evm', '1287', 'Moonbase Alpha', 'testnet', 'https://rpc.api.moonbase.moonbeam.network'),
  preset('evm-80094', 'evm', '80094', 'Berachain', 'mainnet', 'https://rpc.berachain.com'),
  preset('evm-80069', 'evm', '80069', 'Berachain Bepolia', 'testnet', 'https://bepolia.rpc.berachain.com'),
  preset('evm-146', 'evm', '146', 'Sonic', 'mainnet', 'https://rpc.soniclabs.com'),
  preset('evm-64165', 'evm', '64165', 'Sonic Testnet', 'testnet', 'https://rpc.testnet.soniclabs.com'),
  preset('evm-167000', 'evm', '167000', 'Taiko Mainnet', 'mainnet', 'https://rpc.mainnet.taiko.xyz'),
  preset('evm-167009', 'evm', '167009', 'Taiko Hekla', 'testnet', 'https://rpc.hekla.taiko.xyz'),
  preset('evm-130', 'evm', '130', 'Unichain', 'mainnet', 'https://mainnet.unichain.org/'),
  preset('evm-1301', 'evm', '1301', 'Unichain Sepolia', 'testnet', 'https://sepolia.unichain.org'),
  preset('evm-31337', 'evm', '31337', 'Anvil', 'local', 'http://127.0.0.1:8545', false)
]

const SOLANA_PRESETS = [
  preset('solana-devnet', 'solana', 'devnet', 'Solana Devnet', 'testnet', 'https://api.devnet.solana.com'),
  preset('solana-mainnet', 'solana', 'mainnet', 'Solana Mainnet', 'mainnet', 'https://api.mainnet.solana.com'),
  preset('solana-testnet', 'solana', 'testnet', 'Solana Testnet', 'testnet', 'https://api.testnet.solana.com'),
  preset('solana-localnet', 'solana', 'localnet', 'Solana Local Validator', 'local', 'http://127.0.0.1:8899', false)
]

const TRON_PRESETS = [
  preset('tron-shasta', 'tron', 'shasta', 'TRON Shasta', 'testnet', 'https://api.shasta.trongrid.io'),
  preset('tron-mainnet', 'tron', 'mainnet', 'TRON Mainnet', 'mainnet', 'https://api.trongrid.io'),
  preset('tron-nile', 'tron', 'nile', 'TRON Nile', 'testnet', 'https://nile.trongrid.io'),
  preset('tron-private', 'tron', 'private', 'TRON Private Network', 'local', 'http://127.0.0.1:8090', false)
]

export const WALLET_NETWORK_PRESETS = Object.freeze([
  ...EVM_PRESETS,
  ...SOLANA_PRESETS,
  ...TRON_PRESETS
])

export const DEFAULT_WALLET_NETWORK_PRESET: Record<WalletChainFamily, string> = Object.freeze({
  evm: 'evm-11155111',
  solana: 'solana-devnet',
  tron: 'tron-shasta'
})

export function walletNetworkPresetsFor(chainFamily: WalletChainFamily): readonly WalletNetworkPreset[] {
  return WALLET_NETWORK_PRESETS.filter((entry) => entry.chainFamily === chainFamily)
}

export function walletNetworkPreset(key: string): WalletNetworkPreset | undefined {
  return WALLET_NETWORK_PRESETS.find((entry) => entry.key === key)
}
