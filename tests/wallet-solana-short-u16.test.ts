import { describe, expect, it, vi } from 'vitest'
import {
  AccountRole, address, appendTransactionMessageInstruction, blockhash, compileTransaction,
  createTransactionMessage, getBase64EncodedWireTransaction, getShortU16Decoder,
  setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  SOLANA_ERROR__CODECS__INVALID_BYTE_LENGTH, SOLANA_ERROR__CODECS__NUMBER_OUT_OF_RANGE
} from '@solana/kit'
import { SolanaWalletAdapter } from '../src/main/wallet/adapters/solana.js'
import type { WalletDescriptor } from '../src/shared/wallet.js'

const signer = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk'
const destination = 'HAgk14JpMQLgt6rVgv1BHPVxCV7zjTVBqBo5uR4J4qfJ'
const system = '11111111111111111111111111111111'
const wallet: WalletDescriptor = {
  id: 'synthetic', name: 'Synthetic', kind: 'imported', chainFamily: 'solana', publicAddress: signer,
  network: { id: 'localnet', name: 'Unused', environment: 'local', rpcUrl: 'http://127.0.0.1:8899' },
  capabilities: ['read'], workspaceIds: [], policyIds: [], recoveryConfirmed: true,
  createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z'
}

function unsignedTransfer(): Uint8Array {
  const data = new Uint8Array(12)
  data[0] = 2
  data[4] = 1 // One lamport; no keys, signing, or RPC needed to compile a message.
  const message = appendTransactionMessageInstruction({
    programAddress: address(system),
    accounts: [
      { address: address(signer), role: AccountRole.WRITABLE_SIGNER },
      { address: address(destination), role: AccountRole.WRITABLE }
    ], data
  }, setTransactionMessageLifetimeUsingBlockhash({
    blockhash: blockhash(system), lastValidBlockHeight: 100n
  }, setTransactionMessageFeePayer(address(signer), createTransactionMessage({ version: 'legacy' }))))
  return Uint8Array.from(Buffer.from(getBase64EncodedWireTransaction(compileTransaction(message)), 'base64'))
}

describe('Solana shortU16 input hardening', () => {
  it.each([
    ['truncated one-byte continuation', [0x80], SOLANA_ERROR__CODECS__INVALID_BYTE_LENGTH],
    ['truncated two-byte continuation', [0x80, 0x80], SOLANA_ERROR__CODECS__INVALID_BYTE_LENGTH],
    ['three continuation bytes', [0xff, 0xff, 0xff], SOLANA_ERROR__CODECS__INVALID_BYTE_LENGTH],
    ['four-byte encoding', [0x83, 0x80, 0x80, 0x00], SOLANA_ERROR__CODECS__INVALID_BYTE_LENGTH],
    ['out-of-range value', [0x80, 0x80, 0x04], SOLANA_ERROR__CODECS__NUMBER_OUT_OF_RANGE]
  ] as const)('rejects %s', (_name, bytes, code) => {
    expect(() => getShortU16Decoder().decode(Uint8Array.from(bytes)))
      .toThrow(expect.objectContaining({ context: expect.objectContaining({ __code: code }) }))
  })

  it.each([
    [0, [0]], [127, [0x7f]], [128, [0x80, 0x01]], [65535, [0xff, 0xff, 0x03]]
  ] as const)('preserves the valid boundary %i', (value, bytes) => {
    expect(getShortU16Decoder().read(Uint8Array.from(bytes), 0)).toEqual([value, bytes.length])
  })

  it.each(['base64', 'bytes'] as const)('rejects an overlong address count during %s normalization before RPC', async (format) => {
    const clientFor = vi.fn(() => { throw new Error('RPC factory must not be invoked') })
    const adapter = new SolanaWalletAdapter(clientFor)
    const canonical = unsignedTransfer()
    // One signature count byte, one empty 64-byte signature, then the 3-byte legacy header.
    const countOffset = 1 + 64 + 3
    expect(canonical[0]).toBe(1)
    expect(canonical.slice(1, 65).every(byte => byte === 0)).toBe(true)
    expect(canonical[countOffset]).toBe(3)
    const malformed = Uint8Array.from([
      ...canonical.slice(0, countOffset), 0x83, 0x80, 0x80, 0x00, ...canonical.slice(countOffset + 1)
    ])
    const input = (bytes: Uint8Array) => ({ transaction: format === 'base64' ? Buffer.from(bytes).toString('base64') : bytes })
    const normalized = await adapter.normalizeTransaction(wallet, input(canonical))
    expect(normalized.decoded).toMatchObject({ understood: true, method: 'system.transfer', destination, nativeAmount: '0.000000001' })
    expect(normalized.raw.transaction).toBe(Buffer.from(canonical).toString('base64'))
    try {
      await expect(adapter.normalizeTransaction(wallet, input(malformed))).rejects.toThrow('Solana transaction is malformed')
    } finally {
      expect(clientFor).not.toHaveBeenCalled()
    }
  })
})
