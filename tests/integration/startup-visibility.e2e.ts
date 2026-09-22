import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect, launchHronaut, closeHronaut } from './fixtures.js'

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
