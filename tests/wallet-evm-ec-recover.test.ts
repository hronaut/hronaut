import { describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { PERSONAL_EC_RECOVER_INVALID, recoverPersonalSigner } from '../src/main/wallet/evm-ec-recover.js'

// Anvil's first development account.
const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const utf8 = (text: string) => new TextEncoder().encode(text)

describe('personal_ecRecover', () => {
  it('recovers the account that signed a personal_sign message', async () => {
    const signature = await account.signMessage({ message: 'Example `personal_sign` message' })
    await expect(recoverPersonalSigner(utf8('Example `personal_sign` message'), signature))
      .resolves.toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
    const bytes = Uint8Array.from([0xde, 0xad, 0xbe, 0xef])
    await expect(recoverPersonalSigner(bytes, await account.signMessage({ message: { raw: bytes } })))
      .resolves.toBe(account.address)
    // Another message gives another address, as in MetaMask, rather than an error.
    await expect(recoverPersonalSigner(utf8('Another message'), signature)).resolves.not.toBe(account.address)
  })

  it('accepts a recovery byte of 0 or 1 as well as 27 or 28', async () => {
    const signature = await account.signMessage({ message: 'hello' })
    const v = Number.parseInt(signature.slice(130), 16)
    const compact = `${signature.slice(0, 130)}${(v - 27).toString(16).padStart(2, '0')}`
    await expect(recoverPersonalSigner(utf8('hello'), compact)).resolves.toBe(account.address)
  })

  it('refuses a signature that is not 65 bytes of hex with a valid recovery byte', async () => {
    const signature = await account.signMessage({ message: 'hello' })
    for (const invalid of [
      undefined, 42, '', signature.slice(0, -2), `${signature}00`, `${signature.slice(0, 130)}1d`, `${signature.slice(0, 130)}02`,
      `0x${'zz'.repeat(65)}`, signature.slice(2)
    ]) {
      await expect(recoverPersonalSigner(utf8('hello'), invalid)).rejects.toThrow(PERSONAL_EC_RECOVER_INVALID)
    }
    // An r value that is not on the curve cannot be recovered.
    await expect(recoverPersonalSigner(utf8('hello'), `0x${'f'.repeat(128)}1b`)).rejects.toThrow(PERSONAL_EC_RECOVER_INVALID)
    expect(PERSONAL_EC_RECOVER_INVALID).toMatch(/^EVM RPC error \(code -32602\): /)
  })
})
