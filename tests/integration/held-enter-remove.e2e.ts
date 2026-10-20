import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import type { HronautApi, HronautBookmarksApi, HronautHistoryApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

/**
 * Presses Enter on the first of `removes` and keeps it held once that row is gone, sending each repeat, at a
 * keyboard's usual pace, only once the next row's Remove has the focus and can be pressed.
 */
async function holdEnterOnFirstRemove(page: Page, removes: Locator, rows: number): Promise<void> {
  await expect(removes.first()).toBeEnabled()
  await removes.first().focus()
  await expect(removes.first()).toBeFocused()
  await page.keyboard.down('Enter')
  await expect(removes).toHaveCount(rows - 1)
  for (let repeat = 0; repeat < 6; repeat += 1) {
    await page.waitForTimeout(50)
    // Remove hands its focus to the next row's Remove, and History's now does too.
    await expect(removes.first()).toBeEnabled()
    await expect(removes.first()).toBeFocused()
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
    // New presses still remove the next one.
    await appWindow.keyboard.press('Enter')
    await expect(bookmarkRemoves).toHaveCount(2)
    await expect(bookmarkRemoves.first()).toBeFocused()
    await appWindow.keyboard.press('Enter')
    await expect(bookmarkRemoves).toHaveCount(1)
    await expect(bookmarkRemoves.first()).toBeFocused()
    // Removing the last one hands the focus to Close, and the held Enter used to close Bookmarks with it.
    const close = bookmarks.getByRole('button', { name: 'Close bookmarks' })
    await appWindow.keyboard.down('Enter')
    await expect(bookmarkRemoves).toHaveCount(0)
    for (let repeat = 0; repeat < 6; repeat += 1) {
      await appWindow.waitForTimeout(50)
      await expect(close).toBeFocused()
      await appWindow.keyboard.down('Enter')
    }
    await appWindow.keyboard.up('Enter')
    await expect(bookmarks).toBeVisible()

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

test('a held Enter on Forget in site permissions forgets one decision', async ({ appWindow, profileDirectory }) => {
  const origins = ['https://one.example.test', 'https://two.example.test', 'https://three.example.test', 'https://four.example.test']
  // A new decision belongs to a workspace.
  const created = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Held decisions', storage: 'scratch' })`) as {
    mcpTabGroups: Array<{ id: string, name: string }>
  }
  const workspaceId = created.mcpTabGroups.find(group => group.name === 'Held decisions')!.id
  for (const origin of origins) {
    await appWindow.evaluate(`window.hronautPermissions.set(${JSON.stringify(origin)}, 'geolocation', 'allow', { workspaceId: ${JSON.stringify(workspaceId)} })`)
  }
  await appWindow.getByRole('button', { name: 'Settings', exact: true }).click()
  await appWindow.getByRole('button', { name: 'Site permissions' }).click()
  const forgets = appWindow.getByRole('button', { name: /^Forget Location permission for .+ \(Held decisions\)$/ })
  await expect(forgets).toHaveCount(4)
  await holdEnterOnFirstRemove(appWindow, forgets, 4)
  // Forget hands its focus to the next decision's Forget, and each repeat used to forget that one too.
  await expect.poll(async () => JSON.parse(await readFile(join(profileDirectory, 'site-permissions.json'), 'utf8')).permissions.length)
    .toBe(3)
  await expect(forgets).toHaveCount(3)
})
