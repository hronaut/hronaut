import { z } from 'zod'
import { TronWeb, utils, type Types } from 'tronweb'
import type { WalletDescriptor } from '../../../shared/wallet.js'
import { deriveWalletAccount } from '../accounts.js'
import type { WalletSecret } from '../vault.js'
import type {
  WalletChainAdapter,
  WalletConfirmation,
  WalletNormalizedTransaction,
  WalletTransactionSimulation
} from './types.js'

const TronContractSchema = z.object({
  type: z.string().min(1).max(128),
  parameter: z.object({
    type_url: z.string().max(256).optional(),
    value: z.record(z.string(), z.unknown())
  }).passthrough()
}).passthrough()

const TronTransactionSchema = z.object({
  txID: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  raw_data_hex: z.string().regex(/^[a-fA-F0-9]+$/).optional(),
  raw_data: z.object({
    contract: z.array(TronContractSchema).min(1).max(64),
    ref_block_bytes: z.string().max(32).optional(),
    ref_block_hash: z.string().max(64).optional(),
    expiration: z.number().int().positive().optional(),
    timestamp: z.number().int().positive().optional()
  }).passthrough(),
  signature: z.array(z.string()).max(16).optional(),
  visible: z.boolean().optional()
}).passthrough()

interface TronSimulationResult {
  attempted: boolean
  success: boolean
  estimatedFeeSun?: bigint
  error?: string
  logs?: string[]
}

interface TronRpcClient {
  simulate(transaction: Record<string, unknown>): Promise<TronSimulationResult>
  balance(address: string): Promise<bigint>
  broadcast(transaction: Record<string, unknown>): Promise<{ result: boolean; txid?: string; code?: string; message?: string }>
  transactionInfo(hash: string): Promise<{ blockNumber?: number; receipt?: { result?: string }; result?: string } | null>
}

function formatTrx(sun: bigint): string {
  const whole = sun / 1_000_000n
  const fraction = (sun % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

function fromHexAddress(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:41)?[a-fA-F0-9]{40}$/.test(value)) throw new Error('Tron transaction address is invalid')
  const hex = value.length === 40 ? `41${value}` : value
  const converted = TronWeb.address.fromHex(hex)
  if (!converted || !TronWeb.isAddress(converted)) throw new Error('Tron transaction address is invalid')
  return converted
}

function uint256Word(value: string): bigint {
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('Tron contract argument is invalid')
  return BigInt(`0x${value}`)
}

function contractOperation(contract: z.infer<typeof TronContractSchema>) {
  const value = contract.parameter.value
  if (contract.type === 'TransferContract') {
    const amount = typeof value.amount === 'number' && Number.isSafeInteger(value.amount) && value.amount >= 0
      ? BigInt(value.amount)
      : typeof value.amount === 'string' && /^\d+$/.test(value.amount) ? BigInt(value.amount) : undefined
    if (amount === undefined) throw new Error('Tron transfer amount is invalid')
    return {
      owner: fromHexAddress(value.owner_address),
      decoded: {
        understood: true,
        destination: fromHexAddress(value.to_address),
        method: 'trx.transfer',
        nativeAmount: formatTrx(amount),
        unlimitedAllowance: false,
        newContractOrProgram: false,
        blindMessage: false
      }
    }
  }
  if (contract.type === 'TriggerSmartContract') {
    const owner = fromHexAddress(value.owner_address)
    const contractAddress = fromHexAddress(value.contract_address)
    if (typeof value.data !== 'string' || !/^[a-fA-F0-9]+$/.test(value.data)) throw new Error('Tron contract data is invalid')
    const data = value.data.toLowerCase()
    const selector = data.slice(0, 8)
    const words = data.slice(8).match(/.{64}/g) ?? []
    if ((selector === 'a9059cbb' || selector === '095ea7b3') && words.length >= 2) {
      const amount = uint256Word(words[1]!)
      return {
        owner,
        decoded: {
          understood: true,
          destination: fromHexAddress(words[0]!.slice(24)),
          method: selector === 'a9059cbb' ? 'trc20.transfer' : 'trc20.approve',
          tokenAmount: amount.toString(),
          unlimitedAllowance: selector === '095ea7b3' && amount === (1n << 256n) - 1n,
          newContractOrProgram: false,
          blindMessage: false
        }
      }
    }
    if (selector === '23b872dd' && words.length >= 3) {
      return {
        owner,
        decoded: {
          understood: true,
          destination: fromHexAddress(words[1]!.slice(24)),
          method: 'trc20.transferFrom',
          tokenAmount: uint256Word(words[2]!).toString(),
          unlimitedAllowance: false,
          newContractOrProgram: false,
          blindMessage: false
        }
      }
    }
    return {
      owner,
      decoded: {
        understood: false,
        destination: contractAddress,
        method: `contract-call:${selector}`,
        unlimitedAllowance: false,
        newContractOrProgram: true,
        blindMessage: false
      }
    }
  }
  const owner = fromHexAddress(value.owner_address)
  return {
    owner,
    decoded: {
      understood: false,
      method: contract.type,
      unlimitedAllowance: false,
      newContractOrProgram: true,
      blindMessage: false
    }
  }
}

