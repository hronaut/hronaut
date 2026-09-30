import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { expect, test as base } from './fixtures.js'

const test = base.extend({
  profileDirectory: async ({ mcpPort }, use) => {
    const directory = await mkdtemp(join(tmpdir(), `hronaut-expired-license-${mcpPort}-`))
    try {
      await writeFile(join(directory, 'commercial-license.json'), JSON.stringify({
        version: 1, installationId: randomUUID(),
        trialStartedAt: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString(),
        lastSeenAt: new Date().toISOString()
      }))
      await use(directory)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
})

test('blocks automation after trial expiry while keeping license management accessible', async ({ appWindow, mcpPort, mcpToken }) => {
  await expect.poll(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok
    } catch {
      return false
    }
  }).toBe(true)
  const client = new Client({ name: 'expired-trial-test', version: '1' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const result = await client.callTool({ name: 'browser_workspaces', arguments: { action: 'list' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('active subscription after the 10-day trial')
    await expect(appWindow.getByRole('status').filter({ hasText: 'Agent automation is locked' })).toBeVisible()
    await appWindow.getByRole('button', { name: 'License settings', exact: true }).click()
    await expect(appWindow.getByText('Your trial has ended. Subscribe to continue agent automation.')).toBeVisible()
    await expect(appWindow.getByRole('button', { name: 'Buy license ↗' })).toBeEnabled()
  } finally {
    await client.close()
  }
})


const paidTest = base.extend({
  profileDirectory: async ({ mcpPort }, use) => {
    const directory = await mkdtemp(join(tmpdir(), `hronaut-paid-expiry-${mcpPort}-`))
    try {
      await writeFile(join(directory, 'commercial-license.json'), JSON.stringify({
        version: 1, installationId: randomUUID(),
        trialStartedAt: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString(),
        lastSeenAt: new Date().toISOString(),
        encryptedLicenseKey: Buffer.from('synthetic-test-ciphertext').toString('base64'),
        keySuffix: 'TEST', instanceId: 'synthetic-device', status: 'active',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        lastValidatedAt: new Date().toISOString()
      }))
      await use(directory)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
})

paidTest('refreshes a renewed paid grant through main and unlocks the same MCP session, then expires live', async ({ electronApp, appWindow, mcpPort, mcpToken }) => {
  // Only the external provider and OS decrypt operation are synthetic. The real
  // main store, refresh IPC, renderer events, clock timer and HTTP MCP gates run.
  // No live license, payment, credential backend, or production bypass is used.
  const client = new Client({ name: 'paid-renewal-test', version: '1' })
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    const call = () => client.callTool({ name: 'browser_workspaces', arguments: { action: 'list' } })
    expect((await call()).isError).toBe(true)
    const notice = appWindow.getByRole('status').filter({ hasText: 'Agent automation is locked' })
    await expect(notice).toBeVisible()
    await appWindow.getByRole('button', { name: 'License settings', exact: true }).click()
    await electronApp.evaluate(({ safeStorage }) => {
      safeStorage.decryptStringAsync = async () => ({ result: 'SYNTHETIC-TEST-KEY', shouldReEncrypt: false })
      const expiresAt = new Date(Date.now() + 10_000).toISOString()
      const originalFetch = globalThis.fetch
      globalThis.fetch = async (input, init) => {
        if (String(input) === 'https://hronaut.dev/api/creem-license/validate') {
          return new Response(JSON.stringify({ valid: true, status: 'active', productId: 'synthetic-hronaut', expiresAt }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        return originalFetch(input, init)
      }
    })
    // Headless Linux intentionally has no protected keyring; invoke the trusted
    // preload refresh with the synthetic decrypt fixture, without weakening UI
    // activation restrictions or changing production credential-storage policy.
    await appWindow.evaluate(() => window.hronautLicense.refresh())
    await expect(notice).toBeHidden()
    expect((await call()).isError).not.toBe(true)
    // No tool call or provider refresh drives this next transition.
    await expect(notice).toBeVisible({ timeout: 15_000 })
    expect((await call()).isError).toBe(true)
    await expect(appWindow.getByRole('button', { name: 'Check license', exact: true })).toBeVisible()
  } finally {
    await client.close()
  }
})
