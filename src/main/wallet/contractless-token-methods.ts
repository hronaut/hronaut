import { isWalletTokenMethod, type WalletPolicy } from '../../shared/wallet.js'

export type ContractlessTokenMethodsCleanup =
  | { action: 'keep' }
  | { action: 'update'; policy: WalletPolicy }
  | { action: 'remove' }

/**
 * What becomes of a saved automatic policy that lists a token method without a token contract or Allow any token
 * contract. Hronaut 2.45.0 and earlier saved such policies; since 2.46.0 a token call matches only a listed contract,
 * so those methods never approve anything. They are dropped, and the policy with them when nothing else in it can
 * approve: no other method is left, and it does not let a website sign in, which does not use the methods. A sign-in
 * policy left with no method also loses its transaction target and Bypass Approve, as a sign-in only policy has none.
 */
export function withoutContractlessTokenMethods(policy: WalletPolicy): ContractlessTokenMethodsCleanup {
  if (policy.mode !== 'bounded-auto' || policy.contracts?.length || policy.allowAnyTokenContract === true) return { action: 'keep' }
  const methods = policy.methods.filter((method) => !isWalletTokenMethod(method))
  if (methods.length === policy.methods.length) return { action: 'keep' }
  if (methods.length) return { action: 'update', policy: { ...policy, methods } }
  if (policy.allowWebsiteSignIn !== true) return { action: 'remove' }
  const signInOnly: WalletPolicy = { ...policy, methods, destinations: [] }
  delete signInOnly.allowMainnetAgentAutomation
  return { action: 'update', policy: signInOnly }
}
