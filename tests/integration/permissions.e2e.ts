import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { closeFixtureServer, blockFileDestination, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

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
      closeFixtureServer(firstServer),
      closeFixtureServer(secondServer)
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
      decision: 'allow',
      workspaceId: expect.any(String)
    }])
  } finally {
    await Promise.all([
      closeFixtureServer(blockingServer),
      closeFixtureServer(staleServer)
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
    await closeFixtureServer(server)
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
    await closeFixtureServer(server)
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

    // The decision belongs to the page the frame was embedded in.
    await expect.poll(() => appWindow.evaluate('window.hronautPermissions.list()')).toEqual([{
      origin: childOrigin,
      permission: 'geolocation',
      decision: 'allow',
      workspaceId: expect.any(String),
      embeddedIn: `http://127.0.0.1:${hostPort}`
    }])
  } finally {
    await Promise.all([
      closeFixtureServer(childServer),
      closeFixtureServer(hostServer)
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
      closeFixtureServer(childServer),
      closeFixtureServer(hostServer)
    ])
  }
})

test('names the requested permission in the prompt the way Settings does, in the interface language', async ({
  appWindow,
  electronApp
}) => {
  // The prompt named Chromium's identifier, such as "geolocation", in every language.
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Permission name</title><main>Location request</main>')
  })
  const origin = `http://127.0.0.1:${await listen(server)}`
  try {
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(origin)}, active: true })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }) => (
      webContents.getAllWebContents().some((contents) => contents.getTitle() === 'Permission name')
    ))).toBe(true)
    await electronApp.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.MessageBoxOptions
        ;(globalThis as typeof globalThis & { __permissionPrompt?: unknown }).__permissionPrompt = {
          title: options.title, message: options.message, buttons: options.buttons
        }
        return { response: 0, checkboxChecked: false }
      }
    })
    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Permission name')
      if (!page) throw new Error('Permission fixture web contents was not found')
      await page.executeJavaScript('navigator.geolocation.getCurrentPosition(() => undefined, () => undefined)')
    })
    await expect.poll(() => electronApp.evaluate(() => (
      globalThis as typeof globalThis & { __permissionPrompt?: unknown }
    ).__permissionPrompt)).toEqual({
      title: 'Дозвіл сайту',
      message: `Сайт ${origin} запитує дозвіл «Розташування».`,
      buttons: ['Заборонити', 'Дозволити']
    })
  } finally {
    await closeFixtureServer(server)
  }
})

test('names the permissions games, music and media pages ask for instead of showing their identifiers', async ({
  appWindow,
  electronApp
}) => {
  // These requests reach Hronaut's prompt without a name, so it showed "pointerLock" or "screen wake lock".
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Permission names</title><canvas id="target" width="100" height="100"></canvas>')
  })
  const origin = `http://127.0.0.1:${await listen(server)}`
  try {
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(origin)}, active: true })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }) => (
      webContents.getAllWebContents().some((contents) => contents.getTitle() === 'Permission names')
    ))).toBe(true)
    await electronApp.evaluate(({ dialog }) => {
      const prompts: string[] = []
      ;(globalThis as typeof globalThis & { __permissionPrompts?: string[] }).__permissionPrompts = prompts
      dialog.showMessageBox = async (...args: unknown[]) => {
        prompts.push(String((args.at(-1) as Electron.MessageBoxOptions).message))
        return { response: 0, checkboxChecked: false }
      }
    })
    const requests = [
      ['document.getElementById("target").requestPointerLock()', 'Mouse pointer lock'],
      ['navigator.keyboard.lock()', 'Keyboard lock'],
      ['navigator.requestMIDIAccess({ sysex: true })', 'MIDI device control'],
      ['navigator.storage.persist()', 'Persistent storage'],
      ['navigator.wakeLock.request("screen")', 'Keep screen on']
    ] as const
    for (const [index, [script, name]] of requests.entries()) {
      await electronApp.evaluate(async ({ webContents }, request) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Permission names')
        if (!page) throw new Error('Permission fixture web contents was not found')
        await page.executeJavaScript(`Promise.resolve().then(() => ${request}).catch(() => undefined); true`, true)
      }, script)
      await expect.poll(() => electronApp.evaluate((_electron, position) => (
        globalThis as typeof globalThis & { __permissionPrompts?: string[] }
      ).__permissionPrompts?.[position], index)).toBe(`${origin} requests “${name}” permission.`)
    }
  } finally {
    await closeFixtureServer(server)
  }
})

