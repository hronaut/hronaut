import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import {
  createKeyPairSignerFromPrivateKeyBytes,
  createSignableMessage,
  isAddress as isSolanaAddress
} from '@solana/kit'
import slip10 from 'micro-key-producer/slip10.js'
import { getAddress, isAddress as isEvmAddress, toHex, type TypedDataDefinition } from 'viem'
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts'
import { TronWeb } from 'tronweb'
import type { WalletChainFamily } from '../../shared/wallet.js'
import type { WalletSecret, WalletSecretFormat } from './vault.js'

const DERIVATION_PATHS: Readonly<Record<WalletChainFamily, string>> = {
  evm: "m/44'/60'/0'/0/0",
  solana: "m/44'/501'/0'/0'",
  tron: "m/44'/195'/0'/0/0"
}

export interface DerivedWalletAccount {
  publicAddress: string
  privateKey: Buffer
}

export interface GeneratedWalletRecovery {
  publicAddress: string
  secret: WalletSecret
}

function normalizedMnemonic(material: Uint8Array): string {
  const mnemonic = Buffer.from(material).toString('utf8').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!validateMnemonic(mnemonic, wordlist)) throw new Error('Invalid wallet recovery material')
  return mnemonic
}

function parsePrivateKey(material: Uint8Array, chainFamily: WalletChainFamily): Buffer {
  if (material.length === 32) return Buffer.from(material)
  const text = Buffer.from(material).toString('utf8').trim()
  const hex = text.replace(/^0x/i, '')
  if (/^[a-f0-9]{64}$/i.test(hex)) return Buffer.from(hex, 'hex')
  if (chainFamily === 'solana' && /^\[(?:\s*\d{1,3}\s*,){31,63}\s*\d{1,3}\s*\]$/.test(text)) {
    try {
      const values = JSON.parse(text) as number[]
      if ((values.length === 32 || values.length === 64) && values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
        return Buffer.from(values.slice(0, 32))
      }
    } catch {
      // Fall through to the sanitized error below.
    }
  }
  throw new Error('Invalid wallet recovery material')
}

async function evmFromMnemonic(mnemonic: string): Promise<DerivedWalletAccount> {
  const account = mnemonicToAccount(mnemonic, { path: DERIVATION_PATHS.evm as `m/44'/60'/${string}` })
  const privateKey = account.getHdKey().privateKey
  if (!privateKey) throw new Error('Invalid wallet recovery material')
  return { publicAddress: account.address, privateKey: Buffer.from(privateKey) }
}

async function solanaFromMnemonic(mnemonic: string): Promise<DerivedWalletAccount> {
  const seed = mnemonicToSeedSync(mnemonic)
  try {
    const privateKey = Buffer.from(slip10.fromMasterSeed(seed).derive(DERIVATION_PATHS.solana).privateKey)
    const signer = await createKeyPairSignerFromPrivateKeyBytes(privateKey)
    return { publicAddress: signer.address, privateKey }
  } finally {
    seed.fill(0)
  }
}

function tronFromMnemonic(mnemonic: string): DerivedWalletAccount {
  const account = TronWeb.fromMnemonic(mnemonic, DERIVATION_PATHS.tron)
  const privateKey = Buffer.from(account.privateKey.replace(/^0x/i, ''), 'hex')
  if (privateKey.length !== 32 || !TronWeb.isAddress(account.address)) {
    privateKey.fill(0)
    throw new Error('Invalid wallet recovery material')
  }
  return { publicAddress: account.address, privateKey }
}

async function fromPrivateKey(chainFamily: WalletChainFamily, material: Uint8Array): Promise<DerivedWalletAccount> {
  const privateKey = parsePrivateKey(material, chainFamily)
  try {
    if (chainFamily === 'evm') {
      const account = privateKeyToAccount(toHex(privateKey))
      return { publicAddress: account.address, privateKey: Buffer.from(privateKey) }
    }
    if (chainFamily === 'solana') {
      const signer = await createKeyPairSignerFromPrivateKeyBytes(privateKey)
      return { publicAddress: signer.address, privateKey: Buffer.from(privateKey) }
    }
    const publicAddress = TronWeb.address.fromPrivateKey(privateKey.toString('hex'))
    if (!publicAddress) throw new Error('invalid Tron private key')
    return { publicAddress, privateKey: Buffer.from(privateKey) }
  } catch {
    throw new Error('Invalid wallet recovery material')
  } finally {
    privateKey.fill(0)
  }
}

