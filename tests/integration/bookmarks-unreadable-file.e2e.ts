import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('keeps a bookmarks file it cannot read aside instead of replacing it with the next bookmark', async ({ profileDirectory, mcpPort }) => {
  const now = new Date().toISOString()
  const saved = JSON.stringify({
    version: 1,
    bookmarks: [1, 2, 3].map((index) => ({ id: `saved-${index}`, url: `https://example.com/${index}`, title: `Saved ${index}`, createdAt: now, updatedAt: now }))
  })
  // Cut short, as a disk error or a sync tool can leave it.
  const unreadable = saved.slice(0, -3)
  await writeFile(join(profileDirectory, 'bookmarks.json'), unreadable, 'utf8')

  const instance = await launchHronaut(profileDirectory, mcpPort)
  try {
    await expect.poll(() => instance.window.evaluate('window.hronautBookmarks.list()')).toEqual([])
    // Nothing is moved before a bookmark is saved, so a newer Hronaut opened again still finds the file.
    expect(await readFile(join(profileDirectory, 'bookmarks.json'), 'utf8')).toBe(unreadable)
    await instance.window.evaluate(`window.hronautBookmarks.add('https://example.com/new', 'New')`)
    await expect.poll(async () => JSON.parse(await readFile(join(profileDirectory, 'bookmarks.json'), 'utf8')).bookmarks.map((bookmark: { title: string }) => bookmark.title))
      .toEqual(['New'])
    const aside = (await readdir(profileDirectory)).filter((name) => name.startsWith('bookmarks.json.unreadable-'))
    expect(aside).toHaveLength(1)
    expect(await readFile(join(profileDirectory, aside[0]!), 'utf8')).toBe(unreadable)
  } finally {
    await closeHronaut(instance.app)
  }
})
