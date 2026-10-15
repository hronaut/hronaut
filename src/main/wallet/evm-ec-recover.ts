import { getAddress, recoverMessageAddress, type Hex } from 'viem'

export const PERSONAL_EC_RECOVER_INVALID =
  'EVM RPC error (code -32602): personal_ecRecover needs the signed message and a 65-byte signature'

/**
 * The account that signed `message` with personal_sign (EIP-191), as
 * MetaMask's `personal_ecRecover` answers it. It accepts a recovery byte of
 * 27, 28, 0 or 1 and returns the address in the checksummed form Hronaut's
 * `eth_accounts` uses. It reads no wallet and no network.
 */
export async function recoverPersonalSigner(message: Uint8Array, signature: unknown): Promise<string> {
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error(PERSONAL_EC_RECOVER_INVALID)
  if (![0, 1, 27, 28].includes(Number.parseInt(signature.slice(130), 16))) throw new Error(PERSONAL_EC_RECOVER_INVALID)
  try {
    return getAddress(await recoverMessageAddress({ message: { raw: message }, signature: signature as Hex }))
  } catch {
    throw new Error(PERSONAL_EC_RECOVER_INVALID)
  }
}
