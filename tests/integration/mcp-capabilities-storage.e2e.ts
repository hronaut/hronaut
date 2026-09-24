import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, text } from './capability-fixtures.js'

test('scrubs oversized credential URL titles when agents add and rename bookmarks', async ({ capabilities, appWindow, profileDirectory }) => {
  const { client, fixtureUrl } = capabilities
  const added = await client.callTool({
    name: 'browser_bookmarks',
    arguments: {
      action: 'add', url: fixtureUrl,
      title: `https://person:synthetic-bookmark-secret@example.com/${'x'.repeat(4_096)}`
    }
  }) as CallToolResult
  expect(added.isError, text(added)).not.toBe(true)
  const bookmarks = JSON.parse(text(added)) as Array<{ id: string; url: string; title: string }>
  expect(bookmarks).toEqual([expect.objectContaining({ url: fixtureUrl, title: fixtureUrl })])
  const renamed = await client.callTool({
    name: 'browser_bookmarks',
    arguments: {
      action: 'rename', id: bookmarks[0]!.id,
      title: `https://person:synthetic-bookmark-secret@example.com/${'x'.repeat(32_768)}`
    }
  }) as CallToolResult
  expect(renamed.isError, text(renamed)).not.toBe(true)
  const updatedBookmarks = JSON.parse(text(renamed))
  expect(updatedBookmarks).toEqual([expect.objectContaining({ id: bookmarks[0]!.id, url: fixtureUrl, title: fixtureUrl })])
  expect(await appWindow.evaluate('window.hronautBookmarks.list()')).toEqual(updatedBookmarks)
  expect(await readFile(join(profileDirectory, 'bookmarks.json'), 'utf8')).not.toContain('synthetic-bookmark-secret')
})

