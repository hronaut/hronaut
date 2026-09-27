import type { HronautApi, HronautSettingsApi } from '../../src/shared/types.js'
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
      if (request.url === '/sw.js') {
        response.writeHead(200, { 'content-type': 'application/javascript' })
        response.end("self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', event => event.waitUntil(clients.claim()));")
        return
      }
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<title>Cookie fixture</title><main>${request.headers.cookie?.includes('fixture-auth=fixture-token') ? 'Signed in' : 'Signed out'}</main><input id="draft" aria-label="Unsaved draft">`)
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
      if (sourceBrowser === 'chromium') await source.addCookies(Array.from({ length: 775 }, (_, index) => ({ name: 'layout-fixture', value: 'test', domain: `site-${String(index).padStart(3, '0')}.test`, path: '/', expires: Math.floor(Date.now() / 1000) + 3600 })))
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
      const liveUrl = `http://localhost:${address.port}/keep-open`
      await appWindow.evaluate(async url => (window as unknown as { hronaut: HronautApi }).hronaut.navigate({ url }), liveUrl)
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url && !contents.isLoading()), liveUrl)).toBe(true)
      const liveContentsId = await electronApp.evaluate(async ({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
        await contents.executeJavaScript("document.querySelector('#draft').value = 'Keep my unsaved draft'; navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then(() => true)")
        return contents.id
      }, liveUrl)
      if (sourceBrowser === 'firefox') await appWindow.evaluate(async id => (window as unknown as { hronaut: HronautApi }).hronaut.saveAndCloseTabGroup(id), target)
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
      if (sourceBrowser === 'chromium') {
        await expect(panel.getByText('0 of 776 sites selected', { exact: true })).toBeVisible()
        for (const [width, height, scale] of [[1860, 1030, 1], [1200, 800, 1], [600, 600, 1.25]] as const) {
          await electronApp.evaluate(({ BrowserWindow }, { width, height }) => {
            const window = BrowserWindow.getAllWindows()[0]!
            window.setMinimumSize(600, 600)
            window.setSize(width, height)
          }, { width, height })
          await appWindow.evaluate(scale => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setInterfaceScale(scale), scale)
          const list = panel.locator('.browser-import-sites')
          await expect.poll(() => list.evaluate(element => element.clientHeight)).toBeGreaterThanOrEqual(220)
          await list.scrollIntoViewIfNeeded()
          expect(await list.evaluate(element => element.scrollHeight)).toBeGreaterThan(2000)
          expect(await list.evaluate(element => {
            const rect = element.getBoundingClientRect()
            const body = element.closest('.browser-import-body')!.getBoundingClientRect()
            return Math.min(rect.bottom, body.bottom) - Math.max(rect.top, body.top)
          })).toBeGreaterThanOrEqual(180)
          await expect(panel.getByRole('button', { name: 'Import into “Import destination”' })).toBeInViewport()
          await expect(panel.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
          const screenshot = await electronApp.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'))
          await writeFile(testInfo.outputPath(`picker-${width}-${scale}.png`), Buffer.from(screenshot, 'base64'))
        }
        await appWindow.evaluate(() => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setInterfaceScale(1))
        await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 900))
      }
      if (sourceBrowser === 'chromium') await panel.getByRole('button', { name: 'Select all', exact: true }).click()
      else await panel.getByRole('checkbox', { name: /127.0.0.1/ }).check()
      await expect(panel.getByRole('button', { name: 'Import into “Import destination”' })).toBeInViewport()
      await expect(panel.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport()
      await appWindow.screenshot({ path: testInfo.outputPath('picker.png') })
      await expect(panel.getByRole('button', { name: 'Import into “Import destination”' })).toBeEnabled()
      await panel.getByRole('button', { name: 'Import into “Import destination”' }).click()
      await expect(panel.locator('output')).toContainText(`Cookies imported: ${sourceBrowser === 'chromium' ? 776 : 1}. Skipped: 0. Failed: 0.`, { timeout: 30_000 })
      if (sourceBrowser === 'firefox') await panel.getByRole('button', { name: 'Restore workspace', exact: true }).click()
      else {
        expect(await electronApp.evaluate(async ({ webContents }, id) => webContents.fromId(id)?.executeJavaScript("document.querySelector('#draft').value"), liveContentsId)).toBe('Keep my unsaved draft')
        expect(await appWindow.evaluate(async id => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).mcpTabGroups.some(group => group.id === id), target)).toBe(true)
      }
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
