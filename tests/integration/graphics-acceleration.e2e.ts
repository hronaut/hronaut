import { readFile, readlink } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { chromium, type Browser, type ElectronApplication, type Page } from '@playwright/test'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

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
    restart: graphics.getByRole('status'),
    restartNow: graphics.getByRole('button', { name: 'Restart' })
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
    await expect(settings.restart).toHaveText('')
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
    await expect(settings.restart).toHaveText('')
    await settings.use.click()
    await expect(settings.restart).toHaveText('Restart Hronaut to apply this change.')
    await expect.poll(saved).toBe(true)

    await closeHronaut(instance.app)
    instance = undefined
    instance = await launchHronaut(profileDirectory, mcpPort)
    expect(await inUse(instance.window)).toBe(true)
    await expect((await openGraphicsSettings(instance.window)).restart).toHaveText('')
  } finally {
    if (instance) await closeHronaut(instance.app)
  }
})

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await closeFixtureServer(server)
  if (!address || typeof address === 'string') throw new Error('No free port')
  return address.port
}

/**
 * The run Restart started, by the process Chromium's profile lock names on Linux, and only while its command line
 * still holds this test's DevTools switch, so a stale lock never names some other process.
 */
async function restartedRun(profileDirectory: string, devToolsPort: number): Promise<number | undefined> {
  const owner = await readlink(join(profileDirectory, 'SingletonLock')).catch(() => '')
  const pid = Number(/-(\d+)$/.exec(owner)?.[1])
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
  const commandLine = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')
  return commandLine.split('\0').includes(`--remote-debugging-port=${devToolsPort}`) ? pid : undefined
}

// Settings only said to restart Hronaut, and closing its window may just hide it in the tray. As Chrome's Relaunch,
// Restart beside the notice quits Hronaut and starts it again on the same profile, which then applies the change. The
// new run is no Playwright launch: it keeps this run's DevTools switch, so the test reaches it there, and quits it.
test('restarts Hronaut from beside the notice, and the next run applies the change', async ({ profileDirectory, mcpPort }) => {
  const settingsPath = join(profileDirectory, 'settings.json')
  const devToolsPort = await freePort()
  // Playwright adds --no-sandbox on Linux, but takes it out of process.argv with its own switches, so the next run,
  // which starts from this run's command line, would lack it, and Chromium refuses to run as root without it.
  const sandbox = process.platform === 'linux' ? ['--no-sandbox'] : []
  const first = await launchHronaut(profileDirectory, mcpPort, 1, [], [...sandbox, `--remote-debugging-port=${devToolsPort}`])
  let next: Browser | undefined
  try {
    const settings = await openGraphicsSettings(first.window)
    await expect(settings.restartNow).toHaveCount(0)
    await settings.use.click()
    await expect(settings.restart).toHaveText('Restart Hronaut to apply this change.')
    await expect.poll(async () => (JSON.parse(await readFile(settingsPath, 'utf8')) as { graphicsAcceleration?: boolean })
      .graphicsAcceleration).toBe(false)
    const exited = first.app.waitForEvent('close')
    await settings.restartNow.click()
    await exited

    const deadline = Date.now() + 30_000
    while (!next) {
      try {
        next = await chromium.connectOverCDP(`http://127.0.0.1:${devToolsPort}`)
      } catch (error) {
        if (Date.now() > deadline) throw error
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
    const shell = async () => {
      for (const page of next!.contexts().flatMap((context) => context.pages())) {
        if (await page.evaluate('typeof window.hronautSettings?.graphicsAccelerationInUse === "function"').catch(() => false)) {
          return page
        }
      }
      return undefined
    }
    await expect.poll(async () => (await shell()) !== undefined, { timeout: 30_000 }).toBe(true)
    const window = (await shell())!
    expect(await inUse(window)).toBe(false)
    const applied = await openGraphicsSettings(window)
    await expect(applied.use).not.toBeChecked()
    await expect(applied.restart).toHaveText('')
    const disconnected = new Promise<void>((resolve) => next!.once('disconnected', () => resolve()))
    await window.evaluate('window.hronaut.quit()').catch(() => undefined)
    await disconnected
    next = undefined
    // Quit, the next run lets the profile go, which the test then removes.
    await expect.poll(() => restartedRun(profileDirectory, devToolsPort), { timeout: 15_000 }).toBeUndefined()
  } finally {
    await closeHronaut(first.app).catch(() => undefined)
    if (next) {
      const shell = next.contexts().flatMap((context) => context.pages())
      await Promise.all(shell.map((page) => page.evaluate('window.hronaut?.quit()').catch(() => undefined)))
      await next.close().catch(() => undefined)
    }
    // No Playwright launch stops the next run when the test fails before it quits, and it would keep this worker's MCP
    // port and profile from the tests after it.
    const pid = await restartedRun(profileDirectory, devToolsPort)
    if (pid !== undefined) {
      const signal = (name: NodeJS.Signals) => { try { process.kill(pid, name) } catch { /* It has exited. */ } }
      signal('SIGTERM')
      await expect.poll(() => restartedRun(profileDirectory, devToolsPort), { timeout: 10_000 }).toBeUndefined()
        .catch(() => signal('SIGKILL'))
    }
  }
})
