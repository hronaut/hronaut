import { createPublicKey, verify } from 'node:crypto'
import { expect, test } from './capability-fixtures.js'

test('signs in to a dApp with Sign-In with Solana after the person approves the exact message', async ({ capabilities, appWindow, electronApp }) => {
  const { workspace, fixtureUrl, fixtureOrigin } = capabilities
  const vaultStatus = await appWindow.evaluate('window.hronautWallets.status()') as { managedWallets: string }
  if (vaultStatus.managedWallets === 'passphrase-setup-required') {
    await appWindow.evaluate(`window.hronautWallets.setupPassphrase('solana sign in integration passphrase')`)
  }
  const prepared = await appWindow.evaluate(`window.hronautWallets.prepareImport(
    'solana',
    'mnemonic',
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  )`) as { token: string; publicAddress: string }
  await appWindow.evaluate(`window.hronautWallets.confirmImport(${JSON.stringify(prepared.token)}, {
    name: 'Solana sign-in account',
    network: { id: 'devnet', name: 'Solana Devnet', environment: 'testnet', rpcUrl: 'http://127.0.0.1:8899' },
    workspaceIds: [${JSON.stringify(workspace.workspaceId)}],
    dedicatedAgent: false
  })`)

  const pageState = () => electronApp.evaluate(({ webContents }, pageUrl) => (
    webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)?.executeJavaScript('window.__solanaSignIn')
  ), fixtureUrl) as Promise<Record<string, unknown>>

  await electronApp.evaluate(async ({ webContents }, pageUrl) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)
    if (!page) throw new Error('Solana sign-in fixture WebContents was not found')
    await page.executeJavaScript(`
      window.__solanaSignIn = { phase: 'waiting-wallet' };
      window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: { register: async (wallet) => {
        if (wallet.name !== 'Hronaut' || window.__solanaSignIn.phase !== 'waiting-wallet') return;
        window.__solanaSignIn.phase = 'signing-in';
        try {
          const [output] = await wallet.features['solana:signIn'].signIn({ statement: 'Sign in to the QA fixture', nonce: 'qa12345678' });
          window.__solanaSignIn = {
            phase: 'signed-in',
            address: output.account.address,
            publicKey: Array.from(output.account.publicKey),
            message: new TextDecoder().decode(output.signedMessage),
            signature: Array.from(output.signature),
            signatureType: output.signatureType
          };
        } catch (error) {
          window.__solanaSignIn = { phase: 'failed', message: String(error?.message) };
        }
      } } }));
    `)
  }, fixtureUrl)

  const connect = appWindow.getByRole('alertdialog', { name: /Connect account/i })
  await expect(connect).toBeVisible()
  await connect.getByRole('button', { name: 'Approve exact request' }).click()
  const host = new URL(fixtureOrigin).host
  const expectedMessage = `${host} wants you to sign in with your Solana account:\n${prepared.publicAddress}\n\nSign in to the QA fixture\n\nNonce: qa12345678`
  const signing = appWindow.getByRole('alertdialog').filter({ hasText: 'wants you to sign in with your Solana account' })
  await expect(signing).toBeVisible()
  await signing.getByRole('button', { name: 'Approve exact request' }).click()

  await expect.poll(async () => (await pageState()).phase).toBe('signed-in')
  const result = await pageState() as { address: string; publicKey: number[]; message: string; signature: number[]; signatureType: string }
  expect(result).toMatchObject({ address: prepared.publicAddress, message: expectedMessage, signatureType: 'ed25519' })
  const publicKey = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(result.publicKey).toString('base64url') },
    format: 'jwk'
  })
  expect(verify(null, Buffer.from(expectedMessage), publicKey, Buffer.from(result.signature))).toBe(true)
})
