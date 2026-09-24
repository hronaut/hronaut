import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Screen recording exposed a late-response assertion in Playwright's CDP
// driver during forced SIGKILL. Keep DOM snapshots and call/network evidence
// without recording frames; assertions and unexpected process errors still fail.
test.use({ trace: { mode: process.env.CI ? 'retain-on-failure' : 'off', screenshots: false } })

test('recovers a crashed website renderer in a fresh process', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Crash recovery fixture</title><style>@keyframes pulse { to { opacity: .2 } } main { animation: pulse .1s infinite alternate }</style><main>Renderer recovered</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Crash recovery fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/crash-recovery`
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Crash recovery fixture')
    // Shell title publication can precede Playwright's page initialization.
    // Complete a read through that target before deliberately terminating it,
    // just as the Home crash case does below.
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const websitePage = electronApp.context().pages().find(page => page.url() === url)!
    await expect(websitePage.locator('main')).toHaveText('Renderer recovered')
    const firstProcessId = await electronApp.evaluate(({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Crash recovery web contents was not found')
      const processId = page.getOSProcessId()
      if (processId <= 0) throw new Error('Crash recovery renderer did not expose an OS process')
      process.kill(processId, 'SIGKILL')
      return processId
    }, url)

    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.pageProblem)')).toMatchObject({
      kind: 'renderer-gone',
      title: 'This page stopped working',
      url
    })
    const recovery = appWindow.getByRole('alert')
    await expect(recovery).toContainText(/The page process (crashed|was terminated)\./)
    await recovery.getByRole('button', { name: 'Try again' }).click()
    const recoveredShellState = async (): Promise<{ pageProblem: unknown; title?: string }> => {
      // Killing a child renderer can briefly invalidate Playwright's cached
      // target handle even though the BrowserWindow renderer remains healthy.
      // Reacquire the shell page so the assertion observes Hronaut recovery,
      // while a genuinely crashed shell still times out and fails the test.
      const shell = await electronApp.firstWindow()
      return shell.evaluate(`window.hronaut.getState().then((state) => {
        const active = state.tabs.find((tab) => tab.active)
        return { pageProblem: active?.pageProblem ?? null, title: active?.title }
      })`)
    }
    await expect.poll(async () => (await recoveredShellState()).pageProblem).toBeNull()
    await expect.poll(async () => (await recoveredShellState()).title).toBe('Crash recovery fixture')
    const recoveredProcessId = await electronApp.evaluate(({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.getOSProcessId()
    }, url)
    expect(recoveredProcessId).toBeTruthy()
    expect(recoveredProcessId).not.toBe(firstProcessId)
  } finally {
    await closeFixtureServer(server)
  }
})

test('recovers Home after its renderer exits without losing the selected client', async ({ appWindow, electronApp }) => {
  const homeContents = async () => electronApp.evaluate(({ webContents }) => {
    const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
    return home ? { id: home.id, processId: home.getOSProcessId(), loading: home.isLoadingMainFrame(), crashed: home.isCrashed() } : undefined
  })
  await expect.poll(homeContents).toBeTruthy()
  await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))!
    return home.executeJavaScript(`Boolean(document.querySelector('[data-guide="opencode"]'))`)
  })).toBe(true)
  await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))!
    await home.executeJavaScript(`document.querySelector('[data-guide="opencode"]').click()`)
  })
  // Finish Playwright's attachment before deliberately killing this target.
  // Main-process executeJavaScript can succeed while CDP initialization is pending.
  await expect.poll(() => electronApp.context().pages().some(page => page.url().startsWith('hronaut://home'))).toBe(true)
  const homePage = electronApp.context().pages().find(page => page.url().startsWith('hronaut://home'))!
  await expect(homePage.locator('#guide-name')).toHaveText('OpenCode')
  const before = await homeContents()
  expect(before?.processId).toBeGreaterThan(0)
  await electronApp.evaluate((_electron, processId) => process.kill(processId, 'SIGKILL'), before!.processId)
  await expect(appWindow.getByRole('alert')).toContainText(/The page process (crashed|was terminated)\./)
  await appWindow.getByRole('alert').getByRole('button', { name: 'Try again' }).click()
  await expect.poll(async () => {
    const shell = await electronApp.firstWindow()
    return shell.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.pageProblem ?? null)`)
  }).toBeNull()
  // The shell clears pageProblem before loadURL finishes. Avoid dispatching a
  // JavaScript read to the old crashed renderer while its replacement starts.
  await expect.poll(async () => {
    const home = await homeContents()
    return Boolean(home && home.processId > 0 && home.processId !== before!.processId && !home.loading && !home.crashed)
  }).toBe(true)
  await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))!
    return home.executeJavaScript(`document.getElementById('guide-name')?.textContent`)
  })).toBe('OpenCode')
  expect((await homeContents())?.processId).not.toBe(before!.processId)
})
