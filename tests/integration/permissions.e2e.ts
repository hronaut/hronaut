import { createServer } from 'node:http'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

async function delayPermissionDialog(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ dialog }) => {
    ;(globalThis as typeof globalThis & {
      __resolveHronautPermissionDialog?: (value: Electron.MessageBoxReturnValue) => void
    }).__resolveHronautPermissionDialog = undefined
    dialog.showMessageBox = () => new Promise((resolve) => {
      ;(globalThis as typeof globalThis & {
        __resolveHronautPermissionDialog?: (value: Electron.MessageBoxReturnValue) => void
      }).__resolveHronautPermissionDialog = resolve
    })
  })
}

async function requestGeolocationPermission(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(async ({ webContents }) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Permission race')
    if (!page) throw new Error('Permission fixture web contents was not found')
    await page.executeJavaScript(`navigator.geolocation.getCurrentPosition(() => undefined, () => undefined)`)
  })
  await expect.poll(() => electronApp.evaluate(() => Boolean(
    (globalThis as typeof globalThis & { __resolveHronautPermissionDialog?: unknown })
      .__resolveHronautPermissionDialog
  ))).toBe(true)
}

async function allowDelayedPermission(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(() => {
    const resolve = (globalThis as typeof globalThis & {
      __resolveHronautPermissionDialog?: (value: Electron.MessageBoxReturnValue) => void
    }).__resolveHronautPermissionDialog
    if (!resolve) throw new Error('Permission dialog resolver was not captured')
    resolve({ response: 1, checkboxChecked: false })
  })
}

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Permission fixture did not expose a port')
  return address.port
}

async function requestIframeGeolocationPermission(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(async ({ webContents }) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Iframe permission host')
    const child = page?.mainFrame.framesInSubtree.find((frame) => frame.url.endsWith('/child'))
    if (!child) throw new Error('Permission fixture iframe was not found')
    await child.executeJavaScript(`navigator.geolocation.getCurrentPosition(() => undefined, () => undefined)`)
  })
  await expect.poll(() => electronApp.evaluate(() => Boolean(
    (globalThis as typeof globalThis & { __resolveHronautPermissionDialog?: unknown })
      .__resolveHronautPermissionDialog
  ))).toBe(true)
}

test('manages and persists per-website permission decisions', async ({
  appWindow,
  electronApp,
  mcpPort,
  profileDirectory
}) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('button', { name: 'Site permissions' }).click()
  await expect(appWindow.getByText('No saved decisions')).toBeVisible()

  await appWindow.evaluate(
    "window.hronautPermissions.set('https://example.com/path', 'geolocation', 'allow')"
  )
  const locationPermission = appWindow.getByRole('combobox', {
    name: 'Location permission for https://example.com'
  })
  await expect(locationPermission).toHaveValue('allow')

  const permissionsPath = join(profileDirectory, 'site-permissions.json')
  const blockedTemporaryPath = `${permissionsPath}.tmp`
  await rm(blockedTemporaryPath, { recursive: true, force: true })
  await mkdir(blockedTemporaryPath)
  try {
    await locationPermission.selectOption('deny')
    await expect(appWindow.getByRole('alert', { name: 'Setting not saved' })).toBeVisible()
    await expect(locationPermission).toHaveValue('allow')
    await expect.poll(() => appWindow.evaluate('window.hronautPermissions.list()')).toEqual([{
      origin: 'https://example.com',
      permission: 'geolocation',
      decision: 'allow'
    }])
  } finally {
    await rm(blockedTemporaryPath, { recursive: true, force: true })
  }

  await locationPermission.selectOption('deny')
  await expect
    .poll(async () => JSON.parse(await readFile(permissionsPath, 'utf8')).permissions[0]?.decision)
    .toBe('deny')
  await closeHronaut(electronApp)

  const restarted = await launchHronaut(profileDirectory, mcpPort + 1)
  try {
    await restarted.window.getByRole('button', { name: 'Settings' }).click()
    await restarted.window.getByRole('button', { name: 'Site permissions' }).click()
    const restoredPermission = restarted.window.getByRole('combobox', {
      name: 'Location permission for https://example.com'
    })
    await expect(restoredPermission).toHaveValue('deny')
    await restarted.window.getByRole('button', {
      name: 'Forget Location permission for https://example.com'
    }).click()
    await expect(restarted.window.getByText('No saved decisions')).toBeVisible()
  } finally {
    await closeHronaut(restarted.app)
  }
})

