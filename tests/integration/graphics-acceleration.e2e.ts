import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

// Hronaut always drew with the graphics card. As in Chrome's Use graphics acceleration when available, Settings →
// Performance turns it off or on, Settings asks for a restart while this run still uses the other choice, and the
// next start applies it before Electron is ready. A computer without a usable graphics card, such as the test container,
// draws without it once the first window opens either way, so there only this run's own record of the choice, read
// before Electron was ready, tells the two apart; on one with a graphics card, Chromium also reports it off.

async function openGraphicsSettings(window: Page) {
  await window.getByRole('button', { name: 'Settings' }).click()
  await window.getByRole('button', { name: /Performance/ }).click()
  const graphics = window.getByRole('tabpanel', { name: 'Settings' }).getByRole('region', { name: 'Graphics' })
  return {
    use: graphics.getByRole('checkbox', { name: /Use graphics acceleration when available/ }),
    restart: graphics.getByRole('status')
  }
}

const accelerated = (app: ElectronApplication) => app.evaluate(({ app }) => app.isHardwareAccelerationEnabled())
const inUse = (window: Page) => window.evaluate('window.hronautSettings.graphicsAccelerationInUse()')

test('turns graphics acceleration off and on again from the next start', async ({ profileDirectory, mcpPort }) => {
  const settingsPath = join(profileDirectory, 'settings.json')
  const saved = async () => (JSON.parse(await readFile(settingsPath, 'utf8')) as { graphicsAcceleration?: boolean }).graphicsAcceleration
  let instance: Awaited<ReturnType<typeof launchHronaut>> | undefined = await launchHronaut(profileDirectory, mcpPort)
  try {
    expect(await inUse(instance.window)).toBe(true)
    let settings = await openGraphicsSettings(instance.window)
    await expect(settings.use).toBeChecked()
    await expect(settings.restart).toHaveCount(0)
    await settings.use.click()
    await expect(settings.use).not.toBeChecked()
    await expect(settings.restart).toHaveText('Restart Hronaut to apply this change.')
    await expect.poll(saved).toBe(false)
    expect(await inUse(instance.window)).toBe(true)

    await closeHronaut(instance.app)
    instance = undefined
    instance = await launchHronaut(profileDirectory, mcpPort)
    expect(await inUse(instance.window)).toBe(false)
    expect(await accelerated(instance.app)).toBe(false)
    settings = await openGraphicsSettings(instance.window)
    await expect(settings.use).not.toBeChecked()
    await expect(settings.restart).toHaveCount(0)
    await settings.use.click()
    await expect(settings.restart).toHaveText('Restart Hronaut to apply this change.')
    await expect.poll(saved).toBe(true)

    await closeHronaut(instance.app)
    instance = undefined
    instance = await launchHronaut(profileDirectory, mcpPort)
    expect(await inUse(instance.window)).toBe(true)
    await expect((await openGraphicsSettings(instance.window)).restart).toHaveCount(0)
  } finally {
    if (instance) await closeHronaut(instance.app)
  }
})
