import { z } from 'zod'
import {
  createPublicClient,
  decodeFunctionData,
  formatEther,
  getAddress,
  hexToBigInt,
  http,
  isAddress,
  keccak256,
  parseAbi,
  RpcRequestError,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type BaseError,
  toHex,
  type Address,
  type Hash,
  type Hex,
  type PublicClient
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { EVM_FILTER_RPC_METHODS, EVM_READ_RPC_METHODS, type WalletDescriptor, type WalletSimulationRevert } from '../../../shared/wallet.js'
import { deriveWalletAccount } from '../accounts.js'
import { evmRevertFromError } from '../evm-revert.js'
import type { WalletSecret } from '../vault.js'
import type {
  WalletChainAdapter,
  WalletConfirmation,
  WalletNormalizedTransaction,
  WalletTokenBalance,
  WalletTransactionSimulation
} from './types.js'
import { formatTokenUnits, tokenAllowance } from './types.js'
import { UNLIMITED_TOKEN_AMOUNT } from '../transaction-display.js'

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

// ERC-721 shares the approve and transferFrom signatures, so those can also be
// an NFT approval or transfer whose amount is a token ID.
const TOKEN_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function increaseAllowance(address spender, uint256 addedValue) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function setApprovalForAll(address operator, bool approved)'
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

function decodeOperation(to: Address | undefined, data: Hex, value: bigint, signer: Address) {
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
        contract: to,
        destination: decoded.args[0],
        method: 'erc20.transfer',
        nativeAmount: formatEther(value),
        tokenAmount: decoded.args[1].toString(),
        unlimitedAllowance: false,
        newContractOrProgram: false,
        blindMessage: false
      }
    }
    if (decoded.functionName === 'approve' || decoded.functionName === 'increaseAllowance') {
      return {
        understood: true,
        contract: to,
        destination: decoded.args[0],
        method: `erc20.${decoded.functionName}`,
        nativeAmount: formatEther(value),
        tokenAmount: decoded.args[1].toString(),
        unlimitedAllowance: decoded.args[1] >= UNLIMITED_TOKEN_AMOUNT,
        newContractOrProgram: false,
        blindMessage: false
      }
    }
    if (decoded.functionName === 'setApprovalForAll') {
      // Approving lets the operator move every NFT this wallet holds in the collection.
      return {
        understood: true,
        contract: to,
        destination: decoded.args[0],
        method: 'nft.setApprovalForAll',
        nativeAmount: formatEther(value),
        unlimitedAllowance: decoded.args[1],
        newContractOrProgram: false,
        blindMessage: false
      }
    }
    const source = decoded.args[0]
    return {
      understood: sameAddress(source, signer),
      contract: to,
      source,
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
  'getChainId' | 'prepareTransactionRequest' | 'call' | 'estimateGas' | 'getGasPrice' | 'getBalance' | 'sendRawTransaction' | 'getTransaction' | 'getTransactionCount' | 'getTransactionReceipt' | 'request' | 'readContract' | 'getBlock'
>

/** EIP-7825 caps a transaction's gas limit at 2^24; nodes refuse a larger one. */
const MAX_TRANSACTION_GAS = 16_777_216n

/** The gas limit other wallets fall back to when estimation fails: most of the latest block's. */
async function fallbackGasLimit(client: EvmClient): Promise<bigint> {
  const { gasLimit } = await client.getBlock({ blockTag: 'latest' })
  const limit = gasLimit * 19n / 20n
  return limit < MAX_TRANSACTION_GAS ? limit : MAX_TRANSACTION_GAS
}

const ERC20_READ_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
])

const MAX_READ_RPC_PARAMS = 4

const MAX_READ_RPC_RESULT_BYTES = 4_000_000
const MAX_READ_RPC_ERROR_DATA_CHARS = 258

/**
 * Why a node refused a signed transaction, matched against how common clients
 * word it and reported in Hronaut's own words, never the node's text, which
 * can name the RPC endpoint. More specific wordings come first.
 */
/**
 * The node has seen this exact transaction, for example after a hosted RPC
 * retried the send itself (Geth, Erigon, Besu, Hardhat, Anvil, Nethermind,
 * OpenEthereum and Cosmos EVM wordings).
 */
const ALREADY_KNOWN = /already ?known|\bknown transaction|already imported|existing txn with same hash|tx already exists in cache/i

