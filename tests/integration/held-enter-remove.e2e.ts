import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import type { CredentialStorageStatus, CredentialSummary, HronautApi, HronautBookmarksApi, HronautHistoryApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

/**
 * Presses Enter on the first of `removes` and keeps it held once that row is gone and the next row's Remove has the
 * focus, with repeats at a keyboard's usual pace.
 */
async function holdEnterOnFirstRemove(page: Page, removes: Locator, rows: number): Promise<void> {
  await removes.first().focus()
  await page.keyboard.down('Enter')
  await expect(removes).toHaveCount(rows - 1)
  // Remove hands its focus to the next row's Remove. History's live list can take that focus elsewhere first, so it
  // is given here rather than waited for.
  await removes.first().focus()
  for (let repeat = 0; repeat < 6; repeat += 1) {
    await page.waitForTimeout(50)
    await page.keyboard.down('Enter')
  }
  await page.keyboard.up('Enter')
  // Wait for a removal still under way, which disables the list's controls, to finish.
  await expect(removes.and(page.locator(':disabled, [aria-disabled="true"]'))).toHaveCount(0)
}

test('a held Enter on Remove in Bookmarks or History removes one row', async ({ appWindow }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<title>Held Enter page ${request.url!.slice(1)}</title><p>Page</p>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  try {
    await appWindow.evaluate(async () => {
      const api = (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks
      for (let index = 1; index <= 4; index += 1) await api.add(`https://example.test/${index}`, `Saved page ${index}`)
    })
    for (let index = 1; index <= 4; index += 1) {
      const url = `http://127.0.0.1:${address.port}/${index}`
      await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
      await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
        .then(state => state.tabs.find(tab => tab.active)?.title))).toBe(`Held Enter page ${index}`)
    }

    await appWindow.getByRole('button', { name: /^Bookmarks/ }).first().click()
    const bookmarks = appWindow.getByRole('dialog', { name: 'Bookmarks' })
    const bookmarkRemoves = bookmarks.getByRole('button', { name: /^Remove Saved page/ })
    await expect(bookmarkRemoves).toHaveCount(4)
    await holdEnterOnFirstRemove(appWindow, bookmarkRemoves, 4)
    // Each repeat used to remove the next bookmark, so holding Enter a moment removed them all.
    expect(await appWindow.evaluate(() => (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks.list()
      .then(list => list.length))).toBe(3)
    await expect(bookmarkRemoves).toHaveCount(3)
    // A new press still removes the next one.
    await appWindow.keyboard.press('Enter')
    await expect(bookmarkRemoves).toHaveCount(2)

    await appWindow.getByRole('button', { name: 'Browsing history' }).click()
    const history = appWindow.getByRole('dialog', { name: 'Browsing history' })
    const historyRemoves = history.getByRole('button', { name: /^Remove Held Enter page \d from history$/ })
    await expect(historyRemoves).toHaveCount(4)
    await holdEnterOnFirstRemove(appWindow, historyRemoves, 4)
    expect(await appWindow.evaluate(() => (window as unknown as { hronautHistory: HronautHistoryApi }).hronautHistory.list()
      .then(list => list.filter(entry => entry.title.startsWith('Held Enter page')).length))).toBe(3)
    await expect(historyRemoves).toHaveCount(3)
  } finally {
    await closeFixtureServer(server)
  }
})

test('a held Enter on Remove in saved passwords removes one password', async ({ appWindow, electronApp, profileDirectory }) => {
  const status = await appWindow.evaluate('window.hronautCredentials.status()') as CredentialStorageStatus
  console.log('[held-enter] credential storage available:', status.available)
  // Without secure storage nothing can be saved, as credentials.e2e.ts checks.
  if (!status.available) {
    await expect(appWindow.evaluate('window.hronautCredentials.importFromCsv()')).rejects.toThrow(status.reason)
    return
  }
  const csvPath = join(profileDirectory, 'held-enter-passwords.csv')
  await writeFile(csvPath, [
    'name,url,username,password,note',
    'One,https://one.example/login,first-person,first-secret,',
    'Two,https://two.example/login,second-person,second-secret,',
    'Three,https://three.example/login,third-person,third-secret,'
  ].join('\n'), { encoding: 'utf8', mode: 0o600 })
  await electronApp.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  }, csvPath)
  expect(await appWindow.evaluate('window.hronautCredentials.importFromCsv()')).toMatchObject({ added: 3 })

  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('button', { name: 'Passwords' }).click()
  const removes = appWindow.getByRole('button', { name: /^Remove saved password for / })
  await expect(removes).toHaveCount(3)
  await holdEnterOnFirstRemove(appWindow, removes, 3)
  // Each repeat used to remove the next saved password.
  expect((await appWindow.evaluate('window.hronautCredentials.list()') as CredentialSummary[]).length).toBe(2)
  await expect(removes).toHaveCount(2)
})
