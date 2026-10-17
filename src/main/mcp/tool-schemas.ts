// Input schemas shared by the MCP server and its tools.
import { z } from 'zod'
import type { BrowserPostcondition } from '../../shared/post-write-postcondition.js'
import { isUuidV7 } from '../uuid-v7.js'

export const workspaceIdSchema = z.string().refine(isUuidV7, 'Workspace ID must be a UUIDv7.')
export const tabIdSchema = z.string().refine(isUuidV7, 'Tab ID must be a UUIDv7.')
export const workspaceResumeKeySchema = z.string().regex(
  /^hrw1_[A-Za-z0-9_-]{43}$/,
  'Workspace resume key is malformed.'
)

export const NETWORK_FILTER_QUERY_DESCRIPTION = 'Free text plus Chrome-style AND filters: domain (wildcards allowed), is:running, larger-than (B, K/KB, M/MB), method, response-source (network, disk-cache, prefetch-cache, service-worker, other-cache), resource-type, scheme, status-code (exact 100–599 or families 1xx–5xx), and url. Prefix a property with - to exclude matches (for example -domain:metrics.example or -url:poll). Empty operands and malformed status-code, response-source, larger-than, or is values match nothing. Response source uses only observed top-level metadata; missing sources match no positive source but are included by valid exclusions. Quote a phrase that contains spaces.'

export const consequentialReviewStepSchema = z.object({
  toolName: z.string().regex(/^(?:browser|wallet)_[a-z0-9_]{1,80}$/),
  arguments: z.record(z.string(), z.unknown()),
  reversibility: z.enum(['reversible', 'conditionally-reversible', 'irreversible', 'unknown']),
  representation: z.enum(['bounded-description', 'visible-browser-only']),
  description: z.string().trim().min(1).max(512).optional(),
  expectedPostcondition: z.string().trim().min(1).max(512).optional()
}).strict().refine(review => review.representation === 'visible-browser-only' || review.description !== undefined, {
  message: 'A bounded review description is required'
})
export const consequentialReviewSchema = z.union([
  consequentialReviewStepSchema,
  z.object({ steps: z.array(consequentialReviewStepSchema).min(2).max(4) }).strict()
])
export type ConsequentialReviewStepRequest = z.infer<typeof consequentialReviewStepSchema>
export const reconciliationConditionSchema = z.object({
  mode: z.enum(['create', 'update', 'upsert']),
  expectedOrigin: z.string().max(2048).describe('Exact HTTP(S) origin for the authoritative visible record.'),
  accountSelector: z.string().trim().min(1).max(256).describe('Unique selector whose bounded text identifies the expected account.'),
  expectedAccount: z.string().trim().min(1).max(512).describe('Exact account marker. Used transiently and excluded from receipts.'),
  stateSelector: z.string().trim().min(1).max(256).describe('Unique selector for the target record state.'),
  expectedText: z.string().max(512).describe('Exact desired target text. Used transiently and excluded from receipts.'),
  expectedCurrentText: z.string().max(512).optional().describe('Exact pre-write target text. Required for update and rechecked at dispatch.')
}).strict().superRefine((value, context) => {
  if (value.mode === 'update' && value.expectedCurrentText === undefined) {
    context.addIssue({ code: 'custom', path: ['expectedCurrentText'], message: 'Update reconciliation requires expectedCurrentText' })
  }
})
export type ReconciliationConditionRequest = z.infer<typeof reconciliationConditionSchema>
export const reconciliationRequestSchema = reconciliationConditionSchema.safeExtend({
  logicalItemKey: z.string().min(1).max(512),
  targetIdentity: z.string().min(1).max(512),
  sourceRevision: z.string().min(1).max(512)
})

export type PostWriteRequest = BrowserPostcondition & { timeoutMs: number; maxAttempts: number; initialDelayMs: number }

export const walletIdSchema = z.string().trim().min(1).max(128)
export const walletRequestIdSchema = z.string().trim().min(1).max(128)
export const walletSessionIdSchema = z.uuid()