const BROADCAST_REFUSALS: ReadonlyArray<readonly [RegExp, string]> = [
  [/insufficient funds|upfront cost exceeds account balance|doesn't have enough funds/i, 'the account cannot pay for gas and value'],
  [/nonce too low|nonce has already been used/i, 'nonce too low, the account already used this nonce'],
  [/nonce too high/i, 'nonce too high, an earlier nonce has not been sent'],
  [/replacement transaction underpriced|replacement fee too low/i, 'replacement transaction underpriced'],
  // Only when the node no longer holds it, for example after dropping it; see broadcast().
  [ALREADY_KNOWN, 'the node says it already has this transaction'],
  [/(?:max fee per gas|fee cap) less than block base fee/i, 'max fee per gas is below the block base fee'],
  [/max priority fee per gas higher than max fee per gas|tip higher than fee cap/i, 'priority fee is above the max fee'],
  // Geth also says "transaction underpriced" when its pool is full and the fee cannot compete.
  [/underpriced|gas price too low|gas price below minimum|fee too low/i, 'gas price is too low for the node to accept it'],
  [/intrinsic gas too low/i, 'gas limit is below the minimum for this transaction'],
  [/exceeds block gas limit|gas limit too high|gas limit reached|max transaction gas limit/i, 'gas limit is above what the network allows'],
  [/(?:tx|transaction) type not supported|unsupported transaction type/i, 'the network does not support this transaction type'],
  [/(?:invalid|wrong) chain ?id/i, 'the transaction is for another chain'],
  [/invalid sender/i, 'the node could not verify the signature']
]

/** JSON-RPC server error codes; anything else could pass for a provider code such as 4001 (user rejected). */
function serverErrorCode(code: number): number {
  return Number.isSafeInteger(code) && code >= -32099 && code <= -32000 ? code : -32000
}

function rpcRequestError(error: unknown): RpcRequestError | undefined {
  const rpc = (error as BaseError | undefined)?.walk?.((cause) => cause instanceof RpcRequestError)
  return rpc instanceof RpcRequestError ? rpc : undefined
}

function broadcastError(error: unknown): unknown {
  const rpc = rpcRequestError(error)
  if (!rpc) return error
  const refusal = BROADCAST_REFUSALS.find(([pattern]) => pattern.test(rpc.details))
  if (!refusal) return error
  return new Error(`EVM RPC error (code ${serverErrorCode(rpc.code)}): the node refused the transaction: ${refusal[1]}`)
}

/**
 * Whether the node no longer knows this transaction while the account's mined
 * transaction count is past its nonce, so another transaction took the nonce
 * and this one can never be mined. Unanswerable checks count as not replaced.
 */
async function nonceTakenByAnother(client: EvmClient, wallet: WalletDescriptor, hash: Hash, nonce: string | undefined): Promise<boolean> {
  if (nonce === undefined || !/^\d{1,16}$/.test(nonce) || !isAddress(wallet.publicAddress)) return false
  try {
    await client.getTransaction({ hash })
    return false
  } catch (error) {
    if (!(error instanceof TransactionNotFoundError)) return false
  }
  try {
    const mined = await client.getTransactionCount({ address: getAddress(wallet.publicAddress), blockTag: 'latest' })
    return BigInt(mined) > BigInt(nonce)
  } catch {
    return false
  }
}

function readRpcError(error: unknown): Error {
  const rpc = rpcRequestError(error)
  if (!rpc || !Number.isSafeInteger(rpc.code)) return new Error('EVM RPC read request failed')
  const data = typeof rpc.data === 'string' && /^0x[0-9a-fA-F]*$/.test(rpc.data) && rpc.data.length <= MAX_READ_RPC_ERROR_DATA_CHARS
    ? `, data ${rpc.data}`
    : ''
  const detail = rpc.details.replace(/[^A-Za-z0-9_ .,:'"()/-]/g, ' ').replace(/(?:https?|wss?):\/\/\S*/gi, '').trim().slice(0, 160)
  return new Error(`EVM RPC error (code ${rpc.code}${data}): ${detail || 'request failed'}`)
}

export class EvmWalletAdapter implements WalletChainAdapter {
  readonly family = 'evm' as const
  readonly tokenAllowances = true
  /** Why gas estimation reverted, for transactions prepared with the fallback gas limit. */
  private readonly estimationReverts = new WeakMap<WalletNormalizedTransaction, WalletSimulationRevert>()

  constructor(private readonly clientFor = (wallet: WalletDescriptor): EvmClient => createPublicClient({
    // A contract's CCIP-Read (EIP-3668) revert names URLs that viem would fetch
    // from the main process, outside the browser, for any page or agent.
    ccipRead: false,
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
    const requestedGas = quantity(input.gas ?? input.gasLimit)
    const request = {
      account: getAddress(wallet.publicAddress),
      ...(to ? { to } : {}),
      data,
      value,
      chainId: Number(configuredChainId),
      ...(requestedNonce === undefined ? {} : { nonce: Number(requestedNonce) }),
      ...(requestedGas === undefined ? {} : { gas: requestedGas }),
      ...(quantity(input.gasPrice) === undefined ? {} : { gasPrice: quantity(input.gasPrice) }),
      ...(quantity(input.maxFeePerGas) === undefined ? {} : { maxFeePerGas: quantity(input.maxFeePerGas) }),
      ...(quantity(input.maxPriorityFeePerGas) === undefined ? {} : { maxPriorityFeePerGas: quantity(input.maxPriorityFeePerGas) }),
      ...(requestedType === undefined ? {} : { type: requestedType })
    } as Parameters<EvmClient['prepareTransactionRequest']>[0]
    let raw: Awaited<ReturnType<EvmClient['prepareTransactionRequest']>>
    let estimationRevert: WalletSimulationRevert | undefined
    try {
      raw = await client.prepareTransactionRequest(request)
    } catch (error) {
      // A transaction the contract would revert still reaches the person, as in
      // other wallets, so they and the agent see why its simulation failed.
      estimationRevert = requestedGas === undefined ? evmRevertFromError(error) : undefined
      if (!estimationRevert) throw error
      raw = await client.prepareTransactionRequest({ ...request, gas: await fallbackGasLimit(client) })
    }
    const nonce = typeof raw.nonce === 'number' ? BigInt(raw.nonce) : raw.nonce
    const normalized: WalletNormalizedTransaction = {
      chainFamily: this.family,
      networkId: wallet.network.id,
      signer: getAddress(wallet.publicAddress),
      ...(nonce === undefined ? {} : { nonceOrBlockhash: nonce.toString() }),
      raw: raw as Record<string, unknown>,
      decoded: decodeOperation(to, data, value, getAddress(wallet.publicAddress))
    }
    if (estimationRevert) this.estimationReverts.set(normalized, estimationRevert)
    return normalized
  }

  async simulate(wallet: WalletDescriptor, transaction: WalletNormalizedTransaction): Promise<WalletTransactionSimulation> {
    // Calling again with the fallback gas limit could fail on the fee it reserves instead.
    const estimationRevert = this.estimationReverts.get(transaction)
    if (estimationRevert) return { attempted: true, success: false, error: 'EVM gas estimation reverted', revert: estimationRevert }
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
      const revert = evmRevertFromError(error)
      return {
        attempted: true,
        success: false,
        error: error instanceof Error ? error.message.slice(0, 512) : 'EVM simulation failed',
        ...(revert ? { revert } : {})
      }
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

  async broadcast(wallet: WalletDescriptor, signedTransaction: string): Promise<string> {
    if (!/^0x[0-9a-f]+$/i.test(signedTransaction)) throw new Error('Signed EVM transaction is invalid')
    const client = this.clientFor(wallet)
    try {
      return await client.sendRawTransaction({ serializedTransaction: signedTransaction as Hex })
    } catch (error) {
      // Like MetaMask, count it as sent, but only while the node still holds
      // it: Nethermind and Erigon also say so for a transaction they rejected
      // or dropped. A legacy (RLP list), EIP-2930 or EIP-1559 transaction's
      // hash is the hash of its signed bytes.
      const rpc = rpcRequestError(error)
      if (rpc && ALREADY_KNOWN.test(rpc.details) && /^0x(?:0[12]|[c-f])/i.test(signedTransaction)) {
        const hash = keccak256(signedTransaction as Hex)
        if (await client.getTransaction({ hash }).then(() => true, () => false)) return hash
      }
      throw broadcastError(error)
    }
  }

  async confirmation(wallet: WalletDescriptor, transactionHash: string, nonce?: string): Promise<WalletConfirmation> {
    const client = this.clientFor(wallet)
    let receipt
    try {
      receipt = await client.getTransactionReceipt({ hash: transactionHash as Hash })
    } catch (error) {
      if (!(error instanceof TransactionReceiptNotFoundError)) throw error
      const replaced = await nonceTakenByAnother(client, wallet, transactionHash as Hash, nonce)
      return { confirmed: false, failed: false, ...(replaced ? { replaced: true } : {}) }
    }
    return {
      confirmed: receipt.status === 'success',
      failed: receipt.status === 'reverted',
      blockReference: receipt.blockNumber.toString()
    }
  }

  async readRpc(wallet: WalletDescriptor, method: string, params: unknown): Promise<unknown> {
    if (![...EVM_READ_RPC_METHODS, ...EVM_FILTER_RPC_METHODS].includes(method as never)) throw new Error(`Unsupported EVM wallet method: ${method}`)
    if (method === 'net_version') return BigInt(wallet.network.id).toString(10)
    const values = params === undefined ? [] : params
    if (!Array.isArray(values) || values.length > MAX_READ_RPC_PARAMS) {
      throw new Error(`EVM RPC read request params must be an array of at most ${MAX_READ_RPC_PARAMS} values`)
    }
    let result: unknown
    try {
      result = await this.clientFor(wallet).request({ method, params: values } as never)
    } catch (error) {
      throw readRpcError(error)
    }
    const serialized = JSON.stringify(result ?? null)
    if (serialized.length > MAX_READ_RPC_RESULT_BYTES) throw new Error('EVM RPC read response is too large')
    return JSON.parse(serialized) as unknown
  }

  async balance(wallet: WalletDescriptor): Promise<string> {
    if (!isAddress(wallet.publicAddress)) throw new Error('Wallet account is invalid')
    return formatEther(await this.clientFor(wallet).getBalance({ address: getAddress(wallet.publicAddress) }))
  }

  async tokenBalance(wallet: WalletDescriptor, token: string, spender?: string): Promise<WalletTokenBalance> {
    if (!isAddress(wallet.publicAddress)) throw new Error('Wallet account is invalid')
    if (!isAddress(token)) throw new Error('EVM token must be an ERC-20 contract address')
    if (spender !== undefined && !isAddress(spender)) throw new Error('EVM token spender must be an address')
    const client = this.clientFor(wallet)
    const contract = getAddress(token)
    const owner = getAddress(wallet.publicAddress)
    const [raw, decimals, symbol, allowance] = await Promise.all([
      client.readContract({ address: contract, abi: ERC20_READ_ABI, functionName: 'balanceOf', args: [owner] }),
      client.readContract({ address: contract, abi: ERC20_READ_ABI, functionName: 'decimals' }),
      client.readContract({ address: contract, abi: ERC20_READ_ABI, functionName: 'symbol' }).catch(() => undefined),
      spender === undefined
        ? undefined
        : client.readContract({ address: contract, abi: ERC20_READ_ABI, functionName: 'allowance', args: [owner, getAddress(spender)] })
    ])
    const safeSymbol = typeof symbol === 'string' && /^[A-Za-z0-9 ._$+-]{1,32}$/.test(symbol) ? symbol : undefined
    return {
      token: contract,
      balance: formatTokenUnits(raw, decimals),
      rawBalance: raw.toString(),
      decimals,
      ...(safeSymbol ? { symbol: safeSymbol } : {}),
      ...(spender === undefined || allowance === undefined ? {} : { allowance: tokenAllowance(getAddress(spender), allowance, decimals) })
    }
  }

  async tokenContractDetails(wallet: WalletDescriptor, token: string): Promise<{ symbol?: string; decimals?: number }> {
    if (!isAddress(token)) throw new Error('EVM token must be an ERC-20 contract address')
    const client = this.clientFor(wallet)
    const contract = getAddress(token)
    const [decimals, symbol] = await Promise.all([
      client.readContract({ address: contract, abi: ERC20_READ_ABI, functionName: 'decimals' }).catch(() => undefined),
      client.readContract({ address: contract, abi: ERC20_READ_ABI, functionName: 'symbol' }).catch(() => undefined)
    ])
    return {
      ...(typeof symbol === 'string' && symbol.length <= 64 && !/[\p{C}]/u.test(symbol) ? { symbol } : {}),
      ...(typeof decimals === 'number' ? { decimals } : {})
    }
  }
}
