import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('reviews and saves frozen text evidence that remains inert when opened offline', async ({ appWindow, electronApp, profileDirectory, browser }) => {
  let unsafeRequests = 0
  const server = createServer((request, response) => {
    if (request.url?.includes('should-not-run')) unsafeRequests++
    response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'fixture=cookie-secret; HttpOnly; SameSite=Lax' })
    response.end('<html><title>Incident fixture</title><h1>Ready</h1></html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  const url = `${origin}/?token=network-secret`
  const destination = join(profileDirectory, 'incident.html')
  const offline = await browser.newContext({ offline: true })
  try {
    const state = await appWindow.evaluate(async url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    const tabId = state.activeTabId!
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    await expect(page.getByRole('heading', { name: 'Ready' })).toBeVisible()
    const hostile = `private-canary </pre><script>globalThis.__incidentAttack=true;fetch('${origin}/should-not-run')</script><img src="${origin}/should-not-run"> password=credential-secret`
    await page.evaluate(value => console.error(value), hostile)
    await expect.poll(async () => {
      const report = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.createDebugReport({ tabId }), tabId)
      return report.console.some(entry => entry.message.includes('private-canary'))
    }).toBe(true)
    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: 'Create debug report' }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Debug report' })
    await panel.getByText('Reviewed incident package', { exact: true }).click()
    await panel.getByRole('checkbox', { name: 'Console and diagnostics', exact: true }).check()
    await panel.getByRole('checkbox', { name: 'Sanitized network entries', exact: true }).check()
    await panel.getByRole('button', { name: 'Capture selected evidence' }).click()
    await panel.getByLabel('Exact text to replace (optional)').fill('console')
    await panel.getByLabel('Replace with').fill('network')
    await panel.getByRole('button', { name: 'Preview exact package' }).click()
    await expect(panel.getByRole('alert')).toContainText('would merge fields')
    await expect(panel.getByRole('button', { name: 'Save reviewed HTML' })).toHaveCount(0)
    await expect(panel.locator('iframe')).toHaveCount(0)
    await panel.getByLabel('Replace with').fill('[REDACTED]')
    await panel.getByLabel('Exact text to replace (optional)').fill('private-canary')
    await panel.getByRole('button', { name: 'Preview exact package' }).click()
    const iframe = panel.locator('iframe[title="Preview exact package"]')
    await expect(iframe).toBeVisible()
    const previewHtml = (await iframe.getAttribute('srcdoc'))!
    expect(previewHtml).not.toContain('private-canary')
    expect(previewHtml).not.toContain('credential-secret')
    expect(previewHtml).not.toContain('cookie-secret')
    expect(previewHtml).not.toContain('network-secret')
    expect(previewHtml).toContain('&lt;script&gt;')
    const save = panel.getByRole('button', { name: 'Save reviewed HTML' })
    await expect(save).toBeDisabled()
    await panel.getByRole('checkbox', { name: /I reviewed this package/ }).check()
    await electronApp.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' }) })
    await save.click()
    await expect(save).toBeEnabled()
    await expect(access(destination)).rejects.toThrow()
    await page.evaluate(() => console.error('later-live-evidence'))
    await electronApp.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, destination)
    await save.click()
    await expect(panel.getByRole('status')).toHaveText('Reviewed package saved locally.')
    const html = await readFile(destination, 'utf8')
    expect(html).toBe(previewHtml)
    expect(html).not.toContain('later-live-evidence')
    const hash = createHash('sha256').update(html).digest('hex')
    await expect(panel).toContainText(hash)
    const source = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.createDebugReport({ tabId }), tabId)
    expect(source.console.some(entry => entry.message.includes('private-canary'))).toBe(true)

    // A separate fresh browser context opens only the saved file, with no Hronaut state.
    let remoteRequests = 0
    offline.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests++ })
    const opened = await offline.newPage()
    await opened.goto(pathToFileURL(destination).href)
    await expect(opened.getByRole('heading', { name: 'Hronaut reviewed incident', exact: true })).toBeVisible()
    expect(await opened.locator('script, img, iframe, link, object, embed, form').count()).toBe(0)
    expect(await opened.evaluate(() => '__incidentAttack' in globalThis)).toBe(false)
    const texts = await opened.locator('pre').allTextContents()
    const manifest = JSON.parse(texts[0]!) as { artifacts: Array<{ sha256?: string }> }
    expect(manifest.artifacts.filter(a => a.sha256).map(a => a.sha256)).toEqual(texts.slice(1).map(text => createHash('sha256').update(text).digest('hex')))
    expect(remoteRequests).toBe(0)
    expect(unsafeRequests).toBe(0)
  } finally {
    await offline.close()
    await closeFixtureServer(server)
  }
})
