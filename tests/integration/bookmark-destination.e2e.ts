import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HronautBookmarksApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('edits a bookmark destination by ID with collision recovery and keyboard focus', async ({ appWindow, electronApp, profileDirectory }, testInfo) => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<h1>Updated bookmark destination</h1>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    const before = await appWindow.evaluate(async origin => {
      const api = (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks
      await api.add(`${origin}/old`, 'Destination fixture')
      await api.add(`${origin}/occupied`, 'Other fixture')
      return (await api.list()).find(entry => entry.title === 'Destination fixture')!
    }, origin)
    await appWindow.getByRole('button', { name: 'New tab' }).click()
    await appWindow.getByRole('button', { name: 'Bookmarks', exact: true }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Bookmarks' })
    const edit = panel.getByRole('button', { name: 'Edit address for Destination fixture' })
    await edit.click()
    const input = panel.getByRole('textbox', { name: 'Edit address for Destination fixture' })
    await expect(input).toBeFocused()
    await input.fill(`${origin}/cancelled`)
    await input.press('Escape')
    await expect(edit).toBeFocused()
    await edit.click()
    await expect(input).toHaveValue(before.url)
    await input.fill(`${origin}/occupied`)
    await input.press('Enter')
    await expect(panel.getByRole('alert')).toContainText('already bookmarked')
    await expect(input).toHaveValue(`${origin}/occupied`)
    const nextUrl = `${origin}/new`
    await input.fill(nextUrl.replace('http://', 'http://synthetic:never-save@'))
    await input.press('Enter')
    await expect(edit).toBeFocused()
    await expect(input).toHaveCount(0)
    const after = await appWindow.evaluate(async id => {
      const api = (window as unknown as { hronautBookmarks: HronautBookmarksApi }).hronautBookmarks
      return (await api.list()).find(entry => entry.id === id)
    }, before.id)
    expect(after).toMatchObject({ id: before.id, createdAt: before.createdAt, title: before.title, url: nextUrl })
    const persisted = await readFile(join(profileDirectory, 'bookmarks.json'), 'utf8')
    expect(persisted).not.toContain('never-save')
    expect(JSON.parse(persisted).bookmarks).toContainEqual(after)
    await panel.getByRole('button', { name: 'Close bookmarks' }).click()
    await appWindow.getByRole('button', { name: 'Bookmarks', exact: true }).click()
    await edit.click()
    await expect(input).toHaveValue(nextUrl)
    await testInfo.attach('bookmark-destination-editor', { body: await panel.screenshot(), contentType: 'image/png' })
    await input.press('Escape')
    await panel.getByRole('button', { name: `Destination fixture ${nextUrl}`, exact: true }).click()
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(page => page.getURL() === url && !page.isLoading()), nextUrl)).toBe(true)
  } finally {
    await closeFixtureServer(server)
  }
})
