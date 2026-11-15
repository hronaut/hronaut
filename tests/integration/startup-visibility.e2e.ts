import { readFile, writeFile } from 'node:fs/promises'
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

// Electron shows a hidden window to maximize it, so a window saved maximized opened on screen at login instead of in
// the tray. Once it stays there, it must still be saved maximized and open maximized when the person shows it.
test('keeps a window saved maximized in the tray when it starts minimized, and opens it maximized when shown', async ({
  profileDirectory,
  mcpPort
}) => {
  await writeFile(join(profileDirectory, 'settings.json'), `${JSON.stringify({
    launchAtStartup: true,
    launchMinimized: true
  }, null, 2)}\n`, 'utf8')
  const windowState = join(profileDirectory, 'window-state.json')
  // No display has this id, so a saved file that still has it was never saved again.
  await writeFile(windowState, `${JSON.stringify({
    bounds: { x: 40, y: 40, width: 1200, height: 800 }, displayId: 424242, maximized: true, fullScreen: false
  })}\n`, 'utf8')
  // Xvfb runs no window manager, so a window never reports maximized there; the window counts the maximize asked of it.
  const mainWindowState = (app: Awaited<ReturnType<typeof launchHronaut>>['app']) => app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return { visible: window?.isVisible(), maximizeCalls: (globalThis as { __maximizeCalls?: number }).__maximizeCalls ?? 0 }
  })
  // The agents' listener starts once startup has shown the window as saved, or left it in the tray. With token
  // authentication on, as for a new profile, it answers 401 then, which still says it is listening.
  const startupDone = () => expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).status > 0 } catch { return false }
  }).toBe(true)
  let instance: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    instance = await launchHronaut(profileDirectory, mcpPort, 1, ['--launch-at-login'])
    await startupDone()
    expect(await mainWindowState(instance.app)).toMatchObject({ visible: false })
  } finally {
    if (instance) await closeHronaut(instance.app)
  }
  const savedWhileHidden = JSON.parse(await readFile(windowState, 'utf8')) as { displayId: number }
  expect(savedWhileHidden).toMatchObject({ maximized: true, fullScreen: false })
  expect(savedWhileHidden.displayId).not.toBe(424242)

  instance = undefined
  try {
    instance = await launchHronaut(profileDirectory, mcpPort, 1, ['--launch-at-login'])
    await startupDone()
    await instance.app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      const maximize = window.maximize.bind(window)
      const scope = globalThis as { __maximizeCalls?: number }
      scope.__maximizeCalls = 0
      window.maximize = () => {
        scope.__maximizeCalls! += 1
        maximize()
      }
    })
    expect(await mainWindowState(instance.app)).toMatchObject({ visible: false })
    await instance.window.evaluate('window.hronaut.show()')
    await expect.poll(() => mainWindowState(instance!.app)).toEqual({ visible: true, maximizeCalls: 1 })
  } finally {
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

test('keeps the shell\'s controls working after the wall clock steps back', async ({
  profileDirectory,
  mcpPort
}) => {
  let instance: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    instance = await launchHronaut(profileDirectory, mcpPort, 1, ['--launch-at-login'])
    const { window } = instance
    const settings = window.getByRole('button', { name: 'Settings' })
    await expect(settings).toBeVisible()
    // As a Linux clock kept in local time is corrected soon after login: the wall clock steps an hour back after the
    // shell attached its listeners.
    await window.evaluate(`(() => {
      const wallClock = Date.now.bind(Date)
      Date.now = () => wallClock() - 3_600_000
    })()`)
    await settings.click()
    await expect(window.getByRole('tabpanel', { name: 'Settings' })).toBeVisible()
  } finally {
    if (instance) await closeHronaut(instance.app)
  }
})
