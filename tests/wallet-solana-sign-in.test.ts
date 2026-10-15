import { describe, expect, it } from 'vitest'
import { solanaSignInMessage } from '../src/main/wallet/solana-sign-in.js'

const address = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk'

describe('solanaSignInMessage', () => {
  it('builds the Sign-In with Solana text for the requesting origin', () => {
    expect(solanaSignInMessage({
      statement: 'Sign in to the dApp',
      uri: 'https://dapp.example/login',
      version: '1',
      chainId: 'devnet',
      nonce: 'abc12345',
      issuedAt: '2026-10-15T03:00:00.000Z',
      resources: ['https://dapp.example/terms']
    }, 'https://dapp.example', address)).toBe([
      'dapp.example wants you to sign in with your Solana account:',
      address,
      '',
      'Sign in to the dApp',
      '',
      'URI: https://dapp.example/login',
      'Version: 1',
      'Chain ID: devnet',
      'Nonce: abc12345',
      'Issued At: 2026-10-15T03:00:00.000Z',
      'Resources:',
      '- https://dapp.example/terms'
    ].join('\n'))
    expect(solanaSignInMessage(undefined, 'http://127.0.0.1:4173', address))
      .toBe(`127.0.0.1:4173 wants you to sign in with your Solana account:\n${address}`)
  })

  it('refuses another site\'s domain, another address, injected lines and unknown fields', () => {
    expect(() => solanaSignInMessage({ domain: 'bank.example' }, 'https://dapp.example', address))
      .toThrow('domain does not match the requesting website')
    expect(() => solanaSignInMessage({ address: 'HAgk14JpMQLgt6rVgv1BHPVxCV7zjTVBqBo5uR4J4qfJ' }, 'https://dapp.example', address))
      .toThrow('address does not match the selected wallet')
    expect(() => solanaSignInMessage({ statement: 'ok\nURI: https://bank.example' }, 'https://dapp.example', address))
      .toThrow('Solana sign-in request is invalid')
    expect(() => solanaSignInMessage({ nonce: 'short' }, 'https://dapp.example', address))
      .toThrow('Solana sign-in request is invalid')
    expect(() => solanaSignInMessage({ extra: 'x' }, 'https://dapp.example', address))
      .toThrow('Solana sign-in request is invalid')
  })
})
