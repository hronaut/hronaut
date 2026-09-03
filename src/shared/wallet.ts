import { z } from 'zod'

export const WalletChainFamilySchema = z.enum(['evm', 'solana', 'tron'])
export type WalletChainFamily = z.infer<typeof WalletChainFamilySchema>

export const WalletKindSchema = z.enum(['managed', 'imported', 'watch-only', 'agent'])
export type WalletKind = z.infer<typeof WalletKindSchema>

export const WalletCapabilitySchema = z.enum(['read', 'sign', 'send'])
export type WalletCapability = z.infer<typeof WalletCapabilitySchema>

export const WalletNetworkSchema = z.object({
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(128),
  environment: z.enum(['local', 'testnet', 'mainnet']),
  rpcUrl: z.url().refine((value) => {
    try {
      const protocol = new URL(value).protocol
      return protocol === 'http:' || protocol === 'https:'
    } catch {
      return false
    }
  }, 'Wallet RPC URL must use HTTP or HTTPS')
}).strict()
export type WalletNetwork = z.infer<typeof WalletNetworkSchema>

export type WalletNetworkValidationIssue = 'evm-chain-id-invalid'

export function walletNetworkValidationIssue(
  chainFamily: WalletChainFamily,
  network: Pick<WalletNetwork, 'id'>
): WalletNetworkValidationIssue | null {
  if (chainFamily !== 'evm') return null
  if (!/^[1-9]\d*$/.test(network.id)) return 'evm-chain-id-invalid'
  return BigInt(network.id) <= BigInt(Number.MAX_SAFE_INTEGER) ? null : 'evm-chain-id-invalid'
}

export function assertWalletNetworkForChainFamily(
  chainFamily: WalletChainFamily,
  network: Pick<WalletNetwork, 'id'>
): void {
  if (walletNetworkValidationIssue(chainFamily, network) === 'evm-chain-id-invalid') {
    throw new Error('EVM chain ID must be a positive safe integer')
  }
}

const WalletIdSchema = z.string().trim().min(1).max(128)
const WorkspaceIdSchema = z.string().trim().min(1).max(128)
const IsoDateSchema = z.iso.datetime({ offset: true })

function isNormalizedHttpOrigin(value: string): boolean {
  const url = new URL(value)
  return (url.protocol === 'http:' || url.protocol === 'https:') && value === url.origin
}

export const WalletDescriptorSchema = z.object({
  id: WalletIdSchema,
  name: z.string().trim().min(1).max(128),
  kind: WalletKindSchema,
  chainFamily: WalletChainFamilySchema,
  publicAddress: z.string().trim().min(1).max(256),
  network: WalletNetworkSchema,
  capabilities: z.array(WalletCapabilitySchema).max(3),
  workspaceIds: z.array(WorkspaceIdSchema).max(256),
  availableInAllWorkspaces: z.boolean().optional(),
  policyIds: z.array(z.string().trim().min(1).max(128)).max(256),
  recoveryConfirmed: z.boolean(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema
}).strict().superRefine((descriptor, context) => {
  if (descriptor.kind === 'watch-only' && descriptor.capabilities.some((capability) => capability !== 'read')) {
    context.addIssue({
      code: 'custom',
      path: ['capabilities'],
      message: 'Watch-only wallets may only use the read capability'
    })
  }
})
export type WalletDescriptor = z.infer<typeof WalletDescriptorSchema>

export function walletAllowsWorkspace(
  wallet: Pick<WalletDescriptor, 'workspaceIds' | 'availableInAllWorkspaces'>,
  workspaceId: string
): boolean {
  return wallet.availableInAllWorkspaces === true || wallet.workspaceIds.includes(workspaceId)
}

export const WalletAgentDescriptorSchema = z.object({
  id: WalletIdSchema,
  name: z.string().trim().min(1).max(128),
  kind: WalletKindSchema,
  chainFamily: WalletChainFamilySchema,
  network: WalletNetworkSchema.omit({ rpcUrl: true }),
  capabilities: z.array(WalletCapabilitySchema).max(3),
  availableInAllWorkspaces: z.boolean().optional(),
  addressPermission: z.boolean(),
  publicAddress: z.string().trim().min(1).max(256).optional()
}).strict().superRefine((descriptor, context) => {
  if (!descriptor.addressPermission && descriptor.publicAddress !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['publicAddress'],
      message: 'Agent wallet descriptors may reveal an address only after permission is granted'
    })
  }
})
export type WalletAgentDescriptor = z.infer<typeof WalletAgentDescriptorSchema>

