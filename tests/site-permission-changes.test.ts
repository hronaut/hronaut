import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildBrowserState } from '../src/main/browser/browser-state/browser-state.js'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import { applySitePermissionChanges } from '../src/main/browser/site-permission-changes/site-permission-changes.js'
import { SitePermissionStore } from '../src/main/site-data/site-permission-store.js'

// The browser below stubs changed, which publishing the state goes through.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed(...args: unknown[]): void }, ...args: unknown[]) => browser.changed(...args)
}))

// Blocking a website's camera or location in Site controls or Settings left a page already using it going on, with
// nothing saying the change applies once the page loads again. As Chrome's site information does, its tabs now offer to
// reload it, until another document replaces it.

const WORK = '01912345-6789-7abc-8def-0123456789ab'
const PERSONAL = '01912345-6789-7abc-8def-0123456789ac'

function tab(id: string, url: string, fields: Partial<BrowserTab> = {}): BrowserTab {
  return {
    id, url, mcpGroupId: WORK, documentGeneration: 3, sleeping: false,
    tabMuted: false, muted: false, mutedBySite: false, siteMuteApplied: false,
    webContents: { isDestroyed: () => false, setAudioMuted: vi.fn() },
    ...fields
  } as unknown as BrowserTab
}

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function browser(tabs: BrowserTab[]) {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-site-permission-changes-'))
  directories.push(directory)
  const store = new SitePermissionStore(join(directory, 'site-permissions.json'))
  await store.load()
  const changed = vi.fn()
  const manager = {
    tabs: new Map(tabs.map((page) => [page.id, page])),
    allTabsMuted: false,
    options: { sitePermissionStore: () => store },
    changed
  } as unknown as Browser
  return { manager, store, changed }
}

const offered = (manager: Browser) => [...manager.tabs.values()].filter((page) => page.permissionReloadOffered === page.documentGeneration)
  .map((page) => page.id)

describe('a permission the person changed or forgot', () => {
  it('offers to reload each tab of its workspace that shows the website, once', async () => {
    const { manager, changed } = await browser([
      tab('maps', 'https://maps.test/route'),
      tab('also-maps', 'https://maps.test/other#here'),
      tab('other-site', 'https://video.test/'),
      tab('other-port', 'https://maps.test:8443/'),
      tab('other-workspace', 'https://maps.test/route', { mcpGroupId: PERSONAL }),
      tab('outside', 'https://maps.test/route', { mcpGroupId: undefined }),
      tab('sleeping', 'https://maps.test/route', { sleeping: true }),
      tab('closing', 'https://maps.test/route', { webContents: { isDestroyed: () => true } } as unknown as Partial<BrowserTab>)
    ])
    applySitePermissionChanges(manager, [{ origin: 'https://maps.test', permission: 'geolocation', workspaceId: WORK }])
    expect(offered(manager)).toEqual(['maps', 'also-maps'])
    expect(changed).toHaveBeenCalledOnce()
    expect(changed).toHaveBeenCalledWith(false)

    // Another change of the same page offers nothing more.
    applySitePermissionChanges(manager, [{ origin: 'https://maps.test', permission: 'media', workspaceId: WORK }])
    expect(changed).toHaveBeenCalledOnce()

    // A tab that loaded again since offers it again for its new document.
    manager.tabs.get('maps')!.documentGeneration = 4
    applySitePermissionChanges(manager, [{ origin: 'https://maps.test', permission: 'geolocation', workspaceId: WORK }])
    expect(offered(manager)).toEqual(['maps', 'also-maps'])
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('offers it, for a website embedded in another\'s page, on the pages of that other website', async () => {
    const { manager } = await browser([tab('call', 'https://meet.test/room'), tab('widget', 'https://widget.test/')])
    applySitePermissionChanges(manager, [
      { origin: 'https://widget.test', permission: 'media', workspaceId: WORK, embeddedIn: 'https://meet.test' }
    ])
    expect(offered(manager)).toEqual(['call'])
  })

  it('mutes or unmutes the website at once for its sound, and offers no reload for it', async () => {
    const setAudioMuted = vi.fn()
    const page = tab('video', 'https://video.test/watch', { webContents: { isDestroyed: () => false, setAudioMuted } } as unknown as Partial<BrowserTab>)
    const { manager, store, changed } = await browser([page])
    await store.set('https://video.test', 'sound', 'deny', { workspaceId: WORK })
    applySitePermissionChanges(manager, [{ origin: 'https://video.test', permission: 'sound', workspaceId: WORK }])
    expect(page.muted).toBe(true)
    expect(setAudioMuted).toHaveBeenCalledWith(true)
    expect(offered(manager)).toEqual([])
    expect(changed).toHaveBeenCalledOnce()
  })
})

/** A stand-in for whatever the state reads on the browser: any call or property gives another stand-in. */
function anything(): unknown {
  const stand: unknown = new Proxy(() => undefined, {
    get: (_target, key) => key === 'then' || key === Symbol.iterator ? undefined : stand,
    apply: () => stand
  })
  return stand
}

/** The published state of one tab, with the fields given. */
function stateOf(shown: Partial<BrowserTab>) {
  const page = {
    id: 'tab', title: 'Maps', url: 'https://maps.test/', loading: false, observationGeneration: 0, navigationGeneration: 0, documentGeneration: 3,
    pinned: false, sleeping: false, networkRoutes: [], inspectorIssues: [],
    webContents: { session: {}, isDestroyed: () => false, getZoomFactor: () => 1, isDevToolsOpened: () => false },
    ...shown
  }
  const own: Record<string, unknown> = {
    tabs: new Map([['tab', page]]), mcpTabGroups: new Map(), closedTabs: [], activeTabId: 'tab', splitView: null,
    listMcpTabGroups: () => [], listSavedTabGroups: () => [], agentFollow: undefined, options: { profilePath: '/profile' },
    isTabTakenOver: () => false
  }
  const fallback = anything() as Record<string | symbol, unknown>
  const state = new Proxy({}, { get: (_target, key) => (typeof key === 'string' && key in own ? own[key] : fallback[key]) })
  return buildBrowserState(state as never).tabs[0]!
}

describe('the offer to reload in the tab\'s state', () => {
  it('stands while the tab shows the document it was made for, awake', () => {
    expect(stateOf({})).not.toHaveProperty('permissionReloadOffered')
    expect(stateOf({ permissionReloadOffered: 3 }).permissionReloadOffered).toBe(true)
    expect(stateOf({ permissionReloadOffered: 3, documentGeneration: 4 })).not.toHaveProperty('permissionReloadOffered')
    expect(stateOf({ permissionReloadOffered: 3, sleeping: true })).not.toHaveProperty('permissionReloadOffered')
  })
})
