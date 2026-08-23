import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from './fixtures.js'

test('configures and checks updates through the Settings dialog', async ({ appWindow, profileDirectory }) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('button', { name: /Updates/ }).click()

  const startupCheck = appWindow.getByLabel('Check for updates on startup')
  await expect(startupCheck).toBeEnabled()
  await expect(startupCheck).toBeChecked()
  await startupCheck.uncheck()
  const settingsPath = join(profileDirectory, 'settings.json')
  await expect.poll(async () => JSON.parse(await readFile(settingsPath, 'utf8')).checkForUpdatesOnStartup).toBe(false)

  await appWindow.getByRole('button', { name: 'Check now' }).click()
  const updateStatus = appWindow.getByRole('region', { name: 'Software update status' })
  await expect(updateStatus).toBeVisible()
  await expect(updateStatus).toContainText('Updates unavailable')
  await expect(updateStatus).toContainText('Update checks are available in packaged builds.')
})

test('shows update status beside MCP ready and opens update details without moving the webpage', async ({
  appWindow,
  electronApp
}) => {
  await expect(appWindow.getByRole('button', { name: 'Open Hronaut Home' })).toHaveAttribute('aria-current', 'page')
  await expect(appWindow.locator('.toolbar')).toBeHidden()
  const browserViewY = async (): Promise<number | undefined> => electronApp.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0]?.contentView.children[0]?.getBounds().y
  })
  await expect.poll(browserViewY).toBe(45)
  const initialBrowserViewY = await browserViewY()

  await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window?.webContents.send('updates:changed', {
      status: 'up-to-date',
      currentVersion: '1.1.0'
    })
  })

  const upToDatePill = appWindow.getByRole('button', { name: /Open software updates: Hronaut is up to date/ })
  await expect(upToDatePill).toBeVisible()

  const [topbarBounds, pillBounds, mcpBounds] = await Promise.all([
    appWindow.locator('.topbar').boundingBox(),
    upToDatePill.boundingBox(),
    appWindow.getByRole('button', { name: /MCP ready/ }).boundingBox()
  ])
  expect(topbarBounds).not.toBeNull()
  expect(pillBounds).not.toBeNull()
  expect(mcpBounds).not.toBeNull()
  expect(pillBounds!.y).toBeGreaterThanOrEqual(topbarBounds!.y)
  expect(pillBounds!.y + pillBounds!.height).toBeLessThanOrEqual(topbarBounds!.y + topbarBounds!.height)
  expect(pillBounds!.x + pillBounds!.width).toBeLessThanOrEqual(mcpBounds!.x)
  await expect.poll(browserViewY).toBe(initialBrowserViewY)
  await expect(upToDatePill).toBeHidden({ timeout: 6_000 })

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('updates:changed', {
      status: 'available',
      currentVersion: '1.1.0',
      availableVersion: '1.1.1'
    })
  })
  const availablePill = appWindow.getByRole('button', { name: /Open software updates: Version 1\.1\.1 available/ })
  await expect(availablePill).toBeVisible()
  await expect.poll(browserViewY).toBe(initialBrowserViewY)
  await availablePill.click()
  const updatePanel = appWindow.getByRole('region', { name: 'Software update status' })
  await expect(appWindow.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await expect(updatePanel).toContainText('Hronaut 1.1.1 is available')
  await expect(updatePanel.getByRole('button', { name: 'Download update' })).toBeVisible()
})

test('renders formatted release notes and removes unsafe update content', async ({ appWindow, electronApp }) => {
  await expect(appWindow.getByRole('button', { name: 'Settings' })).toBeVisible()
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('updates:changed', {
      status: 'available',
      currentVersion: '1.4.0',
      availableVersion: '1.4.1',
      releaseNotes: `
        <div class="markdown-alert markdown-alert-warning" onclick="window.__releaseNotesXss = 1">
          <p class="markdown-alert-title"><svg onload="window.__releaseNotesXss = 2"><path /></svg>Warning</p>
          <p>Unsigned builds can show an operating-system warning.</p>
        </div>
        <h2>What's Changed</h2>
        <ul><li><strong>Formatted</strong> release notes</li></ul>
        <p><a href="https://github.com/hronaut/hronaut/releases">Release page</a></p>
        <p><a href="javascript:window.__releaseNotesXss = 3" onmouseover="window.__releaseNotesXss = 4">Unsafe link</a></p>
        <img src="missing" onerror="window.__releaseNotesXss = 5">
        <script>window.__releaseNotesXss = 6</script>
      `
    })
  })

  await appWindow.getByRole('button', { name: /Open software updates: Version 1\.4\.1 available/ }).click()
  const notes = appWindow.getByLabel('Release notes')
  await expect(notes).toBeVisible()
  await expect(notes.getByRole('heading', { name: "What's Changed" })).toBeVisible()
  await expect(notes.locator('strong')).toHaveText('Formatted')
  await expect(notes.locator('.markdown-alert-warning')).toContainText('Warning')
  await expect(notes).not.toContainText('<div class=')
  await expect(notes.locator('script, svg, img')).toHaveCount(0)
  await expect(notes.locator('a', { hasText: 'Unsafe link' })).not.toHaveAttribute('href')
  await expect(notes.getByRole('link', { name: 'Release page' })).toHaveAttribute('href', 'https://github.com/hronaut/hronaut/releases')
  await expect(notes.getByRole('link', { name: 'Release page' })).toHaveAttribute('rel', 'noopener noreferrer')
  expect(await appWindow.evaluate(() => (globalThis as typeof globalThis & { __releaseNotesXss?: number }).__releaseNotesXss)).toBeUndefined()

  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('updates:changed', {
      status: 'available',
      currentVersion: '1.4.0',
      availableVersion: '1.4.1',
      releaseNotes: '## Markdown notes\n\n- **Secure** formatting\n- `inline code`\n\n> [!NOTE]\n> Restart Hronaut after installation.'
    })
  })

  await expect(notes.getByRole('heading', { name: 'Markdown notes' })).toBeVisible()
  await expect(notes.locator('li')).toHaveCount(2)
  await expect(notes.locator('.markdown-alert-note')).toContainText('Restart Hronaut after installation.')
})

test('offers installation retry after system authorization fails', async ({ appWindow, electronApp }) => {
  await expect(appWindow.getByRole('button', { name: 'Settings' })).toBeVisible()
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('updates:changed', {
      status: 'install-error',
      currentVersion: '1.8.0',
      availableVersion: '1.9.0',
      message: 'System authorization did not complete. Hronaut is still running; try the installation again.'
    })
  })

  await appWindow.getByRole('button', { name: /Open software updates: Update needs attention/ }).click()
  const updatePanel = appWindow.getByRole('region', { name: 'Software update status' })
  await expect(updatePanel).toContainText('Hronaut is still running')
  await expect(updatePanel.getByRole('button', { name: 'Try installation again' })).toBeVisible()
  await expect(updatePanel.getByRole('button', { name: 'Try again' })).toHaveCount(0)
})
