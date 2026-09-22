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
