import { mkdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { expect, test } from './fixtures.js'

test('serializes Memory Saver settings and sleeps eligible tabs without stale shell state', async ({
  appWindow,
  profileDirectory
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Memory Saver fixture</title><main>Eligible website tab</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Memory Saver fixture server did not expose a port')
  const websiteUrl = `http://127.0.0.1:${address.port}/`

  try {
    await appWindow.evaluate(`(async () => {
      const url = ${JSON.stringify(websiteUrl)};
      await window.hronaut.newTab({ url, active: true });
      await window.hronaut.newTab({ url, active: true });
    })()`)

    await appWindow.getByRole('button', { name: 'Settings' }).click()
    await appWindow.getByRole('button', { name: /Performance/ }).click()
    const automatic = appWindow.getByRole('checkbox', { name: 'Automatically sleep inactive tabs' })
    const timeout = appWindow.getByRole('combobox', { name: 'Sleep after' })
    const sleepNow = appWindow.getByRole('button', { name: 'Sleep eligible tabs now' })
    await expect(appWindow.getByText('0 sleeping')).toBeVisible()
    await expect(appWindow.getByText('of 2 website tabs')).toBeVisible()
    await expect(automatic).toBeChecked()
    await expect(timeout).toHaveValue('60')

    const settingsPath = join(profileDirectory, 'settings.json')
    const blockedTemporaryPath = `${settingsPath}.tmp`
    await rm(blockedTemporaryPath, { recursive: true, force: true })
    await mkdir(blockedTemporaryPath)
    try {
      await automatic.click()
      await expect(appWindow.getByRole('alert', { name: 'Setting not saved' })).toBeVisible()
      await expect(automatic).toBeChecked()
      await expect(timeout).toHaveValue('60')
      await expect.poll(() => appWindow.evaluate('window.hronautSettings.get()')).toMatchObject({
        memorySaverEnabled: true,
        memorySaverTimeoutMinutes: 60
      })
    } finally {
      await rm(blockedTemporaryPath, { recursive: true, force: true })
    }

    await timeout.selectOption('15')
    await expect.poll(async () => JSON.parse(await readFile(settingsPath, 'utf8'))).toMatchObject({
      memorySaverEnabled: true,
      memorySaverTimeoutMinutes: 15
    })

    await sleepNow.click()
    await expect(appWindow.getByText('1 sleeping')).toBeVisible()
    await automatic.uncheck()
    await expect(automatic).not.toBeChecked()
    await expect(sleepNow).toBeDisabled()
    await expect(appWindow.getByText('0 sleeping')).toBeVisible()

    await appWindow.getByRole('button', { name: 'Reset to default' }).click()
    await expect(automatic).toBeChecked()
    await expect(timeout).toHaveValue('60')
    await expect.poll(async () => JSON.parse(await readFile(settingsPath, 'utf8'))).toMatchObject({
      memorySaverEnabled: true,
      memorySaverTimeoutMinutes: 60
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('keeps a tab awake when it becomes visible during the form-safety check', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html>
      <title>Memory Saver race fixture</title>
      <input aria-label="Unchanged field" value="">
      <script>window.__memorySaverDocumentIdentity = crypto.randomUUID()</script>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Memory Saver race fixture did not expose a port')
    const websiteUrl = `http://127.0.0.1:${address.port}/`
    await appWindow.evaluate(`(async () => {
      await window.hronaut.newTab({ url: ${JSON.stringify(websiteUrl)}, active: true });
      await window.hronaut.newTab({ url: 'about:blank', active: true });
    })()`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.title === "Memory Saver race fixture")?.id)')).toBeTruthy()
    const tabId = await appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.title === "Memory Saver race fixture")?.id)') as string
    const documentIdentity = await electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Memory Saver race fixture WebContents was not found')
      return page.executeJavaScript('window.__memorySaverDocumentIdentity') as Promise<string>
    }, websiteUrl)

    await electronApp.evaluate(({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Memory Saver race fixture WebContents was not found')
      const originalExecuteJavaScript = page.executeJavaScript.bind(page)
      const control = { started: false, release: undefined as (() => void) | undefined }
      ;(globalThis as typeof globalThis & { __hronautFormSafetyCheck?: typeof control }).__hronautFormSafetyCheck = control
      Object.defineProperty(page, 'executeJavaScript', {
        configurable: true,
        value: (code: string, userGesture?: boolean) => {
          if (code.includes('window.__hronautContentEditableDirty === true')) {
            control.started = true
            return new Promise<boolean>((resolve) => {
              control.release = () => resolve(false)
            })
          }
          return originalExecuteJavaScript(code, userGesture)
        }
      })
    }, websiteUrl)

    await appWindow.evaluate(`(() => {
      window.__hronautMemorySaverRace = window.hronaut.sleepInactiveTabs();
    })()`)
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautFormSafetyCheck?: { started: boolean } })
        .__hronautFormSafetyCheck?.started ?? false
    ))).toBe(true)
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    await electronApp.evaluate(() => {
      const control = (globalThis as typeof globalThis & {
        __hronautFormSafetyCheck?: { release?: () => void }
      }).__hronautFormSafetyCheck
      if (!control?.release) throw new Error('Memory Saver form-safety check was not waiting')
      control.release()
    })
    await appWindow.evaluate('window.__hronautMemorySaverRace')

    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({
      active: state.activeTabId === ${JSON.stringify(tabId)},
      sleeping: state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.sleeping
    }))`)).toEqual({ active: true, sleeping: false })
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript('window.__memorySaverDocumentIdentity') ?? null
    }, websiteUrl)).toBe(documentIdentity)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
