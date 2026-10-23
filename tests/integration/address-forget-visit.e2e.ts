import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

// Chrome's address bar forgets a suggested visit with Shift+Delete; Hronaut's kept suggesting every visit.
test('forgets the highlighted visit with Shift+Delete in the address bar, as in Chrome', async ({ profileDirectory, mcpPort }) => {
  const now = Date.now()
  const visit = (name: string, ageSeconds: number) => ({
    id: `${name}-visit`,
    url: `https://${name}.example/`,
    title: `Guide ${name}`,
    visitedAt: new Date(now - ageSeconds * 1_000).toISOString(),
    visitCount: 1
  })
  await writeFile(join(profileDirectory, 'history.json'), JSON.stringify({
    version: 1,
    entries: [visit('guide-a', 1), visit('guide-b', 2), visit('guide-c', 3)]
  }), 'utf8')
  const savedAt = new Date(now).toISOString()
  await writeFile(join(profileDirectory, 'bookmarks.json'), JSON.stringify({
    version: 1,
    bookmarks: [{ id: 'saved', url: 'https://guide-saved.example/', title: 'Guide saved', createdAt: savedAt, updatedAt: savedAt }]
  }), 'utf8')

  const instance = await launchHronaut(profileDirectory, mcpPort)
  try {
    await instance.window.evaluate('window.hronaut.newTab({ active: true })')
    const address = instance.window.getByRole('combobox', { name: 'Address', exact: true })
    await address.fill('guide')
    const options = instance.window.locator('#address-suggestions [role="option"]')
    await expect(options).toHaveCount(4)
    const ids = await options.evaluateAll(nodes => nodes.map(node => node.id))
    expect(ids.slice(0, 3).every(id => id.startsWith('address-suggestion-history:'))).toBe(true)
    expect(ids[3]).toBe('address-suggestion-bookmark:saved')

    await address.press('ArrowDown')
    await address.press('ArrowDown')
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
    await address.press('Shift+Delete')

    // The visit is gone from the suggestions and from history, the next row is highlighted, and the typed text stays.
    await expect(options).toHaveCount(3)
    await expect(instance.window.locator(`[id="${ids[1]}"]`)).toHaveCount(0)
    await expect(options.nth(1)).toHaveAttribute('id', ids[2]!)
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(address).toHaveValue('guide')
    const forgotten = ids[1]!.slice('address-suggestion-history:'.length)
    await expect.poll(async () => (await instance.window.evaluate('window.hronautHistory.list()') as Array<{ id: string }>).map(entry => entry.id))
      .not.toContain(forgotten)
    await expect.poll(async () => await readFile(join(profileDirectory, 'history.json'), 'utf8')).not.toContain(forgotten)

    // A bookmark is not a visit, so Shift+Delete leaves it. Forgetting the visit above it then goes through history
    // again, and the bookmark takes that visit's place.
    await address.press('ArrowDown')
    await expect(options.nth(2)).toHaveAttribute('id', 'address-suggestion-bookmark:saved')
    await expect(options.nth(2)).toHaveAttribute('aria-selected', 'true')
    await address.press('Shift+Delete')
    await address.press('ArrowUp')
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
    await address.press('Shift+Delete')
    const remaining = ids[0]!.slice('address-suggestion-history:'.length)
    await expect.poll(async () => (await instance.window.evaluate('window.hronautHistory.list()') as Array<{ id: string }>).map(entry => entry.id))
      .toEqual([remaining])
    await expect(options).toHaveCount(2)
    await expect(options.nth(1)).toHaveAttribute('id', 'address-suggestion-bookmark:saved')
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(address).toHaveValue('guide')
    expect(await instance.window.evaluate('window.hronautBookmarks.list()')).toEqual([expect.objectContaining({ id: 'saved' })])
  } finally {
    await closeHronaut(instance.app)
  }
})