test('isolates storage and manages site data, history and bookmarks', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, address, fixtureUrl, fixtureOrigin, openPageTool } = capabilities
  await appWindow.evaluate(`window.hronautPermissions.set(${JSON.stringify(fixtureOrigin)}, 'geolocation', 'allow')`)
  const protectedCookieSetup = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: "fetch('/http-only-cookie').then(() => true)" }
  }) as CallToolResult
  expect(protectedCookieSetup.isError, text(protectedCookieSetup)).not.toBe(true)
  const localStorageMetadata = await client.callTool({
    name: 'browser_storage',
    arguments: { tabId, kind: 'local-storage', action: 'list' }
  }) as CallToolResult
  expect(JSON.parse(text(localStorageMetadata))).toMatchObject({
    tabId,
    origin: fixtureOrigin,
    kind: 'local-storage',
    itemCount: 1,
    items: [expect.objectContaining({ key: 'hronaut-mcp-site-data', valueBytes: 6 })]
  })
  expect(text(localStorageMetadata)).not.toContain('"value": "stored"')
  const localStorageValue = await client.callTool({
    name: 'browser_storage',
    arguments: { tabId, kind: 'local-storage', action: 'get', key: 'hronaut-mcp-site-data' }
  }) as CallToolResult
  expect(JSON.parse(text(localStorageValue)).items).toEqual([
    expect.objectContaining({ key: 'hronaut-mcp-site-data', value: 'stored' })
  ])
  const storedDebugValue = await client.callTool({
    name: 'browser_storage',
    arguments: { tabId, kind: 'session-storage', action: 'set', key: 'debug-session', value: 'step-one' }
  }) as CallToolResult
  expect(JSON.parse(text(storedDebugValue))).toMatchObject({ changed: true, itemCount: 1 })
  const deletedDebugValue = await client.callTool({
    name: 'browser_storage',
    arguments: { tabId, kind: 'session-storage', action: 'delete', key: 'debug-session' }
  }) as CallToolResult
  expect(JSON.parse(text(deletedDebugValue))).toMatchObject({ changed: true, itemCount: 0 })
  const tabScopedStorage = await client.callTool({
    name: 'browser_storage',
    arguments: { tabId, kind: 'session-storage', action: 'set', key: 'first-tab-only', value: 'private-to-this-tab' }
  }) as CallToolResult
  expect(JSON.parse(text(tabScopedStorage))).toMatchObject({ changed: true, itemCount: 1 })
  const cookieStorage = await client.callTool({
    name: 'browser_storage',
    arguments: { tabId, kind: 'cookies', action: 'list', includeValues: true }
  }) as CallToolResult
  expect(JSON.parse(text(cookieStorage)).items).toEqual(expect.arrayContaining([
    expect.objectContaining({ key: 'hronaut-mcp-site-data', value: 'stored' }),
    expect.objectContaining({ key: 'hronaut-protected', protected: true, valueBytes: 13 })
  ]))
  expect(text(cookieStorage)).not.toContain('server-secret')

  await openPageTool('Site storage for 127.0.0.1')
  const storagePanel = appWindow.getByRole('dialog', { name: /Site storage/ })
  await expect(storagePanel).toBeVisible()
  await expect(storagePanel).toContainText('hronaut-mcp-site-data')
  await expect(storagePanel).toContainText('Shared by origin in this workspace')
  await storagePanel.getByRole('button', { name: 'Session', exact: true }).click()
  await expect(storagePanel).toContainText('first-tab-only')

  const storageIsolationTabResult = await client.callTool({
    name: 'browser_new_tab',
    arguments: { url: `http://127.0.0.1:${address.port}/`, active: true }
  }) as CallToolResult
  expect(storageIsolationTabResult.isError, text(storageIsolationTabResult)).not.toBe(true)
  const storageIsolationTabId = JSON.parse(text(storageIsolationTabResult)).activeTabId as string
  await client.callTool({ name: 'browser_wait', arguments: { tabId: storageIsolationTabId } })
  await expect(storagePanel).toBeHidden()
  await openPageTool('Site storage for 127.0.0.1')
  await storagePanel.getByRole('button', { name: 'Session', exact: true }).click()
  await expect(storagePanel).not.toContainText('first-tab-only')
  await storagePanel.getByRole('button', { name: 'Close site storage' }).click()
  await client.callTool({ name: 'browser_close_tab', arguments: { tabId: storageIsolationTabId } })
  await client.callTool({ name: 'browser_select_tab', arguments: { tabId } })

  await openPageTool('Site storage for 127.0.0.1')
  await storagePanel.getByRole('button', { name: 'Cookies' }).click()
  await expect(storagePanel).toContainText('hronaut-protected')
  await expect(storagePanel).toContainText('HttpOnly value protected')
  await expect(storagePanel).not.toContainText('server-secret')
  await storagePanel.getByRole('button', { name: 'Close site storage' }).click()

  const inspectedSiteData = await client.callTool({
    name: 'browser_site_data',
    arguments: { action: 'inspect', origin: `${fixtureOrigin}/` }
  }) as CallToolResult
  expect(JSON.parse(text(inspectedSiteData))).toMatchObject({
    origin: fixtureOrigin,
    cookieCount: 2,
    historyEntries: 2
  })
  const clearedSiteData = await client.callTool({
    name: 'browser_site_data',
    arguments: { action: 'clear', origin: fixtureOrigin, dataTypes: ['cookies-and-storage', 'cache'] }
  }) as CallToolResult
  expect(JSON.parse(text(clearedSiteData))).toMatchObject({
    origin: fixtureOrigin,
    cleared: ['cookies-and-storage', 'cache'],
    remaining: { cookieCount: 0, historyEntries: 2 }
  })
  const rejectedWholeProfileClear = await client.callTool({
    name: 'browser_site_data',
    arguments: { action: 'clear', origin: fixtureOrigin }
  }) as CallToolResult
  expect(rejectedWholeProfileClear.isError).toBe(true)
  expect(text(rejectedWholeProfileClear)).toContain('select at least one category')
  const rejectedUnsafeOrigin = await client.callTool({
    name: 'browser_site_data',
    arguments: { action: 'inspect', origin: 'file:///tmp/not-a-website' }
  }) as CallToolResult
  expect(rejectedUnsafeOrigin.isError).toBe(true)
  expect(text(rejectedUnsafeOrigin)).toContain('valid HTTP or HTTPS')
  await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedOrigin) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(requestedOrigin))
    return page?.executeJavaScript("localStorage.getItem('hronaut-mcp-site-data')")
  }, fixtureOrigin)).toBeNull()

  await expect.poll(async () => {
    const result = await client.callTool({
      name: 'browser_visit_history',
      arguments: { action: 'list', query: 'Capability fixture' }
    }) as CallToolResult
    return JSON.parse(text(result))
  }).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: 'Capability fixture', url: `http://127.0.0.1:${address.port}/` }),
    expect.objectContaining({ title: 'Capability fixture', url: fixtureUrl })
  ]))
  const listedHistory = await client.callTool({
    name: 'browser_visit_history',
    arguments: { action: 'list', query: 'Capability fixture' }
  }) as CallToolResult
  const historyEntry = (JSON.parse(text(listedHistory)) as Array<{ id: string; url: string }>)
    .find((entry) => entry.url === `http://127.0.0.1:${address.port}/`)
  if (!historyEntry) throw new Error('MCP did not return the recorded visit')
  const reopenedHistory = await client.callTool({
    name: 'browser_visit_history',
    arguments: { action: 'open', id: historyEntry.id, active: false }
  }) as CallToolResult
  const reopenedHistoryState = JSON.parse(text(reopenedHistory)) as { tabs: Array<{ id: string; url: string }> }
  expect(reopenedHistoryState.tabs).toEqual(expect.arrayContaining([
    expect.objectContaining({ url: `http://127.0.0.1:${address.port}/` })
  ]))
  const reopenedHistoryTab = reopenedHistoryState.tabs.find((tab) => tab.id !== tabId && tab.url === `http://127.0.0.1:${address.port}/`)
  if (!reopenedHistoryTab) throw new Error('MCP did not reopen the recorded visit')
  await client.callTool({ name: 'browser_wait', arguments: { tabId: reopenedHistoryTab.id } })
  const clearedHistory = await client.callTool({
    name: 'browser_visit_history',
    arguments: { action: 'clear' }
  }) as CallToolResult
  expect(JSON.parse(text(clearedHistory))).toEqual([])

  const bookmarkUrl = `http://127.0.0.1:${address.port}/`
  const addedBookmarks = await client.callTool({
    name: 'browser_bookmarks',
    arguments: { action: 'add', url: bookmarkUrl, title: 'Capability bookmark' }
  }) as CallToolResult
  const bookmark = (JSON.parse(text(addedBookmarks)) as Array<{ id: string; url: string; title: string }>)[0]
  if (!bookmark) throw new Error('MCP did not return the added bookmark')
  expect(bookmark).toMatchObject({ url: bookmarkUrl, title: 'Capability bookmark' })
  const listedBookmarks = await client.callTool({ name: 'browser_bookmarks', arguments: { action: 'list' } }) as CallToolResult
  expect(JSON.parse(text(listedBookmarks))).toEqual([expect.objectContaining({ id: bookmark.id })])
  const renamedBookmarks = await client.callTool({
    name: 'browser_bookmarks',
    arguments: { action: 'rename', id: bookmark.id, title: 'Renamed capability' }
  }) as CallToolResult
  expect(JSON.parse(text(renamedBookmarks))).toEqual([expect.objectContaining({ title: 'Renamed capability' })])
  const openedBookmark = await client.callTool({
    name: 'browser_bookmarks',
    arguments: { action: 'open', id: bookmark.id, active: false }
  }) as CallToolResult
  expect(JSON.parse(text(openedBookmark)).tabs).toEqual(expect.arrayContaining([
    expect.objectContaining({ url: bookmarkUrl })
  ]))
  const removedBookmarks = await client.callTool({
    name: 'browser_bookmarks',
    arguments: { action: 'remove', id: bookmark.id }
  }) as CallToolResult
  expect(JSON.parse(text(removedBookmarks))).toEqual([])
})