export const WalletRequestStatusSchema = z.enum([
  'draft',
  'validated',
  'simulated',
  'policy-decision',
  'awaiting-human',
  'approved',
  'signing',
  'submitted',
  'confirmed',
  'rejected',
  'expired',
  'cancelled',
  'failed'
])
export type WalletRequestStatus = z.infer<typeof WalletRequestStatusSchema>

export const WalletOperationSchema = z.enum([
  'read-balance',
  'connect-account',
  'simulate-transaction',
  'sign-transaction',
  'sign-and-send-transaction',
  'sign-message'
])
export type WalletOperation = z.infer<typeof WalletOperationSchema>

export const WalletRequesterSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('website'),
    id: z.string().trim().min(1).max(256),
    name: z.string().trim().min(1).max(256).optional()
  }).strict(),
  z.object({
    type: z.literal('agent'),
    id: z.string().trim().min(1).max(256),
    name: z.string().trim().min(1).max(256).optional()
  }).strict()
])
export type WalletRequester = z.infer<typeof WalletRequesterSchema>

const SECRET_FIELD = /^(?:privatekey(?:hex|bytes|material)?|secretkey(?:hex|bytes|material)?|mnemonic(?:phrase|words|entropy|material)?|seed(?:phrase|words|hex|bytes|material)?|recovery(?:phrase|words|material)?|(?:encrypted|decrypted)?vault(?:blob|key|material|contents)?|wrapp(?:ed|ing)key|keymaterial|secretmaterial|walletsecret|(?:vault)?passphrase|ciphertext|signedmessage)$/i
export const MAX_WALLET_REQUEST_NESTING = 32
export const MAX_WALLET_REQUEST_ARRAY_ITEMS = 10_000
export const MAX_WALLET_REQUEST_BINARY_BYTES = 128 * 1024
export type WalletPayloadScanResult =
  | 'safe'
  | 'secret'
  | 'too-deep'
  | 'array-too-large'
  | 'sparse-array'
  | 'shared-reference'
  | 'binary-too-large'
  | 'unsupported-type'

interface WalletPayloadScanState {
  seen: WeakSet<object>
  binaryBytes: number
  requireLosslessSerialization: boolean
}

function isWalletSecretField(key: string): boolean {
  return SECRET_FIELD.test(key.replace(/[^a-z0-9]/gi, ''))
}

function scanWalletPayloadGraph(
  value: unknown,
  depth: number,
  state: WalletPayloadScanState
): WalletPayloadScanResult {
  if (depth > MAX_WALLET_REQUEST_NESTING) return 'too-deep'
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return 'safe'
  if (typeof value === 'number') return Number.isFinite(value) || !state.requireLosslessSerialization ? 'safe' : 'unsupported-type'
  if (typeof value !== 'object') return state.requireLosslessSerialization ? 'unsupported-type' : 'safe'
  if (state.seen.has(value)) return 'shared-reference'
  state.seen.add(value)
  const binaryBytes = walletBinaryByteLength(value)
  if (binaryBytes !== null) {
    state.binaryBytes += binaryBytes
    return state.binaryBytes > MAX_WALLET_REQUEST_BINARY_BYTES ? 'binary-too-large' : 'safe'
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_WALLET_REQUEST_ARRAY_ITEMS) return 'array-too-large'
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) return 'sparse-array'
      const nested = scanWalletPayloadGraph(value[index], depth + 1, state)
      if (nested !== 'safe') return nested
    }
    for (const key of Object.keys(value)) {
      if (/^(?:0|[1-9]\d*)$/.test(key) && Number(key) < value.length) continue
      if (isWalletSecretField(key)) return 'secret'
      const nested = scanWalletPayloadGraph(Reflect.get(value, key), depth + 1, state)
      if (nested !== 'safe') return nested
    }
    return 'safe'
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return state.requireLosslessSerialization ? 'unsupported-type' : 'safe'
  }
  for (const [key, entry] of Object.entries(value)) {
    if (isWalletSecretField(key)) return 'secret'
    const nested = scanWalletPayloadGraph(entry, depth + 1, state)
    if (nested !== 'safe') return nested
  }
  return 'safe'
}

