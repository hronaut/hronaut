import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Hronaut had no site search: a shortcut typed before a space was the start of a search of the default engine. As in
// Chrome, Settings > Search engine > Site search keeps shortcuts that each search a site from the address bar. The
// keys are real key presses.

test('adds a site search in Settings and searches the site by its shortcut from the address bar', async ({ appWindow, profileDirectory }) => {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    const query = url.searchParams.get('q') ?? ''
    response.end(`<!doctype html><title>${url.pathname === '/search' ? `Results for ${query}` : 'Docs home'}</title><main>Docs</main>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as { port: number }).port
  const savedSiteSearches = async () => JSON.parse(await readFile(join(profileDirectory, 'settings.json'), 'utf8')).siteSearches

  try {
    await appWindow.getByRole('button', { name: 'Settings' }).click()
    await appWindow.getByRole('button', { name: /Search engine/ }).click()
    const siteSearch = appWindow.getByRole('tabpanel', { name: 'Settings' }).getByRole('region', { name: 'Site search' })
    await expect(siteSearch.getByText('No site searches yet')).toBeVisible()
    await siteSearch.getByRole('button', { name: 'Add site search' }).click()
    const form = siteSearch.getByRole('form', { name: 'Add site search' })
    await expect(form.getByLabel('Name')).toBeFocused()
    await appWindow.keyboard.type('Local docs')
    await appWindow.keyboard.press('Tab')
    await expect(form.getByLabel('Shortcut')).toBeFocused()
    await appWindow.keyboard.type('LD')
    await appWindow.keyboard.press('Tab')
    await appWindow.keyboard.type(`http://127.0.0.1:${port}/search?q=%s`)
    await appWindow.keyboard.press('Enter')
    await expect(form).toHaveCount(0)
    await expect(siteSearch.getByRole('heading', { name: 'Site search' })).toBeFocused()
    await expect(siteSearch.getByRole('listitem')).toHaveText(/Local docs\s*ld\s*http:\/\/127\.0\.0\.1:\d+\/search\?q=%s/u)
    await expect.poll(savedSiteSearches).toEqual([
      { id: expect.any(String), name: 'Local docs', keyword: 'ld', url: `http://127.0.0.1:${port}/search?q=%s` }
    ])

    // A shortcut taken already is named in the form, and nothing is saved.
    await siteSearch.getByRole('button', { name: 'Add site search' }).click()
    await appWindow.keyboard.type('Bing')
    await form.getByLabel('Shortcut').fill('bing.com')
    await form.getByLabel('URL with %s in place of query').fill('https://example.org/?q=%s')
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(form.getByLabel('Shortcut')).toHaveAccessibleDescription('This shortcut is already in use')
    await appWindow.keyboard.press('Escape')
    await expect(form).toHaveCount(0)
    await expect(appWindow.getByRole('tabpanel', { name: 'Settings' })).toBeVisible()
    await appWindow.getByRole('button', { name: 'Close settings' }).click()

    // The shortcut typed offers Tab to search the site; a space takes it, and Enter searches it.
    await appWindow.getByRole('button', { name: 'New tab' }).click()
    const address = appWindow.getByRole('combobox', { name: 'Address' })
    await address.click()
    await address.pressSequentially('ld')
    await expect(appWindow.locator('.address-keyword-hint')).toHaveText('Press Tab to search Local docs')
    await address.pressSequentially(' hello world')
    await expect(appWindow.locator('#address-keyword')).toHaveText('Search Local docs')
    await expect(address).toHaveValue('hello world')
    await address.press('Enter')
    await expect(appWindow.getByRole('tab', { name: /Results for hello world/ })).toBeVisible()
    await expect(address).toHaveValue(`http://127.0.0.1:${port}/search?q=hello%20world`)

    // With nothing after it, the shortcut goes to the site's home page.
    await address.click()
    await address.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
    await address.pressSequentially('ld')
    await address.press('Tab')
    await expect(appWindow.locator('#address-keyword')).toHaveText('Search Local docs')
    await address.press('Enter')
    await expect(appWindow.getByRole('tab', { name: /Docs home/ })).toBeVisible()

    // Edit and Delete change the list main keeps.
    await appWindow.getByRole('button', { name: 'Settings' }).click()
    await appWindow.getByRole('button', { name: /Search engine/ }).click()
    await siteSearch.getByRole('button', { name: 'Edit Local docs' }).click()
    const editForm = siteSearch.getByRole('form', { name: 'Edit site search' })
    await expect(editForm.getByLabel('Shortcut')).toHaveValue('ld')
    await editForm.getByLabel('Shortcut').fill('docs')
    await editForm.getByLabel('Shortcut').press('Enter')
    await expect.poll(async () => (await savedSiteSearches()).map((entry: { keyword: string }) => entry.keyword)).toEqual(['docs'])
    await siteSearch.getByRole('button', { name: 'Delete Local docs' }).click()
    await expect(siteSearch.getByText('No site searches yet')).toBeVisible()
    await expect(siteSearch.getByRole('heading', { name: 'Site search' })).toBeFocused()
    await expect.poll(savedSiteSearches).toEqual([])
  } finally {
    await closeFixtureServer(server)
  }
})
