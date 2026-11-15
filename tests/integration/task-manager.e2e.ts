import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Killing a page's renderer can briefly upset Playwright's CDP driver, as in renderer-crash-recovery.e2e.ts; keep DOM
// snapshots without recording frames.
test.use({ trace: { mode: process.env.CI ? 'retain-on-failure' : 'off', screenshots: false } })

test('Shift+Esc and View → Task manager list Hronaut\'s processes, and End process ends a tab\'s page, as in Chrome', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    // /keeps handles Shift+Esc itself, as a web app may.
    const keeps = request.url === '/keeps'
    response.end(`<!doctype html><title>Task manager fixture</title><script>window.keys = []; addEventListener('keydown', (event) => {
      window.keys.push(event.key)
      if (${keeps} && event.shiftKey && event.key === 'Escape') event.preventDefault()
    })</script><main>Task manager fixture</main>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const dialog = appWindow.getByRole('dialog', { name: 'Task manager' })
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${origin}/page`)}, active: true })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Task manager fixture')
    const pagePid = () => electronApp.evaluate(({ webContents }, origin) => (
      webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(origin))?.getOSProcessId() ?? 0
    ), origin)
    await expect.poll(pagePid).toBeGreaterThan(0)
    const pid = await pagePid()
    const keys = (script = 'window.keys.slice()') => electronApp.evaluate(({ webContents }, { origin, script }) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(origin))
      if (!contents) throw new Error('Page web contents was not found')
      return contents.executeJavaScript(script) as Promise<string[]>
    }, { origin, script })
    // The person's Shift+Esc, sent to the page or to Hronaut's own window as the keyboard sends it.
    const press = (where: 'page' | 'shell') => electronApp.evaluate(({ webContents }, { origin, shellUrl, where }) => {
      const contents = webContents.getAllWebContents()
        .find(candidate => where === 'page' ? candidate.getURL().startsWith(origin) : candidate.getURL() === shellUrl)
      if (!contents) throw new Error(`No ${where} web contents`)
      if (where === 'page') contents.focus()
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape', modifiers: ['shift'] })
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape', modifiers: ['shift'] })
    }, { origin, shellUrl: appWindow.url(), where })
    // The person's click on the page. Right after a dialog over the pages closes, the page's view is back only just,
    // and on Linux a focus given to it then goes on to Hronaut's window, so wait until the page keeps it.
    const focusPage = () => expect.poll(() => electronApp.evaluate(async ({ webContents }, origin) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(origin))
      if (!contents) return false
      contents.focus()
      await new Promise(resolve => setTimeout(resolve, 100))
      return contents.isFocused()
    }, origin)).toBe(true)
    // The person's click in Hronaut's window gives it the keyboard; Playwright's click does not.
    const focusShell = () => expect.poll(() => electronApp.evaluate(({ webContents }, shellUrl) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === shellUrl)
      contents?.focus()
      return contents?.isFocused() ?? false
    }, appWindow.url())).toBe(true)

    // From the website in focus, and again from the dialog, which then has the keyboard, to close it.
    await focusPage()
    await press('page')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('rowheader', { name: 'Browser', exact: true })).toBeVisible()
    await expect(dialog.getByRole('rowheader', { name: 'Hronaut window', exact: true }).first()).toBeVisible()
    await expect(dialog.getByRole('rowheader', { name: /^Utility: Network Service/ })).toBeVisible()
    const row = dialog.getByRole('row', { name: /Tab: Task manager fixture/ })
    await expect(row).toBeVisible()
    await expect(row.getByRole('cell').nth(2)).toHaveText(String(pid))
    await expect(row.getByRole('cell').first()).toHaveText(/\d/)
    // A tab's page can be ended, as in Chrome, never the browser or Hronaut's window.
    await expect(row.getByRole('button', { name: 'End process: Tab: Task manager fixture' })).toBeVisible()
    await expect(dialog.getByRole('row', { name: /^Browser/ }).getByRole('button')).toHaveCount(0)
    for (const window of await dialog.getByRole('row', { name: /^Hronaut window/ }).all()) await expect(window.getByRole('button')).toHaveCount(0)
    await press('shell')
    await expect(dialog).toBeHidden()

    // And View → Task manager.
    const chooseTaskManager = () => electronApp.evaluate(({ BrowserWindow, Menu }) => {
      const item = Menu.getApplicationMenu()?.items.find(candidate => candidate.label === 'View')
        ?.submenu?.items.find(candidate => candidate.label === 'Task manager')
      if (!item?.click) throw new Error('Missing View → Task manager')
      item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
    })
    await chooseTaskManager()
    await expect(dialog).toBeVisible()
    await chooseTaskManager()
    await expect(dialog).toBeHidden()

    // A website that handles the key itself keeps it.
    await appWindow.evaluate(`window.hronaut.getState().then((state) => window.hronaut.navigate({ url: ${JSON.stringify(`${origin}/keeps`)}, tabId: state.activeTabId }))`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, origin) => (
      webContents.getAllWebContents().some(candidate => candidate.getURL() === `${origin}/keeps`)
    ), origin)).toBe(true)
    await keys('window.keys = []')
    await focusPage()
    await press('page')
    await expect.poll(() => keys()).toContain('Escape')
    await appWindow.waitForTimeout(500)
    await expect(dialog).toHaveCount(0)

    // End process ends the page's process: the tab says so, and Try again starts a new one.
    await chooseTaskManager()
    const keptPid = await pagePid()
    const endButton = dialog.getByRole('button', { name: 'End process: Tab: Task manager fixture' })
    await focusShell()
    await endButton.click()
    // Its row leaves, or names no tab while Electron still lists the process as it exits.
    const endedRow = dialog.getByRole('row').filter({ has: appWindow.getByRole('cell', { name: String(keptPid), exact: true }) })
    await expect(endedRow.getByRole('rowheader', { name: /^Tab:/ })).toHaveCount(0)
    await expect(endedRow.getByRole('button')).toHaveCount(0)
    await expect(dialog).toBeFocused()
    await appWindow.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.pageProblem)')).toMatchObject({
      kind: 'renderer-gone',
      reason: 'killed',
      message: 'The page process was terminated.'
    })
    await expect.poll(() => electronApp.evaluate(({ app }, keptPid) => app.getAppMetrics().some(metric => metric.pid === keptPid), keptPid)).toBe(false)
    const recovery = appWindow.getByRole('alert')
    await expect(recovery).toContainText('The page process was terminated.')
    await recovery.getByRole('button', { name: 'Try again' }).click()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.pageProblem ?? null)')).toBeNull()
    await expect.poll(pagePid).toBeGreaterThan(0)
    expect(await pagePid()).not.toBe(keptPid)
  } finally {
    await closeFixtureServer(server)
  }
})