export async function deriveWalletAccount(
  chainFamily: WalletChainFamily,
  secret: { format: WalletSecretFormat; material: Uint8Array }
): Promise<DerivedWalletAccount> {
  try {
    if (secret.format === 'private-key') return await fromPrivateKey(chainFamily, secret.material)
    const mnemonic = normalizedMnemonic(secret.material)
    if (chainFamily === 'evm') return await evmFromMnemonic(mnemonic)
    if (chainFamily === 'solana') return await solanaFromMnemonic(mnemonic)
    return tronFromMnemonic(mnemonic)
  } catch {
    throw new Error('Invalid wallet recovery material')
  }
}

export async function generateWalletRecovery(chainFamily: WalletChainFamily): Promise<GeneratedWalletRecovery> {
  const mnemonic = generateMnemonic(wordlist, 128)
  const material = Buffer.from(mnemonic, 'utf8')
  const derived = await deriveWalletAccount(chainFamily, { format: 'mnemonic', material })
  derived.privateKey.fill(0)
  return {
    publicAddress: derived.publicAddress,
    secret: { format: 'mnemonic', material }
  }
}

export function validateWatchOnlyWalletAddress(chainFamily: WalletChainFamily, address: string): boolean {
  try {
    if (chainFamily === 'evm') {
      if (!isEvmAddress(address)) return false
      getAddress(address)
      return true
    }
    if (chainFamily === 'solana') return isSolanaAddress(address)
    return TronWeb.isAddress(address) && address.startsWith('T')
  } catch {
    return false
  }
}

function accountMatches(chainFamily: WalletChainFamily, actual: string, expected: string): boolean {
  return chainFamily === 'evm' ? actual.toLowerCase() === expected.toLowerCase() : actual === expected
}

export async function signWalletMessage(
  chainFamily: WalletChainFamily,
  privateKey: Uint8Array,
  message: Uint8Array,
  expectedAddress?: string
): Promise<string> {
  if (!message.length || message.length > 1_048_576) throw new TypeError('Wallet message is invalid')
  const account = await fromPrivateKey(chainFamily, privateKey)
  try {
    if (expectedAddress && !accountMatches(chainFamily, account.publicAddress, expectedAddress)) {
      throw new Error('Wallet signing account mismatch')
    }
    if (chainFamily === 'evm') {
      return privateKeyToAccount(toHex(account.privateKey)).signMessage({ message: { raw: toHex(message) } })
    }
    if (chainFamily === 'solana') {
      const signer = await createKeyPairSignerFromPrivateKeyBytes(account.privateKey)
      const [signatures] = await signer.signMessages([createSignableMessage(Buffer.from(message))])
      const signature = signatures?.[signer.address]
      if (!signature) throw new Error('Wallet message signing failed')
      return Buffer.from(signature).toString('base64')
    }
    const tron = new TronWeb({ fullHost: 'http://127.0.0.1:9090' })
    return tron.trx.signMessageV2(Buffer.from(message), account.privateKey.toString('hex'))
  } finally {
    account.privateKey.fill(0)
  }
}

export type WalletMessageSigningInput =
  | { kind: 'message'; message: Uint8Array }
  | { kind: 'typed-data'; typedData: TypedDataDefinition }

export async function signWalletPayload(
  chainFamily: WalletChainFamily,
  secret: WalletSecret,
  input: WalletMessageSigningInput,
  expectedAddress: string
): Promise<string> {
  const account = await deriveWalletAccount(chainFamily, secret)
  try {
    if (!accountMatches(chainFamily, account.publicAddress, expectedAddress)) throw new Error('Wallet signing account mismatch')
    if (input.kind === 'typed-data') {
      if (chainFamily !== 'evm') throw new Error('Typed-data signing is only supported for EVM wallets')
      return privateKeyToAccount(toHex(account.privateKey)).signTypedData(input.typedData)
    }
    if (!input.message.length || input.message.length > 1_048_576) throw new Error('Wallet message is invalid')
    if (chainFamily === 'evm') {
      return privateKeyToAccount(toHex(account.privateKey)).signMessage({ message: { raw: toHex(input.message) } })
    }
    if (chainFamily === 'solana') {
      const signer = await createKeyPairSignerFromPrivateKeyBytes(account.privateKey)
      const [signatures] = await signer.signMessages([createSignableMessage(Buffer.from(input.message))])
      const signature = signatures?.[signer.address]
      if (!signature) throw new Error('Wallet message signing failed')
      return Buffer.from(signature).toString('base64')
    }
    const tron = new TronWeb({ fullHost: 'http://127.0.0.1:9090' })
    return tron.trx.signMessageV2(Buffer.from(input.message), account.privateKey.toString('hex'))
  } finally {
    account.privateKey.fill(0)
    secret.material.fill(0)
    if (input.kind === 'message') input.message.fill(0)
  }
}
