import type { HronautApi } from '../../src/shared/types.js'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, firefox } from '@playwright/test'
import { test, expect, closeFixtureServer } from './fixtures.js'
import { removeTestDirectory } from '../helpers/remove-test-directory.js'

for (const sourceBrowser of ['chromium', 'firefox'] as const) {
  test(`human imports a real ${sourceBrowser} profile into only the selected workspace`, async ({ appWindow, electronApp }, testInfo) => {
    const home = await mkdtemp(join(tmpdir(), 'hronaut-external-browser-'))
    const server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<title>Cookie fixture</title><main>${request.headers.cookie?.includes('fixture-auth=fixture-token') ? 'Signed in' : 'Signed out'}</main>`)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture unavailable')
    const origin = `http://127.0.0.1:${address.port}`
    const sourceRoot = sourceBrowser === 'chromium' ? join(home, '.config/chromium') : join(home, '.mozilla/firefox/fixture')
    await mkdir(sourceRoot, { recursive: true })
    const source = await (sourceBrowser === 'chromium' ? chromium : firefox).launchPersistentContext(sourceRoot, { headless: true, ...(sourceBrowser === 'chromium' ? { args: ['--password-store=basic'] } : {}) })
    let previousHome = ''
    try {
      await source.addCookies([{ name: 'fixture-auth', value: 'fixture-token', domain: '127.0.0.1', path: '/', secure: false, httpOnly: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 }])
      const page = source.pages()[0] ?? await source.newPage()
      await page.goto(origin); await expect(page.getByRole('main')).toHaveText('Signed in')
      await source.close()
      if (sourceBrowser === 'firefox') await writeFile(join(home, '.mozilla/firefox/profiles.ini'), '[Profile0]\nName=Fixture profile\nIsRelative=1\nPath=fixture\n')
      const databasePath = sourceBrowser === 'firefox' ? join(sourceRoot, 'cookies.sqlite') : join(sourceRoot, 'Default/Cookies')
      const originalDatabase = await readFile(databasePath)
      previousHome = await electronApp.evaluate(({ dialog }, fixtureHome) => {
        const previous = process.env.HOME ?? ''; process.env.HOME = fixtureHome
        const scope = globalThis as typeof globalThis & { importConsent?: boolean }
        scope.importConsent = false
        dialog.showMessageBox = async () => ({ response: scope.importConsent ? 1 : 0, checkboxChecked: false })
        return previous
      }, home)
      const target = await appWindow.evaluate(async () => {
        const state = await (window as unknown as { hronaut: HronautApi }).hronaut.createWorkspace({ name: 'Import destination', storage: 'scratch' })
        return state.mcpTabGroups.find(g => g.name === 'Import destination')!.id
      })
      // The trusted native workspace menu emits this event, not an MCP tool.
      await electronApp.evaluate(({ BrowserWindow }, id) => {
        BrowserWindow.getAllWindows()[0]!.webContents.send('browser:home-workspace-editor', { view: 'import', workspaceId: id })
      }, target)
      const panel = appWindow.getByTestId('browser-import-panel')
      await expect(panel).toBeVisible()
      await expect(panel.getByLabel('Browser and profile')).toContainText(sourceBrowser === 'chromium' ? 'Chromium' : 'Fixture profile')
      await panel.getByRole('button', { name: 'Continue', exact: true }).click()
      await expect(panel.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled()
      await expect(panel.getByText('Choose sites', { exact: true })).toHaveCount(0)
      await electronApp.evaluate(() => { (globalThis as typeof globalThis & { importConsent: boolean }).importConsent = true })
      await panel.getByRole('button', { name: 'Continue', exact: true }).click()
      await expect(panel.getByText('Choose sites', { exact: true })).toBeVisible()
      await panel.getByRole('checkbox', { name: /127.0.0.1/ }).check()
      await expect(panel.getByRole('button', { name: 'Import into “Import destination”' })).toBeInViewport()
      await expect(panel.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
      await appWindow.screenshot({ path: testInfo.outputPath('picker.png') })
      await panel.getByRole('button', { name: 'Archive workspace', exact: true }).click()
      await expect(panel.getByRole('button', { name: 'Import into “Import destination”' })).toBeEnabled()
      await panel.getByRole('button', { name: 'Import into “Import destination”' }).click()
      await expect(panel.locator('output')).toContainText('Cookies imported: 1. Skipped: 0. Failed: 0.')
      await panel.getByRole('button', { name: 'Restore workspace', exact: true }).click()
      await panel.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(panel).toHaveCount(0)
      const targetTab = await appWindow.evaluate(async ({ id, url }) => {
        const state = await (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ mcpGroupId: id, url, active: true })
        return state.activeTabId!
      }, { id: target, url: origin })
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(w => w.getURL() === `${url}/`)
        return page?.executeJavaScript('document.body.innerText')
      }, origin)).toContain('Signed in')
      const unrelated = await appWindow.evaluate(async url => {
        const state = await (window as unknown as { hronaut: HronautApi }).hronaut.createWorkspace({ name: 'Unrelated', storage: 'scratch' })
        const group = state.mcpTabGroups.find(g => g.name === 'Unrelated')!
        const next = await (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ mcpGroupId: group.id, url: `${url}/unrelated`, active: true })
        return next.activeTabId!
      }, origin)
      expect(unrelated).not.toBe(targetTab)
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(w => w.getURL() === `${url}/unrelated`)
        return page?.executeJavaScript('document.body.innerText')
      }, origin)).toContain('Signed out')
      expect(await readFile(databasePath)).toEqual(originalDatabase)
      await expect(appWindow.getByRole('button', { name: 'Resume agents', exact: true })).toBeVisible()
    } finally {
      await source.close().catch(() => {})
      if (previousHome) await electronApp.evaluate((_electron, value) => { process.env.HOME = value }, previousHome)
      await closeFixtureServer(server)
      await removeTestDirectory(home)
    }
  })
}
