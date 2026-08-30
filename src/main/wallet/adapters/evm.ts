import { z } from 'zod'
import {
  createPublicClient,
  decodeFunctionData,
  formatEther,
  getAddress,
  hexToBigInt,
  http,
  isAddress,
  maxUint256,
  parseAbi,
  TransactionReceiptNotFoundError,
  toHex,
  type Address,
  type Hash,
  type Hex,
  type PublicClient
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { WalletDescriptor } from '../../../shared/wallet.js'
import { deriveWalletAccount } from '../accounts.js'
import type { WalletSecret } from '../vault.js'
import type {
  WalletChainAdapter,
  WalletConfirmation,
  WalletNormalizedTransaction,
  WalletTransactionSimulation
} from './types.js'

const HexSchema = z.string().regex(/^0x(?:[a-fA-F0-9]{2})*$/).max(2_000_002)
const QuantitySchema = z.union([
  z.string().regex(/^0x[0-9a-fA-F]+$/),
  z.string().regex(/^\d+$/),
  z.number().int().nonnegative().safe(),
  z.bigint().nonnegative()
])
const EvmTransactionSchema = z.object({
  from: z.string().optional(),
  to: z.string().nullable().optional(),
  data: HexSchema.optional(),
  input: HexSchema.optional(),
  value: QuantitySchema.optional(),
  nonce: QuantitySchema.optional(),
  gas: QuantitySchema.optional(),
  gasLimit: QuantitySchema.optional(),
  gasPrice: QuantitySchema.optional(),
  maxFeePerGas: QuantitySchema.optional(),
  maxPriorityFeePerGas: QuantitySchema.optional(),
  chainId: QuantitySchema.optional(),
  type: QuantitySchema.optional()
}).strict().superRefine((value, context) => {
  if (value.data !== undefined && value.input !== undefined && value.data.toLowerCase() !== value.input.toLowerCase()) {
    context.addIssue({ code: 'custom', path: ['data'], message: 'Conflicting EVM transaction data fields' })
  }
})

const TOKEN_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)'
])

function quantity(value: z.infer<typeof QuantitySchema> | undefined): bigint | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(value)
  return value.startsWith('0x') ? hexToBigInt(value as Hex) : BigInt(value)
}

