import { z } from 'zod'
import {
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageDecoder,
  getInstructionsFromCompiledTransactionMessage,
  getTransactionDecoder,
  getTransactionEncoder,
  isAddress,
  type Transaction
} from '@solana/kit'
import type { WalletDescriptor } from '../../../shared/wallet.js'
import { deriveWalletAccount } from '../accounts.js'
import type { WalletSecret } from '../vault.js'
import type {
  WalletChainAdapter,
  WalletConfirmation,
  WalletNormalizedTransaction,
  WalletTransactionSimulation
} from './types.js'

const SYSTEM_PROGRAM = '11111111111111111111111111111111'
const PayloadSchema = z.object({
  transaction: z.union([z.string().min(1).max(8_192), z.instanceof(Uint8Array)]),
  account: z.union([z.string(), z.object({ address: z.string() }).passthrough()]).optional(),
  chain: z.string().max(128).optional()
}).passthrough()

interface SolanaSimulation {
  err: unknown | null
  fee: bigint | null
  logs: string[] | null
}

interface SolanaRpcClient {
  simulate(base64: string): Promise<SolanaSimulation>
  balance(address: string): Promise<bigint>
  send(base64: string): Promise<string>
  status(signature: string): Promise<{ confirmationStatus: string | null; err: unknown | null; slot: bigint } | null>
}

function base64Bytes(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Solana transaction encoding is invalid')
  const bytes = Buffer.from(value, 'base64')
  if (!bytes.length || bytes.length > 2_048 || bytes.toString('base64') !== value) throw new Error('Solana transaction encoding is invalid')
  return bytes
}

function transactionBytes(value: string | Uint8Array): Buffer {
  const bytes = typeof value === 'string' ? base64Bytes(value) : Buffer.from(value)
  if (!bytes.length || bytes.length > 2_048) throw new Error('Solana transaction encoding is invalid')
  return bytes
}

function decodeOwnedTransaction(bytes: Uint8Array): Transaction {
  const decoded = getTransactionDecoder().decode(bytes)
  return {
    messageBytes: Uint8Array.from(decoded.messageBytes) as unknown as Transaction['messageBytes'],
    signatures: Object.fromEntries(Object.entries(decoded.signatures).map(([signer, signature]) => [
      signer,
      signature === null ? null : Uint8Array.from(signature)
    ])) as Transaction['signatures']
  }
}

function formatSol(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

function u32le(bytes: { readonly length: number; readonly [index: number]: number }): number {
  if (bytes.length < 4) return -1
  return bytes[0]! | bytes[1]! << 8 | bytes[2]! << 16 | bytes[3]! << 24
}

function u64le(bytes: { readonly length: number; readonly [index: number]: number }): bigint {
  if (bytes.length < 8) throw new Error('Solana instruction is truncated')
  let value = 0n
  for (let index = 7; index >= 0; index -= 1) value = value << 8n | BigInt(bytes[index]!)
  return value
}

function decodeOperation(transaction: Transaction) {
  try {
    const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)
    const instructions = getInstructionsFromCompiledTransactionMessage(compiled)
    if (instructions.length === 1) {
      const instruction = instructions[0]!
      if (instruction.programAddress === SYSTEM_PROGRAM && instruction.data && u32le(instruction.data) === 2 && instruction.accounts?.[1]) {
        const lamports = u64le(instruction.data.subarray(4, 12))
        return {
          understood: true,
          destination: instruction.accounts[1].address,
          method: 'system.transfer',
          nativeAmount: formatSol(lamports),
          unlimitedAllowance: false,
          newContractOrProgram: false,
          blindMessage: false
        }
      }
    }
    return {
      understood: false,
      destination: undefined,
      method: instructions.length === 1 ? `program:${instructions[0]!.programAddress}` : `instructions:${instructions.length}`,
      unlimitedAllowance: false,
      newContractOrProgram: true,
      blindMessage: false
    }
  } catch {
    return {
      understood: false,
      method: 'unresolved-versioned-transaction',
      unlimitedAllowance: false,
      newContractOrProgram: true,
      blindMessage: false
    }
  }
}

function defaultClient(wallet: WalletDescriptor): SolanaRpcClient {
  const rpc = createSolanaRpc(wallet.network.rpcUrl)
  return {
    async simulate(base64) {
      const response = await rpc.simulateTransaction(base64 as never, {
        encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false
      }).send()
      return { err: response.value.err, fee: response.value.fee, logs: response.value.logs }
    },
    async balance(value) {
      return (await rpc.getBalance(address(value)).send()).value
    },
    async send(base64) {
      return rpc.sendTransaction(base64 as never, { encoding: 'base64', skipPreflight: false }).send()
    },
    async status(value) {
      const result = (await rpc.getSignatureStatuses([value as never], { searchTransactionHistory: true }).send()).value[0]
      return result ? { confirmationStatus: result.confirmationStatus, err: result.err, slot: result.slot } : null
    }
  }
}