export function scanWalletPayload(
  value: unknown,
  depth = 0,
  requireLosslessSerialization = false
): WalletPayloadScanResult {
  return scanWalletPayloadGraph(value, depth, {
    seen: new WeakSet<object>(),
    binaryBytes: 0,
    requireLosslessSerialization
  })
}

function walletBinaryByteLength(value: unknown): number | null {
  if (value instanceof ArrayBuffer) return value.byteLength
  if (ArrayBuffer.isView(value)) return value.byteLength
  return null
}

function walletPayloadSerializationReplacer(this: unknown, key: string, entry: unknown): unknown {
  const owner = this as Record<string, unknown> | undefined
  const original = key === '' ? entry : owner?.[key]
  const binaryBytes = walletBinaryByteLength(original)
  if (binaryBytes === null) return entry
  return { binary: 'A'.repeat(Math.ceil(binaryBytes / 3) * 4) }
}

export const WalletOperationRequestSchema = z.object({
  requestId: z.string().trim().min(1).max(128),
  walletId: WalletIdSchema,
  workspaceId: WorkspaceIdSchema,
  tabId: z.string().trim().min(1).max(128),
  navigationGeneration: z.number().int().nonnegative(),
  topLevelOrigin: z.url().refine(isNormalizedHttpOrigin, 'Wallet request origin must be a normalized HTTP or HTTPS origin'),
  requester: WalletRequesterSchema,
  capability: WalletCapabilitySchema,
  chainFamily: WalletChainFamilySchema,
  networkId: z.string().trim().min(1).max(128),
  operation: WalletOperationSchema,
  payload: z.record(z.string(), z.unknown()),
  expiresAt: IsoDateSchema
}).strict().superRefine((request, context) => {
  const payloadScan = scanWalletPayload(request.payload, 0, true)
  if (payloadScan === 'secret') {
    context.addIssue({
      code: 'custom',
      path: ['payload'],
      message: 'Wallet operation payloads must not contain secret material'
    })
  } else if (payloadScan === 'too-deep') {
    context.addIssue({
      code: 'custom',
      path: ['payload'],
      message: 'Wallet operation payload nesting is too deep'
    })
  } else if (payloadScan === 'array-too-large') {
    context.addIssue({
      code: 'custom',
      path: ['payload'],
      message: 'Wallet operation payload array is too large'
    })
  } else if (payloadScan === 'sparse-array') {
    context.addIssue({
      code: 'custom',
      path: ['payload'],
      message: 'Wallet operation payload array must be dense'
    })
  } else if (payloadScan === 'shared-reference') {
    context.addIssue({
      code: 'custom',
      path: ['payload'],
      message: 'Wallet operation payloads must not contain shared object references'
    })
  } else if (payloadScan === 'binary-too-large') {
    context.addIssue({
      code: 'custom',
      path: ['payload'],
      message: 'Wallet operation payload binary data is too large'
    })
  } else if (payloadScan === 'unsupported-type') {
    context.addIssue({
      code: 'custom',
      path: ['payload'],
      message: 'Wallet operation payload must be serializable without changing its values'
    })
  }
})
export type WalletOperationRequest = z.infer<typeof WalletOperationRequestSchema>

export const WalletPolicyModeSchema = z.enum(['read-only', 'always-ask', 'bounded-auto', 'disabled'])
export type WalletPolicyMode = z.infer<typeof WalletPolicyModeSchema>