function transactionType(value: z.infer<typeof QuantitySchema> | undefined): 'legacy' | 'eip2930' | 'eip1559' | undefined {
  const parsed = quantity(value)
  if (parsed === undefined) return undefined
  if (parsed === 0n) return 'legacy'
  if (parsed === 1n) return 'eip2930'
  if (parsed === 2n) return 'eip1559'
  throw new Error('EVM transaction type is unsupported')
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

function decodeOperation(to: Address | undefined, data: Hex, value: bigint) {
  if (!to) {
    return {
      understood: false,
      method: 'contract-deployment',
      nativeAmount: formatEther(value),
      unlimitedAllowance: false,
      newContractOrProgram: true,
      blindMessage: false
    }
  }
  if (data === '0x') {
    return {
      understood: true,
      destination: to,
      method: 'native-transfer',
      nativeAmount: formatEther(value),
      unlimitedAllowance: false,
      newContractOrProgram: false,
      blindMessage: false
    }
  }
  try {
    const decoded = decodeFunctionData({ abi: TOKEN_ABI, data })
    if (decoded.functionName === 'transfer') {
      return {
        understood: true,
        destination: decoded.args[0],
        method: 'erc20.transfer',
        nativeAmount: formatEther(value),
        tokenAmount: decoded.args[1].toString(),
        unlimitedAllowance: false,
        newContractOrProgram: false,
        blindMessage: false
      }
    }
    if (decoded.functionName === 'approve') {
      return {
        understood: true,
        destination: decoded.args[0],
        method: 'erc20.approve',
        nativeAmount: formatEther(value),
        tokenAmount: decoded.args[1].toString(),
        unlimitedAllowance: decoded.args[1] === maxUint256,
        newContractOrProgram: false,
        blindMessage: false
      }
    }
    return {
      understood: true,
      destination: decoded.args[1],
      method: 'erc20.transferFrom',
      nativeAmount: formatEther(value),
      tokenAmount: decoded.args[2].toString(),
      unlimitedAllowance: false,
      newContractOrProgram: false,
      blindMessage: false
    }
  } catch {
    return {
      understood: false,
      destination: to,
      method: `contract-call:${data.slice(0, 10)}`,
      nativeAmount: formatEther(value),
      unlimitedAllowance: false,
      newContractOrProgram: true,
      blindMessage: false
    }
  }
}

type EvmClient = Pick<PublicClient,
  'getChainId' | 'prepareTransactionRequest' | 'call' | 'estimateGas' | 'getGasPrice' | 'getBalance' | 'sendRawTransaction' | 'getTransactionReceipt'
>

export class EvmWalletAdapter implements WalletChainAdapter {
  readonly family = 'evm' as const

  constructor(private readonly clientFor = (wallet: WalletDescriptor): EvmClient => createPublicClient({
    transport: http(wallet.network.rpcUrl, { retryCount: 0, timeout: 15_000 })
  })) {}

  validateAddress(value: string): boolean {
    return isAddress(value)
  }

  async normalizeTransaction(wallet: WalletDescriptor, payload: unknown): Promise<WalletNormalizedTransaction> {
    const input = EvmTransactionSchema.parse(payload)
    if (!isAddress(wallet.publicAddress)) throw new Error('Wallet account is invalid')
    if (input.from && (!isAddress(input.from) || !sameAddress(input.from, wallet.publicAddress))) {
      throw new Error('EVM transaction signer does not match the selected wallet')
    }
    const requestedNonce = quantity(input.nonce)
    if (requestedNonce !== undefined && requestedNonce > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('EVM transaction nonce must be a safe integer')
    }
    const configuredChainId = BigInt(wallet.network.id)
    if (configuredChainId < 0n) throw new Error('EVM chain ID must be non-negative')
    if (configuredChainId > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('EVM chain ID must be a safe integer')
    }
    const client = this.clientFor(wallet)
    const clientChainId = await client.getChainId()
    if (BigInt(clientChainId) !== configuredChainId) throw new Error('EVM RPC chain does not match the wallet network')
    const requestedChainId = quantity(input.chainId)
    if (requestedChainId !== undefined && requestedChainId !== configuredChainId) throw new Error('EVM transaction chain does not match the wallet network')
    const to = input.to == null ? undefined : getAddress(input.to)
    const data = (input.data ?? input.input ?? '0x') as Hex
    const value = quantity(input.value) ?? 0n
    const requestedType = transactionType(input.type)
    const raw = await client.prepareTransactionRequest({
      account: getAddress(wallet.publicAddress),
      ...(to ? { to } : {}),
      data,
      value,
      chainId: Number(configuredChainId),
      ...(requestedNonce === undefined ? {} : { nonce: Number(requestedNonce) }),
      ...(quantity(input.gas ?? input.gasLimit) === undefined ? {} : { gas: quantity(input.gas ?? input.gasLimit) }),
      ...(quantity(input.gasPrice) === undefined ? {} : { gasPrice: quantity(input.gasPrice) }),
      ...(quantity(input.maxFeePerGas) === undefined ? {} : { maxFeePerGas: quantity(input.maxFeePerGas) }),
      ...(quantity(input.maxPriorityFeePerGas) === undefined ? {} : { maxPriorityFeePerGas: quantity(input.maxPriorityFeePerGas) }),
      ...(requestedType === undefined ? {} : { type: requestedType })
    } as Parameters<EvmClient['prepareTransactionRequest']>[0])
    const nonce = typeof raw.nonce === 'number' ? BigInt(raw.nonce) : raw.nonce
    return {
      chainFamily: this.family,
      networkId: wallet.network.id,
      signer: getAddress(wallet.publicAddress),
      ...(nonce === undefined ? {} : { nonceOrBlockhash: nonce.toString() }),
      raw: raw as Record<string, unknown>,
      decoded: decodeOperation(to, data, value)
    }
  }

  async simulate(wallet: WalletDescriptor, transaction: WalletNormalizedTransaction): Promise<WalletTransactionSimulation> {
    try {
      const client = this.clientFor(wallet)
      const request = transaction.raw as Parameters<EvmClient['call']>[0]
      await client.call(request)
      const gas = await client.estimateGas(request as Parameters<EvmClient['estimateGas']>[0])
      const gasPrice = 'maxFeePerGas' in transaction.raw
        ? transaction.raw.maxFeePerGas as bigint
        : await client.getGasPrice()
      const estimatedFee = formatEther(gas * gasPrice)
      transaction.decoded.estimatedFee = estimatedFee
      return { attempted: true, success: true, estimatedFee }
    } catch (error) {
      return { attempted: true, success: false, error: error instanceof Error ? error.message.slice(0, 512) : 'EVM simulation failed' }
    }
  }

  async sign(wallet: WalletDescriptor, secret: WalletSecret, transaction: WalletNormalizedTransaction): Promise<string> {
    const account = await deriveWalletAccount(wallet.chainFamily, secret)
    try {
      if (!sameAddress(account.publicAddress, wallet.publicAddress) || !sameAddress(transaction.signer, wallet.publicAddress)) {
        throw new Error('EVM transaction signer does not match the selected wallet')
      }
      const signer = privateKeyToAccount(toHex(account.privateKey))
      return signer.signTransaction(transaction.raw as Parameters<typeof signer.signTransaction>[0])
    } finally {
      account.privateKey.fill(0)
      secret.material.fill(0)
    }
  }

  broadcast(wallet: WalletDescriptor, signedTransaction: string): Promise<string> {
    if (!/^0x[0-9a-f]+$/i.test(signedTransaction)) throw new Error('Signed EVM transaction is invalid')
    return this.clientFor(wallet).sendRawTransaction({ serializedTransaction: signedTransaction as Hex })
  }

  async confirmation(wallet: WalletDescriptor, transactionHash: string): Promise<WalletConfirmation> {
    let receipt
    try {
      receipt = await this.clientFor(wallet).getTransactionReceipt({ hash: transactionHash as Hash })
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return { confirmed: false, failed: false }
      throw error
    }
    return {
      confirmed: receipt.status === 'success',
      failed: receipt.status === 'reverted',
      blockReference: receipt.blockNumber.toString()
    }
  }

  async balance(wallet: WalletDescriptor): Promise<string> {
    if (!isAddress(wallet.publicAddress)) throw new Error('Wallet account is invalid')
    return formatEther(await this.clientFor(wallet).getBalance({ address: getAddress(wallet.publicAddress) }))
  }
}