export class SolanaWalletAdapter implements WalletChainAdapter {
  readonly family = 'solana' as const

  constructor(private readonly clientFor: (wallet: WalletDescriptor) => SolanaRpcClient = defaultClient) {}

  validateAddress(value: string): boolean {
    return isAddress(value)
  }

  async normalizeTransaction(wallet: WalletDescriptor, payload: unknown): Promise<WalletNormalizedTransaction> {
    const input = PayloadSchema.parse(payload)
    if (!isAddress(wallet.publicAddress)) throw new Error('Wallet account is invalid')
    const requestedAccount = typeof input.account === 'string' ? input.account : input.account?.address
    if (requestedAccount && requestedAccount !== wallet.publicAddress) throw new Error('Solana transaction signer does not match the selected wallet')
    if (input.chain) {
      const expected = `solana:${wallet.network.id}`
      if (input.chain !== expected) throw new Error('Solana transaction chain does not match the wallet network')
    }
    const bytes = transactionBytes(input.transaction)
    let transaction: Transaction
    try {
      transaction = decodeOwnedTransaction(bytes)
    } catch {
      throw new Error('Solana transaction is malformed')
    } finally {
      bytes.fill(0)
    }
    if (!Object.keys(transaction.signatures).includes(wallet.publicAddress)) {
      throw new Error('Solana transaction does not require the selected signer')
    }
    const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes) as { lifetimeToken?: string }
    return {
      chainFamily: this.family,
      networkId: wallet.network.id,
      signer: wallet.publicAddress,
      ...(compiled.lifetimeToken ? { nonceOrBlockhash: compiled.lifetimeToken } : {}),
      raw: { transaction: Buffer.from(getTransactionEncoder().encode(transaction)).toString('base64') },
      decoded: decodeOperation(transaction)
    }
  }

  async simulate(wallet: WalletDescriptor, transaction: WalletNormalizedTransaction): Promise<WalletTransactionSimulation> {
    try {
      const response = await this.clientFor(wallet).simulate(transaction.raw.transaction as string)
      const estimatedFee = response.fee === null ? undefined : formatSol(response.fee)
      transaction.decoded.estimatedFee = estimatedFee
      return {
        attempted: true,
        success: response.err === null,
        ...(estimatedFee ? { estimatedFee } : {}),
        ...(response.logs ? { logs: response.logs.slice(0, 100).map((line) => line.slice(0, 1_024)) } : {}),
        ...(response.err === null ? {} : { error: 'Solana simulation rejected the transaction' })
      }
    } catch (error) {
      return { attempted: true, success: false, error: error instanceof Error ? error.message.slice(0, 512) : 'Solana simulation failed' }
    }
  }

  async sign(wallet: WalletDescriptor, secret: WalletSecret, transaction: WalletNormalizedTransaction): Promise<string> {
    const account = await deriveWalletAccount(wallet.chainFamily, secret)
    try {
      if (account.publicAddress !== wallet.publicAddress || transaction.signer !== wallet.publicAddress) {
        throw new Error('Solana transaction signer does not match the selected wallet')
      }
      const bytes = base64Bytes(transaction.raw.transaction as string)
      let decoded: Transaction
      try {
        decoded = decodeOwnedTransaction(bytes)
      } finally {
        bytes.fill(0)
      }
      if (!Object.keys(decoded.signatures).includes(wallet.publicAddress)) {
        throw new Error('Solana transaction does not require the selected signer')
      }
      const signer = await createKeyPairSignerFromPrivateKeyBytes(account.privateKey)
      const [signatureDictionary] = await signer.signTransactions([decoded as never])
      if (!signatureDictionary?.[address(wallet.publicAddress)]) throw new Error('Solana transaction signing failed')
      const signed: Transaction = {
        ...decoded,
        signatures: { ...decoded.signatures, ...signatureDictionary }
      }
      return getBase64EncodedWireTransaction(signed)
    } finally {
      account.privateKey.fill(0)
      secret.material.fill(0)
    }
  }

  broadcast(wallet: WalletDescriptor, signedTransaction: string): Promise<string> {
    base64Bytes(signedTransaction).fill(0)
    return this.clientFor(wallet).send(signedTransaction)
  }

  async confirmation(wallet: WalletDescriptor, transactionHash: string): Promise<WalletConfirmation> {
    const status = await this.clientFor(wallet).status(transactionHash)
    if (!status) return { confirmed: false, failed: false }
    return {
      confirmed: status.err === null && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized'),
      failed: status.err !== null,
      blockReference: status.slot.toString()
    }
  }

  async balance(wallet: WalletDescriptor): Promise<string> {
    if (!isAddress(wallet.publicAddress)) throw new Error('Wallet account is invalid')
    return formatSol(await this.clientFor(wallet).balance(wallet.publicAddress))
  }
}