export const WalletPolicySchema = z.object({
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(128),
  mode: WalletPolicyModeSchema,
  walletId: WalletIdSchema,
  workspaceId: WorkspaceIdSchema,
  networkIds: z.array(z.string().trim().min(1).max(128)).max(64),
  origins: z.array(z.url().refine(
    isNormalizedHttpOrigin,
    'Wallet policy origin must be a normalized HTTP or HTTPS origin'
  )).max(256),
  destinations: z.array(z.string().trim().min(1).max(256)).max(256),
  methods: z.array(z.string().trim().min(1).max(256)).max(256),
  maxNativeAmount: z.string().regex(/^\d+(?:\.\d+)?$/).optional(),
  maxTokenAmount: z.string().regex(/^\d+(?:\.\d+)?$/).optional(),
  maxFee: z.string().regex(/^\d+(?:\.\d+)?$/).optional(),
  sessionSpendLimit: z.string().regex(/^\d+(?:\.\d+)?$/).optional(),
  dailySpendLimit: z.string().regex(/^\d+(?:\.\d+)?$/).optional(),
  expiresAt: IsoDateSchema,
  maximumOperationCount: z.number().int().positive().max(1_000_000),
  requireSuccessfulSimulation: z.literal(true),
  allowMessageSigning: z.boolean(),
  allowMainnetAgentAutomation: z.boolean().optional()
}).strict()
export type WalletPolicy = z.infer<typeof WalletPolicySchema>

export const WalletRequestSummarySchema = z.object({
  id: z.string().trim().min(1).max(128),
  walletId: WalletIdSchema,
  workspaceId: WorkspaceIdSchema,
  status: WalletRequestStatusSchema,
  approvalHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  operation: WalletOperationSchema,
  requester: WalletRequesterSchema,
  origin: z.string().max(2048),
  networkId: z.string().trim().min(1).max(128),
  createdAt: IsoDateSchema,
  expiresAt: IsoDateSchema,
  transactionHash: z.string().trim().min(1).max(256).optional(),
  sanitizedError: z.string().trim().min(1).max(512).optional(),
  details: z.object({
    walletName: z.string().trim().min(1).max(128),
    publicAddress: z.string().trim().min(1).max(256),
    chainFamily: WalletChainFamilySchema,
    networkName: z.string().trim().min(1).max(128),
    capability: WalletCapabilitySchema,
    understood: z.boolean(),
    simulationAttempted: z.boolean(),
    simulationSuccess: z.boolean(),
    destination: z.string().max(512).optional(),
    method: z.string().max(512).optional(),
    nativeAmount: z.string().max(256).optional(),
    tokenAmount: z.string().max(256).optional(),
    estimatedFee: z.string().max(256).optional(),
    raw: z.record(z.string(), z.unknown())
  }).strict().optional()
}).strict()
export type WalletRequestSummary = z.infer<typeof WalletRequestSummarySchema>

export const WalletPublicRequestPayloadSchema = z.unknown().superRefine((value, context) => {
  const payloadScan = scanWalletPayload(value, 0, true)
  if (payloadScan === 'secret') {
    context.addIssue({ code: 'custom', message: 'Wallet provider requests must not contain secret material' })
    return
  }
  if (payloadScan === 'too-deep') {
    context.addIssue({ code: 'custom', message: 'Wallet provider request nesting is too deep' })
    return
  }
  if (payloadScan === 'array-too-large') {
    context.addIssue({ code: 'custom', message: 'Wallet provider request array is too large' })
    return
  }
  if (payloadScan === 'sparse-array') {
    context.addIssue({ code: 'custom', message: 'Wallet provider request array must be dense' })
    return
  }
  if (payloadScan === 'shared-reference') {
    context.addIssue({ code: 'custom', message: 'Wallet provider requests must not contain shared object references' })
    return
  }
  if (payloadScan === 'binary-too-large') {
    context.addIssue({ code: 'custom', message: 'Wallet provider request binary data is too large' })
    return
  }
  if (payloadScan === 'unsupported-type') {
    context.addIssue({ code: 'custom', message: 'Wallet provider request must be serializable without changing its values' })
    return
  }
  try {
    const serialized = JSON.stringify(value, walletPayloadSerializationReplacer)
    if (serialized !== undefined && new TextEncoder().encode(serialized).byteLength > 1_000_000) {
      context.addIssue({ code: 'custom', message: 'Wallet provider request is too large' })
    }
  } catch {
    context.addIssue({ code: 'custom', message: 'Wallet provider request must be serializable' })
  }
})

