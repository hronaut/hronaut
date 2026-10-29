import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect, launchHronaut, closeHronaut } from './fixtures.js'
import type { CredentialStorageStatus } from '../../src/shared/types.js'

test('shows a minimized startup when the system tray cannot be created', async ({
  profileDirectory,
  mcpPort
}) => {
  await writeFile(join(profileDirectory, 'settings.json'), `${JSON.stringify({
    launchAtStartup: true,
    launchMinimized: true
  }, null, 2)}\n`, 'utf8')
  process.env.HRONAUT_INTEGRATION_TEST_HOOKS = '1'
  process.env.HRONAUT_TEST_TRAY_CREATION_FAILURE = '1'
  let instance: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    instance = await launchHronaut(profileDirectory, mcpPort, 1, ['--launch-at-login'])
    const launched = instance
    await expect.poll(() => launched.app.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows()[0]?.isVisible() ?? false
    ))).toBe(true)
  } finally {
    delete process.env.HRONAUT_TEST_TRAY_CREATION_FAILURE
    delete process.env.HRONAUT_INTEGRATION_TEST_HOOKS
    if (instance) await closeHronaut(instance.app)
  }
})

test('opens the window and the agents\' listener while secure storage waits to be unlocked', async ({
  profileDirectory,
  mcpPort
}) => {
  // As a keyring that stayed locked at sign-in does: it answers only once the person unlocks it, however long that takes.
  process.env.HRONAUT_INTEGRATION_TEST_HOOKS = '1'
  process.env.HRONAUT_TEST_HOLD_SECURE_STORAGE = '1'
  let instance: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    instance = await launchHronaut(profileDirectory, mcpPort)
    const { app, window } = instance
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows()[0]?.isVisible() ?? false
    ))).toBe(true)
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false }
    }).toBe(true)
    expect(await window.evaluate('window.hronautCredentials.status()')).toEqual({
      available: false,
      reason: 'Secure storage is initializing.'
    })

    // The shell hears secure storage's answer once the person unlocks it.
    await window.evaluate(`(() => {
      window.__storageAnswers = []
      window.hronautCredentials.onStatusChanged((status) => { window.__storageAnswers.push(status) })
    })()`)
    await app.evaluate(() => {
      (globalThis as typeof globalThis & { __hronautReleaseSecureStorageForTest?: () => void }).__hronautReleaseSecureStorageForTest?.()
    })
    await expect.poll(() => window.evaluate('window.__storageAnswers.length')).toBe(1)
    const answered = await window.evaluate('window.hronautCredentials.status()') as CredentialStorageStatus
    expect(answered.reason).not.toBe('Secure storage is initializing.')
  } finally {
    delete process.env.HRONAUT_TEST_HOLD_SECURE_STORAGE
    delete process.env.HRONAUT_INTEGRATION_TEST_HOOKS
    if (instance) await closeHronaut(instance.app)
  }
})