test('refuses a screen sharing request without asking about the camera and microphone', async ({
  appWindow,
  electronApp
}) => {
  // Both requests showed "requests “Camera and microphone” permission". Allowing getDisplayMedia then failed as not
  // supported, and allowing getUserMedia's chromeMediaSource "desktop" gave the page a live capture of the whole screen.
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Screen sharing</title><main>Share screen</main>')
  })
  const origin = `http://127.0.0.1:${await listen(server)}`
  try {
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(origin)}, active: true })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }) => (
      webContents.getAllWebContents().some((contents) => contents.getTitle() === 'Screen sharing')
    ))).toBe(true)
    await electronApp.evaluate(({ dialog }) => {
      const prompts: string[] = []
      ;(globalThis as typeof globalThis & { __permissionPrompts?: string[] }).__permissionPrompts = prompts
      dialog.showMessageBox = async (...args: unknown[]) => {
        prompts.push(String((args.at(-1) as Electron.MessageBoxOptions).message))
        return { response: 1, checkboxChecked: false }
      }
    })
    for (const capture of [
      'navigator.mediaDevices.getDisplayMedia({ video: true })',
      'navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: "desktop" } } })'
    ]) {
      const outcome = await electronApp.evaluate(async ({ webContents }, script) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Screen sharing')
        if (!page) throw new Error('Screen sharing fixture web contents was not found')
        return page.executeJavaScript(
          `${script}.then((stream) => { stream.getTracks().forEach((track) => track.stop()); return "shared" }, (error) => error.name)`,
          true
        )
      }, capture)
      expect(outcome, capture).toBe('NotAllowedError')
    }
    expect(await electronApp.evaluate(() => (
      globalThis as typeof globalThis & { __permissionPrompts?: string[] }
    ).__permissionPrompts)).toEqual([])
  } finally {
    await closeFixtureServer(server)
  }
})

