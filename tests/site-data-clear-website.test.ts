import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { createSiteData } from '../src/main/site-data/site-data.js'

vi.mock('electron', () => ({
  session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => tmpdir() }, powerMonitor: { on: () => undefined }
}))
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist)
}))
// The fake browser below stands in for the workspace's session, which Clear data for this website clears.
vi.mock('../src/main/browser/workspace-data/workspace-data.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-data/workspace-data.js')>(),
  withWorkspaceSiteDataCleanup: (browser: { withWorkspaceSiteDataCleanup: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.withWorkspaceSiteDataCleanup(...args)
}))

function tab(id: string, url: string, mcpGroupId: string, extra: Record<string, unknown> = {}) {
  return { id, url, mcpGroupId, sleeping: false, documentGeneration: 4, webContents: { isDestroyed: () => false }, ...extra }
}

describe('Clear data for this website', () => {
  it('clears the website\'s cookies, storage and cache in the workspace, keeps its history, and offers to reload its pages', async () => {
    const cookies = [
      { name: 'sid', domain: 'shop.example', hostOnly: true, path: '/', secure: true, httpOnly: true },
      { name: 'other', domain: 'news.example', hostOnly: true, path: '/', secure: true, httpOnly: false }
    ]
    const browserSession = {
      cookies: {
        get: vi.fn(async () => [...cookies]),
        remove: vi.fn(async (url: string, name: string) => {
          const index = cookies.findIndex((cookie) => cookie.name === name && url.startsWith(`https://${cookie.domain}`))
          if (index >= 0) cookies.splice(index, 1)
        })
      },
      clearData: vi.fn(async () => undefined),
      clearStorageData: vi.fn(async () => undefined)
    }
    const shown = tab('shown', 'https://shop.example/cart', 'workspace')
    const asleep = tab('asleep', 'https://shop.example/orders', 'workspace', { sleeping: true })
    const elsewhere = tab('elsewhere', 'https://shop.example/', 'other-workspace')
    const otherSite = tab('other-site', 'https://news.example/', 'workspace')
    const changed = vi.fn()
    const history = { list: () => [{ url: 'https://shop.example/cart', visitCount: 2 }], clearOrigin: vi.fn(async () => undefined) }
    const { clearWebsiteData } = createSiteData({
      tabs: () => ({
        tabs: new Map([shown, asleep, elsewhere, otherSite].map((entry) => [entry.id, entry])),
        changed,
        withWorkspaceSiteDataCleanup: (_workspaceId: string, clear: (session: unknown) => Promise<unknown>) => clear(browserSession)
      }) as never,
      historyStore: () => history as never,
      publishVisitHistory: () => undefined
    })

    const remaining = await clearWebsiteData('workspace', 'https://shop.example/cart')

    expect(browserSession.clearData).toHaveBeenCalledExactlyOnceWith({
      dataTypes: ['backgroundFetch', 'cache', 'fileSystems', 'indexedDB', 'localStorage', 'serviceWorkers', 'webSQL'],
      origins: ['https://shop.example'],
      originMatchingMode: 'origin-in-all-contexts'
    })
    expect(browserSession.cookies.remove).toHaveBeenCalledExactlyOnceWith('https://shop.example/', 'sid')
    expect(history.clearOrigin).not.toHaveBeenCalled()
    expect(remaining).toEqual({ origin: 'https://shop.example', cookieCount: 0, historyEntries: 1, historyVisits: 2 })
    // The page shown in the workspace still holds what it read, so it offers to reload, once, without saving the session.
    expect(shown).toHaveProperty('permissionReloadOffered', 4)
    for (const other of [asleep, elsewhere, otherSite]) expect(other).not.toHaveProperty('permissionReloadOffered')
    expect(changed).toHaveBeenCalledExactlyOnceWith(false)

    await clearWebsiteData('workspace', 'https://shop.example/')
    expect(changed).toHaveBeenCalledOnce()
  })
})
