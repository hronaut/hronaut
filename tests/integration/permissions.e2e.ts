import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { closeFixtureServer, blockFileDestination, closeHronaut, expect, launchHronaut, test } from './fixtures.js'
import { answerTrustedDialog, sendLateTrustedDialogAnswer, trustedDialog, trustedDialogHeadline, trustedDialogRequestId } from './trusted-dialog-fixture.js'

async function requestGeolocationPermission(electronApp: ElectronApplication, appWindow: Page): Promise<void> {
  await electronApp.evaluate(async ({ webContents }) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Permission race')
    if (!page) throw new Error('Permission fixture web contents was not found')
    await page.executeJavaScript(`navigator.geolocation.getCurrentPosition(() => undefined, () => undefined)`)
  })
  await expect(trustedDialog(appWindow)).toBeVisible()
}

/** Asks for the location from the page with this title. */
async function requestLocationOn(electronApp: ElectronApplication, title: string): Promise<void> {
  await electronApp.evaluate(async ({ webContents }, pageTitle) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === pageTitle)
    if (!page) throw new Error(`${pageTitle} was not found`)
    await page.executeJavaScript('navigator.geolocation.getCurrentPosition(() => undefined, () => undefined)')
  }, title)
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

async function requestIframeGeolocationPermission(electronApp: ElectronApplication, appWindow: Page): Promise<void> {
  await electronApp.evaluate(async ({ webContents }) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Iframe permission host')
    const child = page?.mainFrame.framesInSubtree.find((frame) => frame.url.endsWith('/child'))
    if (!child) throw new Error('Permission fixture iframe was not found')
    await child.executeJavaScript(`navigator.geolocation.getCurrentPosition(() => undefined, () => undefined)`)
  })
  await expect(trustedDialog(appWindow)).toBeVisible()
}

