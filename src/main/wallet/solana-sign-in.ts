import { z } from 'zod'

const MAX_FIELD_LENGTH = 512
const lineField = z.string().min(1).max(MAX_FIELD_LENGTH).refine((value) => !/[\r\n]/.test(value), 'must be a single line')

/** Sign-In with Solana input fields a dApp may pass to `solana:signIn` (all optional). */
export const SolanaSignInInputSchema = z.object({
  domain: lineField.optional(),
  address: lineField.optional(),
  statement: lineField.optional(),
  uri: lineField.optional(),
  version: lineField.optional(),
  chainId: lineField.optional(),
  nonce: z.string().regex(/^[A-Za-z0-9]{8,128}$/, 'must be 8 to 128 letters or digits').optional(),
  issuedAt: lineField.optional(),
  expirationTime: lineField.optional(),
  notBefore: lineField.optional(),
  requestId: lineField.optional(),
  resources: z.array(lineField).max(32).optional()
}).strict()
export type SolanaSignInInput = z.infer<typeof SolanaSignInInputSchema>

/**
 * Builds the Sign-In with Solana message text for the page's own top-level origin.
 * The domain always comes from the requesting origin; a dApp-supplied domain must match it,
 * so one site cannot ask the wallet to sign a login for another.
 */
export function solanaSignInMessage(rawInput: unknown, topLevelOrigin: string, address: string): string {
  const parsed = SolanaSignInInputSchema.safeParse(rawInput ?? {})
  if (!parsed.success) throw new Error('Solana sign-in request is invalid')
  const input = parsed.data
  const domain = new URL(topLevelOrigin).host
  if (input.domain !== undefined && input.domain !== domain) throw new Error('Solana sign-in domain does not match the requesting website')
  if (input.address !== undefined && input.address !== address) throw new Error('Solana sign-in address does not match the selected wallet')
  let message = `${domain} wants you to sign in with your Solana account:\n${address}`
  if (input.statement) message += `\n\n${input.statement}`
  const fields: string[] = []
  if (input.uri) fields.push(`URI: ${input.uri}`)
  if (input.version) fields.push(`Version: ${input.version}`)
  if (input.chainId) fields.push(`Chain ID: ${input.chainId}`)
  if (input.nonce) fields.push(`Nonce: ${input.nonce}`)
  if (input.issuedAt) fields.push(`Issued At: ${input.issuedAt}`)
  if (input.expirationTime) fields.push(`Expiration Time: ${input.expirationTime}`)
  if (input.notBefore) fields.push(`Not Before: ${input.notBefore}`)
  if (input.requestId) fields.push(`Request ID: ${input.requestId}`)
  if (input.resources) {
    fields.push('Resources:')
    for (const resource of input.resources) fields.push(`- ${resource}`)
  }
  if (fields.length) message += `\n\n${fields.join('\n')}`
  return message
}
