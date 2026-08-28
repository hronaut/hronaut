import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { blockFileDestination, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

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

interface PermissionDialogProbe {
  calls: number
  active: number
  maxActive: number
  pending: Array<(value: Electron.MessageBoxReturnValue) => void>
}

async function installPermissionDialogProbe(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ dialog }) => {
    const globals = globalThis as typeof globalThis & { __permissionDialogProbe?: PermissionDialogProbe }
    const probe: PermissionDialogProbe = { calls: 0, active: 0, maxActive: 0, pending: [] }
    globals.__permissionDialogProbe = probe
    dialog.showMessageBox = () => {
      probe.calls += 1
      probe.active += 1
      probe.maxActive = Math.max(probe.maxActive, probe.active)
      return new Promise((resolve) => {
        probe.pending.push((value) => {
          probe.active -= 1
          resolve(value)
        })
      })
    }
  })
}

async function permissionDialogStats(electronApp: ElectronApplication): Promise<Omit<PermissionDialogProbe, 'pending'>> {
  return electronApp.evaluate(() => {
    const probe = (globalThis as typeof globalThis & { __permissionDialogProbe?: PermissionDialogProbe })
      .__permissionDialogProbe
    if (!probe) throw new Error('Permission dialog probe was not installed')
    return { calls: probe.calls, active: probe.active, maxActive: probe.maxActive }
  })
}

async function resolveNextPermissionDialog(electronApp: ElectronApplication, response: 0 | 1): Promise<void> {
  await electronApp.evaluate((_electron, selectedResponse) => {
    const probe = (globalThis as typeof globalThis & { __permissionDialogProbe?: PermissionDialogProbe })
      .__permissionDialogProbe
    const resolve = probe?.pending.shift()
    if (!resolve) throw new Error('No queued permission dialog is available')
    resolve({ response: selectedResponse, checkboxChecked: false })
  }, response)
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
  const restorePermissionsFile = await blockFileDestination(permissionsPath)
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
    await restorePermissionsFile()
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

test('serializes concurrent permission prompts and preserves their decisions', async ({
  appWindow,
  electronApp
}) => {
  const firstServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Permission queue first</title><main>First permission request</main>')
  })
  const secondServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Permission queue second</title><main>Second permission request</main>')
  })
  const [firstPort, secondPort] = await Promise.all([listen(firstServer), listen(secondServer)])
  const firstOrigin = `http://127.0.0.1:${firstPort}`
  const secondOrigin = `http://127.0.0.1:${secondPort}`

  try {
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(firstOrigin)}, active: true })`)
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(secondOrigin)}, active: true })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }) => [
      webContents.getAllWebContents().some((contents) => contents.getTitle() === 'Permission queue first'),
      webContents.getAllWebContents().some((contents) => contents.getTitle() === 'Permission queue second')
    ])).toEqual([true, true])

    await installPermissionDialogProbe(electronApp)
    await electronApp.evaluate(async ({ webContents }) => {
      const first = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Permission queue first')
      if (!first) throw new Error('First permission fixture was not found')
      await first.executeJavaScript('navigator.geolocation.getCurrentPosition(() => undefined, () => undefined)')
    })
    await expect.poll(() => permissionDialogStats(electronApp)).toEqual({
      calls: 1,
      active: 1,
      maxActive: 1
    })

    await electronApp.evaluate(async ({ webContents }) => {
      const second = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Permission queue second')
      if (!second) throw new Error('Second permission fixture was not found')
      await second.executeJavaScript('navigator.geolocation.getCurrentPosition(() => undefined, () => undefined)')
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    expect(await permissionDialogStats(electronApp)).toEqual({
      calls: 1,
      active: 1,
      maxActive: 1
    })

    await resolveNextPermissionDialog(electronApp, 1)
    await expect.poll(() => permissionDialogStats(electronApp)).toEqual({
      calls: 2,
      active: 1,
      maxActive: 1
    })
    await resolveNextPermissionDialog(electronApp, 0)

    await expect.poll(async () => {
      const entries = await appWindow.evaluate('window.hronautPermissions.list()') as Array<{
        origin: string
        permission: string
        decision: string
      }>
      return {
        count: entries.length,
        decisions: Object.fromEntries(entries.map((entry) => [entry.origin, entry.decision]))
      }
    }).toEqual({
      count: 2,
      decisions: {
        [firstOrigin]: 'allow',
        [secondOrigin]: 'deny'
      }
    })
  } finally {
    await Promise.all([
      new Promise<void>((resolve) => firstServer.close(() => resolve())),
      new Promise<void>((resolve) => secondServer.close(() => resolve()))
    ])
  }
})

test('drops a queued permission request when its tab closes before presentation', async ({
  appWindow,
  electronApp
}) => {
  const blockingServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Permission queue blocker</title><main>Blocking permission request</main>')
  })
  const staleServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Permission queue stale</title><main>Stale permission request</main>')
  })
  const [blockingPort, stalePort] = await Promise.all([listen(blockingServer), listen(staleServer)])
  const blockingOrigin = `http://127.0.0.1:${blockingPort}`

  try {
    await appWindow.evaluate(`window.hronaut.newTab({
      url: ${JSON.stringify(blockingOrigin)},
      active: true
    })`)
    const staleState = await appWindow.evaluate(`window.hronaut.newTab({
      url: ${JSON.stringify(`http://127.0.0.1:${stalePort}`)},
      active: true
    })`) as { activeTabId: string }
    await expect.poll(() => electronApp.evaluate(({ webContents }) => [
      webContents.getAllWebContents().some((contents) => contents.getTitle() === 'Permission queue blocker'),
      webContents.getAllWebContents().some((contents) => contents.getTitle() === 'Permission queue stale')
    ])).toEqual([true, true])

    await installPermissionDialogProbe(electronApp)
    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Permission queue blocker')
      if (!page) throw new Error('Blocking permission fixture was not found')
      await page.executeJavaScript('navigator.geolocation.getCurrentPosition(() => undefined, () => undefined)')
    })
    await expect.poll(() => permissionDialogStats(electronApp)).toEqual({
      calls: 1,
      active: 1,
      maxActive: 1
    })

    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Permission queue stale')
      if (!page) throw new Error('Stale permission fixture was not found')
      await page.executeJavaScript('navigator.geolocation.getCurrentPosition(() => undefined, () => undefined)')
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    expect(await permissionDialogStats(electronApp)).toEqual({
      calls: 1,
      active: 1,
      maxActive: 1
    })

    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(staleState.activeTabId)})`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) =>
      state.tabs.some((tab) => tab.id === ${JSON.stringify(staleState.activeTabId)})
    )`)).toBe(false)
    await resolveNextPermissionDialog(electronApp, 1)
    await electronApp.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 250)))

    expect(await permissionDialogStats(electronApp)).toEqual({
      calls: 1,
      active: 0,
      maxActive: 1
    })
    await expect.poll(() => appWindow.evaluate('window.hronautPermissions.list()')).toEqual([{
      origin: blockingOrigin,
      permission: 'geolocation',
      decision: 'allow'
    }])
  } finally {
    await Promise.all([
      new Promise<void>((resolve) => blockingServer.close(() => resolve())),
      new Promise<void>((resolve) => staleServer.close(() => resolve()))
    ])
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