test('manages and persists per-website permission decisions', async ({
  appWindow,
  electronApp,
  mcpPort,
  profileDirectory
}) => {
  // Every decision belongs to a workspace; a request that names none is refused.
  const created = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Permission decisions', storage: 'scratch' })`) as {
    mcpTabGroups: Array<{ id: string, name: string }>
  }
  const workspaceId = created.mcpTabGroups.find((group) => group.name === 'Permission decisions')!.id
  expect(await appWindow.evaluate(
    "window.hronautPermissions.set('https://example.com', 'geolocation', 'allow').then(() => 'saved', (error) => error.message)"
  )).toContain('scope')
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('button', { name: 'Site permissions' }).click()
  await expect(appWindow.getByText('No saved decisions')).toBeVisible()

  await appWindow.evaluate(
    `window.hronautPermissions.set('https://example.com/path', 'geolocation', 'allow', { workspaceId: ${JSON.stringify(workspaceId)} })`
  )
  const locationName = 'Location permission for https://example.com (Permission decisions)'
  const locationPermission = appWindow.getByRole('combobox', { name: locationName })
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
      decision: 'allow',
      workspaceId
    }])
  } finally {
    await restorePermissionsFile()
  }

  await locationPermission.selectOption('deny')
  await expect
    .poll(async () => JSON.parse(await readFile(permissionsPath, 'utf8')).permissions[0]?.decision)
    .toBe('deny')
  await closeHronaut(electronApp)

  // A decision without a workspace, one Hronaut never remembers, and one of a workspace that went while Hronaut was closed.
  const saved = JSON.parse(await readFile(permissionsPath, 'utf8')) as { permissions: unknown[] }
  await writeFile(permissionsPath, JSON.stringify({ version: 2, permissions: [
    ...saved.permissions,
    { origin: 'https://unscoped.example', permission: 'notifications', decision: 'allow' },
    { origin: 'https://example.com', permission: 'media', decision: 'allow', workspaceId },
    { origin: 'https://example.com', permission: 'notifications', decision: 'allow', workspaceId: '01912345-6789-7abc-8def-0123456789ab' }
  ] }), 'utf8')

  const restarted = await launchHronaut(profileDirectory, mcpPort)
  try {
    const own = { origin: 'https://example.com', permission: 'geolocation', decision: 'deny', workspaceId }
    await expect.poll(() => restarted.window.evaluate('window.hronautPermissions.list()')).toEqual([own])
    await expect.poll(async () => JSON.parse(await readFile(permissionsPath, 'utf8')).permissions).toEqual([own])
    await restarted.window.getByRole('button', { name: 'Settings' }).click()
    await restarted.window.getByRole('button', { name: 'Site permissions' }).click()
    const restoredPermission = restarted.window.getByRole('combobox', { name: locationName })
    await expect(restoredPermission).toHaveValue('deny')
    await restarted.window.getByRole('button', { name: `Forget ${locationName}` }).click()
    await expect(restoredPermission).toHaveCount(0)
    await expect.poll(() => restarted.window.evaluate('window.hronautPermissions.list()')).toEqual([])
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

    // One dialog at a time: the second website waits behind the first.
    await requestLocationOn(electronApp, 'Permission queue first')
    await expect.poll(() => trustedDialogHeadline(appWindow)).toBe(`${firstOrigin} wants to know your location`)
    await requestLocationOn(electronApp, 'Permission queue second')
    await electronApp.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))
    await expect(trustedDialog(appWindow)).toHaveCount(1)
    expect(await trustedDialogHeadline(appWindow)).toBe(`${firstOrigin} wants to know your location`)

    await answerTrustedDialog(appWindow, 'Allow')
    await expect.poll(() => trustedDialogHeadline(appWindow)).toBe(`${secondOrigin} wants to know your location`)
    await expect(trustedDialog(appWindow)).toHaveCount(1)
    await answerTrustedDialog(appWindow, 'Deny')
    await expect(trustedDialog(appWindow)).toHaveCount(0)

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

    await requestLocationOn(electronApp, 'Permission queue blocker')
    await expect.poll(() => trustedDialogHeadline(appWindow)).toBe(`${blockingOrigin} wants to know your location`)
    await requestLocationOn(electronApp, 'Permission queue stale')
    await electronApp.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)))
    expect(await trustedDialogHeadline(appWindow)).toBe(`${blockingOrigin} wants to know your location`)

    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(staleState.activeTabId)})`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) =>
      state.tabs.some((tab) => tab.id === ${JSON.stringify(staleState.activeTabId)})
    )`)).toBe(false)
    await answerTrustedDialog(appWindow, 'Allow')
    await electronApp.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 250)))

    // The closed tab's request never shows.
    await expect(trustedDialog(appWindow)).toHaveCount(0)
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

    await requestGeolocationPermission(electronApp, appWindow)
    const asked = await trustedDialogRequestId(appWindow)

    await appWindow.evaluate(`window.hronaut.navigate({
      tabId: ${JSON.stringify(tabId)},
      url: 'about:blank'
    })`)
    // The dialog closes as Deny would: its answer no longer counts for the page that asked.
    await expect(trustedDialog(appWindow)).toHaveCount(0)
    // Nor does an Allow that lands just after it closed.
    await sendLateTrustedDialogAnswer(appWindow, asked, 1)
    await electronApp.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 100)))

    expect(await appWindow.evaluate('window.hronautPermissions.list()')).toEqual([])
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

    await requestGeolocationPermission(electronApp, appWindow)
    const asked = await trustedDialogRequestId(appWindow)
    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(tabId)})`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) =>
      state.tabs.some((tab) => tab.id === ${JSON.stringify(tabId)})
    )`)).toBe(false)

    await expect(trustedDialog(appWindow)).toHaveCount(0)
    await sendLateTrustedDialogAnswer(appWindow, asked, 1)
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

    await requestIframeGeolocationPermission(electronApp, appWindow)
    await expect(trustedDialog(appWindow)).toContainText(`Embedded in http://127.0.0.1:${hostPort}`)
    await answerTrustedDialog(appWindow, 'Allow')

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

    await requestIframeGeolocationPermission(electronApp, appWindow)
    const asked = await trustedDialogRequestId(appWindow)
    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Iframe permission host')
      const child = page?.mainFrame.framesInSubtree.find((frame) => frame.url.endsWith('/child'))
      if (!child) throw new Error('Permission fixture iframe was not found')
      await child.executeJavaScript(`location.href = 'about:blank'`)
    })
    await expect.poll(() => electronApp.evaluate(({ webContents }) => webContents.getAllWebContents()
      .some((contents) => contents.mainFrame.framesInSubtree.some((frame) => frame.url.endsWith('/child')))))
      .toBe(false)
    await expect(trustedDialog(appWindow)).toHaveCount(0)
    await sendLateTrustedDialogAnswer(appWindow, asked, 1)
    await electronApp.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 100)))

    expect(await appWindow.evaluate('window.hronautPermissions.list()')).toEqual([])
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
    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Permission name')
      if (!page) throw new Error('Permission fixture web contents was not found')
      await page.executeJavaScript('navigator.geolocation.getCurrentPosition(() => undefined, () => undefined)')
    })
    const dialog = trustedDialog(appWindow)
    await expect(dialog).toBeVisible()
    expect(await trustedDialogHeadline(appWindow)).toBe(`Сайт ${origin} хоче знати ваше розташування`)
    await expect(dialog).toContainText('Дозвіл сайту')
    await expect(dialog.locator('.ui-dialog__footer button')).toHaveText(['Заборонити', 'Дозволити'])
    await answerTrustedDialog(appWindow, 'Заборонити')
    await expect(dialog).toHaveCount(0)
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
    const requests = [
      ['document.getElementById("target").requestPointerLock()', 'lock and hide your mouse pointer'],
      ['navigator.keyboard.lock()', 'capture your keyboard shortcuts'],
      ['navigator.requestMIDIAccess({ sysex: true })', 'control and reprogram your MIDI devices'],
      ['navigator.storage.persist()', 'store data permanently on this device'],
      ['navigator.wakeLock.request("screen")', 'keep your screen on']
    ] as const
    for (const [script, wants] of requests) {
      await electronApp.evaluate(async ({ webContents }, request) => {
        const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Permission names')
        if (!page) throw new Error('Permission fixture web contents was not found')
        await page.executeJavaScript(`Promise.resolve().then(() => ${request}).catch(() => undefined); true`, true)
      }, script)
      await expect.poll(() => trustedDialogHeadline(appWindow).catch(() => '')).toBe(`${origin} wants to ${wants}`)
      await answerTrustedDialog(appWindow, 'Deny')
      await expect(trustedDialog(appWindow)).toHaveCount(0)
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
    // Neither request asks the person.
    await expect(trustedDialog(appWindow)).toHaveCount(0)
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
    await requestLocation('Workspace permission own')
    await answerTrustedDialog(appWindow, 'Allow')
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
    await expect(trustedDialog(appWindow)).toContainText('“Permission client” workspace')
    await answerTrustedDialog(appWindow, 'Deny')
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
