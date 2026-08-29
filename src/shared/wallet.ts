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
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  }, 'Wallet RPC URL must use HTTP or HTTPS')
}).strict()
export type WalletNetwork = z.infer<typeof WalletNetworkSchema>

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

const SECRET_FIELD = /^(?:private.?key|mnemonic|seed(?:phrase)?|recovery.?phrase|vault(?:blob)?|wrapping.?key|decrypted(?:vault)?|ciphertext)$/i

function containsSecretField(value: unknown, depth = 0): boolean {
  if (depth > 24 || !value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some((entry) => containsSecretField(entry, depth + 1))
  return Object.entries(value).some(([key, entry]) => SECRET_FIELD.test(key) || containsSecretField(entry, depth + 1))
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
  if (containsSecretField(request.payload)) {
    context.addIssue({
      code: 'custom',
      path: ['payload'],
      message: 'Wallet operation payloads must not contain secret material'
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
  allowMessageSigning: z.boolean()
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
  if (containsSecretField(value)) {
    context.addIssue({ code: 'custom', message: 'Wallet provider requests must not contain secret material' })
    return
  }
  try {
    const serialized = JSON.stringify(value)
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
  watchOnlyAvailable: z.literal(true),
  reason: z.string().trim().min(1).max(512).optional()
}).strict()
export type WalletServiceStatus = z.infer<typeof WalletServiceStatusSchema>

export const WalletCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(128),
  chainFamily: WalletChainFamilySchema,
  network: WalletNetworkSchema,
  workspaceIds: z.array(WorkspaceIdSchema).max(256),
  dedicatedAgent: z.boolean().default(false)
}).strict()
export type WalletCreateInput = z.input<typeof WalletCreateInputSchema>

export const WalletWatchOnlyInputSchema = WalletCreateInputSchema.omit({ dedicatedAgent: true }).extend({
  publicAddress: z.string().trim().min(1).max(256)
}).strict()
export type WalletWatchOnlyInput = z.infer<typeof WalletWatchOnlyInputSchema>

export const WalletSecretFormatSchema = z.enum(['private-key', 'mnemonic'])
export type WalletSecretFormat = z.infer<typeof WalletSecretFormatSchema>

export const WalletImportDetailsSchema = z.object({
  name: z.string().trim().min(1).max(128),
  network: WalletNetworkSchema,
  workspaceIds: z.array(WorkspaceIdSchema).max(256),
  dedicatedAgent: z.boolean().default(false)
}).strict()
export type WalletImportDetails = z.input<typeof WalletImportDetailsSchema>

export const WalletUpdateInputSchema = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  workspaceIds: z.array(WorkspaceIdSchema).max(256).optional()
}).strict()
export type WalletUpdateInput = z.infer<typeof WalletUpdateInputSchema>