test('refuses a page’s repeated links to a denied app without asking until the page reloads', async ({
  appWindow,
  electronApp
}) => {
  // Every link to another app used to queue its own window-blocking prompt, so a page could ask again after every Deny.
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>External app links</title><main>Open the app</main>')
  })
  const origin = `http://127.0.0.1:${await listen(server)}`
  try {
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${origin}/links`)}, active: true })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }) => (
      webContents.getAllWebContents().some((contents) => contents.getTitle() === 'External app links')
    ))).toBe(true)
    // Each prompt is denied as soon as it shows; the probe keeps what each one said.
    await electronApp.evaluate(({ dialog, shell }) => {
      const globals = globalThis as typeof globalThis & { __externalAppPrompts?: string[], __openedExternalLinks?: string[] }
      const prompts: string[] = []
      const opened: string[] = []
      globals.__externalAppPrompts = prompts
      globals.__openedExternalLinks = opened
      dialog.showMessageBox = async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.MessageBoxOptions
        prompts.push(`${options.message} ${options.detail ?? ''}`)
        return { response: 0, checkboxChecked: false }
      }
      shell.openExternal = async (url: string): Promise<void> => { opened.push(url) }
    })
    const prompts = () => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __externalAppPrompts?: string[] }).__externalAppPrompts ?? []
    ).map((prompt) => /hronaut-[a-z-]+:/.exec(prompt)?.[0] ?? prompt))
    const openLink = (link: string) => electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'External app links')
      if (!page) throw new Error('External app fixture web contents was not found')
      await page.executeJavaScript(`location.href = ${JSON.stringify(url)}`, true)
    }, link)

    await openLink('hronaut-test-app:first')
    await expect.poll(prompts).toEqual(['hronaut-test-app:'])
    // Another link to the denied app is refused without a prompt. A link to another app still asks, and once its
    // prompt shows, the page's earlier link has been handled.
    await openLink('hronaut-test-app:second')
    await openLink('hronaut-other-app:first')
    await expect.poll(prompts).toEqual(['hronaut-test-app:', 'hronaut-other-app:'])

    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'External app links')
      if (!page) throw new Error('External app fixture web contents was not found')
      await new Promise<void>((resolve) => { page.once('did-finish-load', () => resolve()); page.reload() })
    })
    await openLink('hronaut-test-app:third')
    await expect.poll(prompts).toEqual(['hronaut-test-app:', 'hronaut-other-app:', 'hronaut-test-app:'])

    expect(await electronApp.evaluate(() => (
      globalThis as typeof globalThis & { __openedExternalLinks?: string[] }
    ).__openedExternalLinks)).toEqual([])
  } finally {
    await closeFixtureServer(server)
  }
})

test('asks again in another workspace and forgets a workspace’s decisions when it is closed for good', async ({
  appWindow,
  electronApp
}) => {
  // A decision made in one workspace applied in every workspace, though each keeps its own sign-ins and data.
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>Workspace permission ${request.url === '/client' ? 'client' : 'own'}</title><main>Location</main>`)
  })
  const origin = `http://127.0.0.1:${await listen(server)}`
  const requestLocation = (title: string) => electronApp.evaluate(async ({ webContents }, pageTitle) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === pageTitle)
    if (!page) throw new Error(`${pageTitle} was not found`)
    await page.executeJavaScript('navigator.geolocation.getCurrentPosition(() => undefined, () => undefined)')
  }, title)
  const titleShown = (title: string) => expect.poll(() => electronApp.evaluate(({ webContents }, pageTitle) => (
    webContents.getAllWebContents().some((contents) => contents.getTitle() === pageTitle)
  ), title)).toBe(true)

  try {
    const own = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${origin}/own`)}, active: true })`) as {
      tabs: Array<{ id: string, url: string, mcpGroupId?: string }>
    }
    const ownWorkspaceId = own.tabs.find((tab) => tab.url === `${origin}/own`)!.mcpGroupId!
    await titleShown('Workspace permission own')
    await installPermissionDialogProbe(electronApp)
    await requestLocation('Workspace permission own')
    await expect.poll(() => permissionDialogStats(electronApp)).toMatchObject({ calls: 1 })
    await resolveNextPermissionDialog(electronApp, 1)
    await expect.poll(() => appWindow.evaluate('window.hronautPermissions.list()')).toEqual([
      { origin, permission: 'geolocation', decision: 'allow', workspaceId: ownWorkspaceId }
    ])

    const created = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Permission client', storage: 'scratch' })`) as {
      tabs: Array<{ id: string, mcpGroupId?: string }>
      mcpTabGroups: Array<{ id: string, name: string }>
    }
    const clientWorkspaceId = created.mcpTabGroups.find((group) => group.name === 'Permission client')!.id
    const clientTabId = created.tabs.find((tab) => tab.mcpGroupId === clientWorkspaceId)!.id
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(clientTabId)}, url: ${JSON.stringify(`${origin}/client`)} })`)
    await titleShown('Workspace permission client')
    await requestLocation('Workspace permission client')
    await expect.poll(() => permissionDialogStats(electronApp)).toMatchObject({ calls: 2 })
    await resolveNextPermissionDialog(electronApp, 0)
    await expect.poll(async () => (await appWindow.evaluate('window.hronautPermissions.list()') as Array<{ workspaceId?: string, decision: string }>)
      .map((entry) => [entry.workspaceId, entry.decision]).sort())
      .toEqual([[clientWorkspaceId, 'deny'], [ownWorkspaceId, 'allow']].sort())

    await appWindow.evaluate(`window.hronaut.closeWorkspace(${JSON.stringify(clientWorkspaceId)})`)
    await expect.poll(() => appWindow.evaluate('window.hronautPermissions.list()')).toEqual([
      { origin, permission: 'geolocation', decision: 'allow', workspaceId: ownWorkspaceId }
    ])
  } finally {
    await closeFixtureServer(server)
  }
})