function cloneTransaction(value: unknown): Record<string, unknown> {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error('Tron transaction must be serializable')
  }
  if (Buffer.byteLength(serialized) > 1_000_000) throw new Error('Tron transaction is too large')
  return JSON.parse(serialized) as Record<string, unknown>
}

function defaultClient(wallet: WalletDescriptor): TronRpcClient {
  const tron = new TronWeb({ fullHost: wallet.network.rpcUrl })
  return {
    async simulate(transaction) {
      const parsed = TronTransactionSchema.parse(transaction)
      const contract = parsed.raw_data.contract[0]!
      if (contract.type === 'TransferContract') {
        const operation = contractOperation(contract)
        const rawAmount = contract.parameter.value.amount
        const requiredSun = typeof rawAmount === 'number' ? BigInt(rawAmount) : BigInt(rawAmount as string)
        const balance = BigInt(await tron.trx.getBalance(operation.owner))
        return balance >= requiredSun
          ? { attempted: true, success: true }
          : { attempted: true, success: false, error: 'Insufficient TRX balance' }
      }
      if (contract.type !== 'TriggerSmartContract') {
        return { attempted: false, success: false, error: 'Tron transaction type cannot be simulated safely' }
      }
      const value = contract.parameter.value
      const response = await fetch(`${wallet.network.rpcUrl.replace(/\/$/, '')}/wallet/triggerconstantcontract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          owner_address: value.owner_address,
          contract_address: value.contract_address,
          data: value.data,
          visible: false
        }),
        signal: AbortSignal.timeout(15_000)
      })
      if (!response.ok) return { attempted: true, success: false, error: `Tron simulation RPC returned ${response.status}` }
      const body = await response.json() as {
        result?: { result?: boolean; message?: string }
        energy_used?: number
        constant_result?: string[]
      }
      return {
        attempted: true,
        success: body.result?.result === true,
        ...(body.result?.result === true ? {} : { error: 'Tron contract simulation rejected the transaction' }),
        ...(body.energy_used === undefined ? {} : { logs: [`energy_used:${body.energy_used}`] })
      }
    },
    async balance(value) {
      return BigInt(await tron.trx.getBalance(value))
    },
    async broadcast(transaction) {
      return tron.trx.sendRawTransaction(transaction as unknown as Types.SignedTransaction) as never
    },
    async transactionInfo(hash) {
      try {
        return await tron.trx.getTransactionInfo(hash) as never
      } catch {
        return null
      }
    }
  }
}

export class TronWalletAdapter implements WalletChainAdapter {
  readonly family = 'tron' as const

  constructor(private readonly clientFor: (wallet: WalletDescriptor) => TronRpcClient = defaultClient) {}

  validateAddress(value: string): boolean {
    return value.startsWith('T') && TronWeb.isAddress(value)
  }

  async normalizeTransaction(wallet: WalletDescriptor, payload: unknown): Promise<WalletNormalizedTransaction> {
    if (!this.validateAddress(wallet.publicAddress)) throw new Error('Wallet account is invalid')
    const transaction = TronTransactionSchema.parse(cloneTransaction(payload))
    if (transaction.raw_data.contract.length !== 1) throw new Error('Multi-contract Tron transactions require manual review and are not supported')
    const operation = contractOperation(transaction.raw_data.contract[0]!)
    if (operation.owner !== wallet.publicAddress) throw new Error('Tron transaction signer does not match the selected wallet')
    return {
      chainFamily: this.family,
      networkId: wallet.network.id,
      signer: wallet.publicAddress,
      ...((transaction.txID ?? transaction.raw_data.ref_block_hash) ? {
        nonceOrBlockhash: transaction.txID ?? `${transaction.raw_data.ref_block_bytes ?? ''}:${transaction.raw_data.ref_block_hash}`
      } : {}),
      raw: transaction as unknown as Record<string, unknown>,
      decoded: operation.decoded
    }
  }

  async simulate(wallet: WalletDescriptor, transaction: WalletNormalizedTransaction): Promise<WalletTransactionSimulation> {
    try {
      const result = await this.clientFor(wallet).simulate(transaction.raw)
      const estimatedFee = result.estimatedFeeSun === undefined ? undefined : formatTrx(result.estimatedFeeSun)
      transaction.decoded.estimatedFee = estimatedFee
      return {
        attempted: result.attempted,
        success: result.success,
        ...(estimatedFee ? { estimatedFee } : {}),
        ...(result.error ? { error: result.error.slice(0, 512) } : {}),
        ...(result.logs ? { logs: result.logs.slice(0, 100).map((line) => line.slice(0, 1_024)) } : {})
      }
    } catch (error) {
      return { attempted: true, success: false, error: error instanceof Error ? error.message.slice(0, 512) : 'Tron simulation failed' }
    }
  }

  async sign(wallet: WalletDescriptor, secret: WalletSecret, transaction: WalletNormalizedTransaction): Promise<string> {
    const account = await deriveWalletAccount(wallet.chainFamily, secret)
    try {
      if (account.publicAddress !== wallet.publicAddress || transaction.signer !== wallet.publicAddress) {
        throw new Error('Tron transaction signer does not match the selected wallet')
      }
      const signed = utils.crypto.signTransaction(account.privateKey.toString('hex'), cloneTransaction(transaction.raw))
      return Buffer.from(JSON.stringify(signed), 'utf8').toString('base64')
    } finally {
      account.privateKey.fill(0)
      secret.material.fill(0)
    }
  }

  broadcast(wallet: WalletDescriptor, signedTransaction: string): Promise<string> {
    let transaction: Record<string, unknown>
    try {
      const bytes = Buffer.from(signedTransaction, 'base64')
      if (!bytes.length || bytes.toString('base64') !== signedTransaction) throw new Error('invalid')
      try {
        transaction = TronTransactionSchema.parse(JSON.parse(bytes.toString('utf8'))) as unknown as Record<string, unknown>
      } finally {
        bytes.fill(0)
      }
    } catch {
      throw new Error('Signed Tron transaction is invalid')
    }
    return this.clientFor(wallet).broadcast(transaction).then((result) => {
      if (!result.result) throw new Error('Tron transaction broadcast failed')
      const txid = result.txid ?? transaction.txID
      if (typeof txid !== 'string' || !txid) throw new Error('Tron broadcast did not return a transaction ID')
      return txid
    })
  }

  async confirmation(wallet: WalletDescriptor, transactionHash: string): Promise<WalletConfirmation> {
    if (!/^[a-fA-F0-9]{64}$/.test(transactionHash)) throw new Error('Tron transaction ID is invalid')
    const info = await this.clientFor(wallet).transactionInfo(transactionHash)
    if (!info?.blockNumber) return { confirmed: false, failed: false }
    const failed = info.receipt?.result === 'FAILED' || info.result === 'FAILED'
    return { confirmed: !failed, failed, blockReference: String(info.blockNumber) }
  }

  async balance(wallet: WalletDescriptor): Promise<string> {
    if (!this.validateAddress(wallet.publicAddress)) throw new Error('Wallet account is invalid')
    return formatTrx(await this.clientFor(wallet).balance(wallet.publicAddress))
  }
}
