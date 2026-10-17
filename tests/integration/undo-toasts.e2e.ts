import type { Page } from '@playwright/test'
import { expect, test } from './fixtures.js'

interface UndoState {
  activeTabId: string | null
  tabs: Array<{ id: string; url: string; mcpGroupId?: string; active: boolean }>
  mcpTabGroups: Array<{ id: string; name: string }>
  savedTabGroups: Array<{ id: string; name: string }>
}

interface UndoApi {
  getState: () => Promise<UndoState>
  createWorkspace: (options: { name: string; storage: string }) => Promise<UndoState>
  newTab: (options: { url: string; active: boolean; mcpGroupId: string }) => Promise<UndoState>
  closeTab: (tabId: string) => Promise<UndoState>
  closeWorkspace: (workspaceId: string, options?: { undoable?: boolean }) => Promise<UndoState>
}

function state(appWindow: Page): Promise<UndoState> {
  return appWindow.evaluate(() => (window as unknown as { hronaut: UndoApi }).hronaut.getState())
}

async function workspaceTabUrls(appWindow: Page, workspaceId: string): Promise<string[]> {
  return (await state(appWindow)).tabs.filter((tab) => tab.mcpGroupId === workspaceId).map((tab) => tab.url)
}

test('offers Undo after closing tabs, closing a workspace and removing a bookmark', async ({ appWindow }) => {
  const created = await appWindow.evaluate(() => (window as unknown as { hronaut: UndoApi }).hronaut.createWorkspace({ name: 'Undo alpha', storage: 'scratch' }))
  const workspace = created.mcpTabGroups.find((group) => group.name === 'Undo alpha')!
  for (const page of ['one', 'two', 'three']) {
    await appWindow.evaluate(({ id, url }) => (window as unknown as { hronaut: UndoApi }).hronaut.newTab({ url, active: true, mcpGroupId: id }), { id: workspace.id, url: `data:text/html,<title>${page}</title>${page}` })
  }
  const urls = await workspaceTabUrls(appWindow, workspace.id)
  expect(urls.filter((url) => url.startsWith('data:'))).toHaveLength(3)
  const middle = (await state(appWindow)).tabs.find((tab) => tab.url.includes('two'))!

  // Closing a tab offers Undo, which puts the tab back where it was and shows it.
  await appWindow.evaluate((tabId) => (window as unknown as { hronaut: UndoApi }).hronaut.closeTab(tabId), middle.id)
  const toast = appWindow.getByRole('status', { name: 'Tab closed' })
  await expect(toast).toBeVisible()
  await expect(toast).toContainText('two')
  await expect.poll(() => workspaceTabUrls(appWindow, workspace.id)).toEqual(urls.filter((url) => url !== middle.url))
  await toast.getByRole('button', { name: 'Undo: Tab closed' }).click()
  await expect(toast).toBeHidden()
  await expect.poll(() => workspaceTabUrls(appWindow, workspace.id)).toEqual(urls)
  await expect.poll(async () => (await state(appWindow)).tabs.find((tab) => tab.active)?.url).toBe(middle.url)

  // Closing the workspace from its editor asks nothing, and Undo brings it back with its tabs.
  await appWindow.evaluate((id) => (window as unknown as { hronaut: UndoApi }).hronaut.closeWorkspace(id, { undoable: true }), workspace.id)
  const closed = appWindow.getByRole('status', { name: 'Workspace closed' })
  await expect(closed).toBeVisible()
  await expect(closed).toContainText('Undo alpha')
  await expect.poll(async () => (await state(appWindow)).mcpTabGroups.some((group) => group.id === workspace.id)).toBe(false)
  await closed.getByRole('button', { name: 'Undo: Workspace closed' }).click()
  await expect.poll(async () => (await state(appWindow)).mcpTabGroups.some((group) => group.id === workspace.id)).toBe(true)
  await expect.poll(async () => (await workspaceTabUrls(appWindow, workspace.id)).filter((url) => url.startsWith('data:')).length).toBe(3)
  expect((await state(appWindow)).savedTabGroups.some((group) => group.id === workspace.id)).toBe(false)

  // Dismissed, the toast lets the close finish: the workspace is deleted, not left archived.
  await appWindow.evaluate((id) => (window as unknown as { hronaut: UndoApi }).hronaut.closeWorkspace(id, { undoable: true }), workspace.id)
  await expect(closed).toBeVisible()
  await expect.poll(async () => (await state(appWindow)).savedTabGroups.some((group) => group.id === workspace.id)).toBe(true)
  await closed.getByRole('button', { name: 'Dismiss Workspace closed' }).click()
  await expect.poll(async () => (await state(appWindow)).savedTabGroups.some((group) => group.id === workspace.id)).toBe(false)
  expect((await state(appWindow)).mcpTabGroups.some((group) => group.id === workspace.id)).toBe(false)

  // A removed bookmark comes back with its id and collection.
  const bookmark = await appWindow.evaluate(async () => {
    const api = (window as unknown as { hronautBookmarks: {
      add: (url: string, title: string) => Promise<Array<{ id: string; url: string; createdAt: string }>>
      collections: { create: (name: string) => Promise<{ collections: Array<{ id: string; name: string }> }>; assign: (bookmarkId: string, collectionId: string | null) => Promise<unknown> }
      remove: (id: string) => Promise<unknown>
    } }).hronautBookmarks
    const added = (await api.add('https://example.com/undo', 'Undo example')).find((entry) => entry.url === 'https://example.com/undo')!
    const collection = (await api.collections.create('Undo reading')).collections.find((entry) => entry.name === 'Undo reading')!
    await api.collections.assign(added.id, collection.id)
    await api.remove(added.id)
    return { ...added, collectionId: collection.id }
  })
  const removed = appWindow.getByRole('status', { name: 'Bookmark removed' })
  await expect(removed).toBeVisible()
  await removed.getByRole('button', { name: 'Undo: Bookmark removed' }).click()
  await expect.poll(() => appWindow.evaluate(async (id) => {
    const api = (window as unknown as { hronautBookmarks: { list: () => Promise<Array<{ id: string; createdAt: string }>> } }).hronautBookmarks
    return (await api.list()).find((entry) => entry.id === id)?.createdAt ?? null
  }, bookmark.id)).toBe(bookmark.createdAt)
  const collectionIds = await appWindow.evaluate(async (collectionId) => {
    const api = (window as unknown as { hronautBookmarks: { collections: { list: () => Promise<{ collections: Array<{ id: string; bookmarkIds: string[] }> }> } } }).hronautBookmarks
    return (await api.collections.list()).collections.find((entry) => entry.id === collectionId)?.bookmarkIds ?? []
  }, bookmark.collectionId)
  expect(collectionIds).toContain(bookmark.id)
})