test('does not persist a stale permission decision after the requesting tab navigates away', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Permission race</title><main>Permission race fixture</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Permission fixture did not expose a port')
    const requestingUrl = `http://127.0.0.1:${address.port}/request`
    const tabId = await appWindow.evaluate(`(async () => {
      const state = await window.hronaut.newTab({ url: ${JSON.stringify(requestingUrl)}, active: true });
      return state.activeTabId;
    })()`) as string
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) =>
      state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.title
    )`)).toBe('Permission race')

    await delayPermissionDialog(electronApp)
    await requestGeolocationPermission(electronApp)

    await appWindow.evaluate(`window.hronaut.navigate({
      tabId: ${JSON.stringify(tabId)},
      url: 'about:blank'
    })`)
    await allowDelayedPermission(electronApp)

    await expect.poll(() => appWindow.evaluate('window.hronautPermissions.list()')).toEqual([])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('does not persist a stale permission decision after the requesting tab closes', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Permission race</title><main>Permission race fixture</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Permission fixture did not expose a port')
    const requestingUrl = `http://127.0.0.1:${address.port}/request`
    const tabId = await appWindow.evaluate(`(async () => {
      const state = await window.hronaut.newTab({ url: ${JSON.stringify(requestingUrl)}, active: true });
      return state.activeTabId;
    })()`) as string
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) =>
      state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.title
    )`)).toBe('Permission race')

    await delayPermissionDialog(electronApp)
    await requestGeolocationPermission(electronApp)
    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(tabId)})`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) =>
      state.tabs.some((tab) => tab.id === ${JSON.stringify(tabId)})
    )`)).toBe(false)

    await allowDelayedPermission(electronApp)
    await electronApp.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 100)))
    expect(await appWindow.evaluate('window.hronautPermissions.list()')).toEqual([])
    await expect(appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.length)'))
      .resolves.toBeGreaterThan(0)
    expect(await electronApp.evaluate(() => process.exitCode ?? 0)).toBe(0)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('persists a permission decision for a still-live cross-origin iframe', async ({
  appWindow,
  electronApp
}) => {
  const childServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><main>Permission iframe</main>')
  })
  const childPort = await listen(childServer)
  const childOrigin = `http://127.0.0.1:${childPort}`
  const hostServer = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'permissions-policy': `geolocation=(self "${childOrigin}")`
    })
    response.end(`<!doctype html><title>Iframe permission host</title><iframe allow="geolocation" src="${childOrigin}/child"></iframe>`)
  })
  const hostPort = await listen(hostServer)

  try {
    await appWindow.evaluate(`window.hronaut.newTab({
      url: ${JSON.stringify(`http://127.0.0.1:${hostPort}/host`)},
      active: true
    })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }) => webContents.getAllWebContents()
      .some((contents) => contents.mainFrame.framesInSubtree.some((frame) => frame.url.endsWith('/child')))))
      .toBe(true)

    await delayPermissionDialog(electronApp)
    await requestIframeGeolocationPermission(electronApp)
    await allowDelayedPermission(electronApp)

    await expect.poll(() => appWindow.evaluate('window.hronautPermissions.list()')).toEqual([{
      origin: childOrigin,
      permission: 'geolocation',
      decision: 'allow'
    }])
  } finally {
    await Promise.all([
      new Promise<void>((resolve) => childServer.close(() => resolve())),
      new Promise<void>((resolve) => hostServer.close(() => resolve()))
    ])
  }
})

test('does not persist an iframe permission after the requesting frame navigates away', async ({
  appWindow,
  electronApp
}) => {
  const childServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><main>Permission iframe</main>')
  })
  const childPort = await listen(childServer)
  const childOrigin = `http://127.0.0.1:${childPort}`
  const hostServer = createServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'permissions-policy': `geolocation=(self "${childOrigin}")`
    })
    response.end(`<!doctype html><title>Iframe permission host</title><iframe allow="geolocation" src="${childOrigin}/child"></iframe>`)
  })
  const hostPort = await listen(hostServer)

  try {
    await appWindow.evaluate(`window.hronaut.newTab({
      url: ${JSON.stringify(`http://127.0.0.1:${hostPort}/host`)},
      active: true
    })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }) => webContents.getAllWebContents()
      .some((contents) => contents.mainFrame.framesInSubtree.some((frame) => frame.url.endsWith('/child')))))
      .toBe(true)

    await delayPermissionDialog(electronApp)
    await requestIframeGeolocationPermission(electronApp)
    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Iframe permission host')
      const child = page?.mainFrame.framesInSubtree.find((frame) => frame.url.endsWith('/child'))
      if (!child) throw new Error('Permission fixture iframe was not found')
      await child.executeJavaScript(`location.href = 'about:blank'`)
    })
    await expect.poll(() => electronApp.evaluate(({ webContents }) => webContents.getAllWebContents()
      .some((contents) => contents.mainFrame.framesInSubtree.some((frame) => frame.url.endsWith('/child')))))
      .toBe(false)
    await allowDelayedPermission(electronApp)

    await expect.poll(() => appWindow.evaluate('window.hronautPermissions.list()')).toEqual([])
  } finally {
    await Promise.all([
      new Promise<void>((resolve) => childServer.close(() => resolve())),
      new Promise<void>((resolve) => hostServer.close(() => resolve()))
    ])
  }
})