const WalletProviderParamsSchema = WalletPublicRequestPayloadSchema

const EvmProviderMethodSchema = z.enum([
  'eth_accounts',
  'eth_requestAccounts',
  'eth_chainId',
  'wallet_switchEthereumChain',
  'eth_sendTransaction',
  'eth_signTransaction',
  'personal_sign',
  'eth_signTypedData_v4',
  'eth_sign'
])

const SolanaProviderMethodSchema = z.enum([
  'connect',
  'disconnect',
  'signTransaction',
  'signAllTransactions',
  'signAndSendTransaction',
  'signMessage'
])

const TronProviderMethodSchema = z.enum([
  'eth_accounts',
  'eth_requestAccounts',
  'wallet_switchEthereumChain',
  'tron_signTransaction',
  'tron_signAndSendTransaction',
  'tron_signMessage'
])

export const WalletProviderRequestSchema = z.discriminatedUnion('family', [
  z.object({ family: z.literal('evm'), method: EvmProviderMethodSchema, params: WalletProviderParamsSchema.optional() }).strict(),
  z.object({ family: z.literal('solana'), method: SolanaProviderMethodSchema, params: WalletProviderParamsSchema.optional() }).strict(),
  z.object({ family: z.literal('tron'), method: TronProviderMethodSchema, params: WalletProviderParamsSchema.optional() }).strict()
])
export type WalletProviderRequest = z.infer<typeof WalletProviderRequestSchema>

export const WalletProviderEventSchema = z.object({
  family: WalletChainFamilySchema,
  event: z.enum(['accountsChanged', 'chainChanged', 'connect', 'disconnect']),
  payload: z.unknown().optional()
}).strict()
export type WalletProviderEvent = z.infer<typeof WalletProviderEventSchema>

export const WalletServiceStatusSchema = z.object({
  managedWallets: z.enum(['ready', 'locked', 'passphrase-setup-required', 'disabled']),
  backend: z.string().trim().min(1).max(128),
  watchOnlyAvailable: z.boolean(),
  reason: z.string().trim().min(1).max(512).optional()
}).strict()
export type WalletServiceStatus = z.infer<typeof WalletServiceStatusSchema>

export const WalletCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(128),
  chainFamily: WalletChainFamilySchema,
  network: WalletNetworkSchema,
  workspaceIds: z.array(WorkspaceIdSchema).max(256),
  availableInAllWorkspaces: z.boolean().default(false),
  dedicatedAgent: z.boolean().default(false)
}).strict()
export type WalletCreateInput = z.input<typeof WalletCreateInputSchema>

export const WalletWatchOnlyInputSchema = WalletCreateInputSchema.omit({ dedicatedAgent: true }).extend({
  publicAddress: z.string().trim().min(1).max(256)
}).strict()
export type WalletWatchOnlyInput = z.input<typeof WalletWatchOnlyInputSchema>

export const WalletSecretFormatSchema = z.enum(['private-key', 'mnemonic'])
export type WalletSecretFormat = z.infer<typeof WalletSecretFormatSchema>

export const WalletImportDetailsSchema = z.object({
  name: z.string().trim().min(1).max(128),
  network: WalletNetworkSchema,
  workspaceIds: z.array(WorkspaceIdSchema).max(256),
  availableInAllWorkspaces: z.boolean().default(false),
  dedicatedAgent: z.boolean().default(false)
}).strict()
export type WalletImportDetails = z.input<typeof WalletImportDetailsSchema>

export const WalletUpdateInputSchema = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  workspaceIds: z.array(WorkspaceIdSchema).max(256).optional(),
  availableInAllWorkspaces: z.boolean().optional(),
  rpcUrl: WalletNetworkSchema.shape.rpcUrl.optional()
}).strict()
export type WalletUpdateInput = z.infer<typeof WalletUpdateInputSchema>
