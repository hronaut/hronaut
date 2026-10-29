import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applySiteMuting, applySiteMutingToTabs, canMuteSite, isSiteMuted, setSiteMuted } from '../src/main/browser/site-muting/site-muting.js'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import { setAllTabsMuted, setTabMuted } from '../src/main/browser/tab-muting/tab-muting.js'
import { SitePermissionStore } from '../src/main/site-data/site-permission-store.js'

vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({
  publishChange: (browser: { changed(...args: unknown[]): void }, ...args: unknown[]) => browser.changed(...args),
  browserState: (browser: { getState(): unknown }) => browser.getState()
}))
import type { BrowserState } from '../src/shared/types.js'

// Chrome's Mute Site mutes a website in every tab and on its later pages, and Unmute Site forgets that. Hronaut keeps it
// per workspace, as a "sound" decision of the site permission store, which Settings lists with the other decisions.

const WORK = '01912345-6789-7abc-8def-0123456789ab'
const PERSONAL = '01912345-6789-7abc-8def-0123456789ac'

interface TabFields {
  id: string
  url: string
  mcpGroupId?: string
  tabMuted: boolean
  muted: boolean
  mutedBySite: boolean
  siteMuteApplied: boolean
  webContents: { audioMuted: boolean; isDestroyed(): boolean; setAudioMuted(muted: boolean): void }
}

type Tab = TabFields & BrowserTab

function tab(id: string, url: string, mcpGroupId: string | undefined = WORK): Tab {
  return {
    id, url, mcpGroupId, tabMuted: false, muted: false, mutedBySite: false, siteMuteApplied: false,
    webContents: { audioMuted: false, isDestroyed: () => false, setAudioMuted(muted: boolean) { this.audioMuted = muted } }
  } as Tab
}

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

/** Tabs and a real site permission store in a folder of its own, seen as the tab manager shows them. */
async function browser(tabs: Tab[], options: { allTabsMuted?: boolean; store?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-site-muting-'))
  directories.push(directory)
  const store = new SitePermissionStore(join(directory, 'site-permissions.json'))
  await store.load()
  const sitePermissionsChanged = vi.fn()
  const changed = vi.fn()
  const manager = {
    tabs: new Map(tabs.map((page) => [page.id, page])),
    allTabsMuted: options.allTabsMuted === true,
    options: {
      sitePermissionStore: () => options.store === false ? null : store,
      onSitePermissionsChanged: sitePermissionsChanged
    },
    changed,
    getState: () => ({ tabs: [] }) as unknown as BrowserState
  } as unknown as Browser
  return { manager, store, sitePermissionsChanged, changed }
}

const navigate = (manager: Browser, page: Tab, url: string) => {
  page.url = url
  return applySiteMuting(manager, page)
}

describe('Mute Site', () => {
  it('mutes the website in every tab of the workspace, and saves it as the workspace\'s sound decision', async () => {
    const video = tab('video', 'https://video.test/watch?v=1')
    const sameSite = tab('same', 'https://video.test/other')
    const otherSite = tab('other', 'https://music.test/')
    const otherWorkspace = tab('personal', 'https://video.test/watch?v=1', PERSONAL)
    const { manager, store, sitePermissionsChanged, changed } = await browser([video, sameSite, otherSite, otherWorkspace])

    await setSiteMuted(manager, 'video', true)

    expect(store.list()).toEqual([{ origin: 'https://video.test', permission: 'sound', decision: 'deny', workspaceId: WORK }])
    expect([video, sameSite].map((page) => [page.muted, page.mutedBySite, page.webContents.audioMuted])).toEqual([[true, true, true], [true, true, true]])
    expect([otherSite, otherWorkspace].map((page) => [page.muted, page.webContents.audioMuted])).toEqual([[false, false], [false, false]])
    // A tab's own preference is not touched, so Unmute Site can give its sound back.
    expect(video.tabMuted).toBe(false)
    expect(isSiteMuted(manager, sameSite)).toBe(true)
    expect(isSiteMuted(manager, otherWorkspace)).toBe(false)
    expect(sitePermissionsChanged).toHaveBeenCalledOnce()
    expect(changed).toHaveBeenCalledOnce()
  })

  it('mutes the website\'s later pages and gives sound back on another website, as Chrome does', async () => {
    const page = tab('page', 'https://video.test/')
    const { manager } = await browser([page])
    await setSiteMuted(manager, 'page', true)

    expect(navigate(manager, page, 'https://music.test/')).toBe(true)
    expect([page.muted, page.mutedBySite, page.webContents.audioMuted]).toEqual([false, false, false])
    expect(navigate(manager, page, 'https://music.test/next')).toBe(false)
    expect(navigate(manager, page, 'https://video.test/later')).toBe(true)
    expect([page.muted, page.mutedBySite, page.webContents.audioMuted]).toEqual([true, true, true])
    // Another page of the same muted website changes nothing.
    expect(navigate(manager, page, 'https://video.test/again')).toBe(false)
  })

  it('lets the person unmute one tab of a muted website until its next page', async () => {
    const page = tab('page', 'https://video.test/')
    const { manager } = await browser([page])
    await setSiteMuted(manager, 'page', true)

    setTabMuted(manager, 'page', false)
    expect([page.muted, page.mutedBySite, page.webContents.audioMuted]).toEqual([false, false, false])
    // Its next page of the website starts muted again.
    expect(navigate(manager, page, 'https://video.test/next')).toBe(true)
    expect([page.muted, page.mutedBySite, page.webContents.audioMuted]).toEqual([true, true, true])
  })

  // Muting or unmuting another website, or any other change of the saved site permissions, muted it again.
  it('keeps that tab unmuted when another website\'s sound or another permission changes', async () => {
    const video = tab('video', 'https://video.test/')
    const music = tab('music', 'https://music.test/')
    const { manager, store } = await browser([video, music])
    await setSiteMuted(manager, 'video', true)
    setTabMuted(manager, 'video', false)

    await setSiteMuted(manager, 'music', true)
    expect([music.muted, music.webContents.audioMuted]).toEqual([true, true])
    await setSiteMuted(manager, 'music', false)
    await store.set('https://video.test', 'notifications', 'allow', { workspaceId: WORK })
    applySiteMutingToTabs(manager)
    await store.remove('https://video.test', 'notifications', { workspaceId: WORK })
    applySiteMutingToTabs(manager)

    expect([video.muted, video.mutedBySite, video.webContents.audioMuted]).toEqual([false, false, false])
    expect(navigate(manager, video, 'https://video.test/next')).toBe(true)
    expect([video.muted, video.webContents.audioMuted]).toEqual([true, true])
  })

  it('gives sound back with Unmute Site only to tabs muted for their website', async () => {
    const video = tab('video', 'https://video.test/')
    const mutedByPerson = tab('person', 'https://video.test/talk')
    mutedByPerson.tabMuted = true
    mutedByPerson.muted = true
    mutedByPerson.webContents.audioMuted = true
    const { manager, store } = await browser([video, mutedByPerson])
    await setSiteMuted(manager, 'video', true)

    await setSiteMuted(manager, 'video', false)

    expect(store.list()).toEqual([])
    expect([video.muted, video.mutedBySite, video.webContents.audioMuted]).toEqual([false, false, false])
    expect([mutedByPerson.muted, mutedByPerson.mutedBySite, mutedByPerson.webContents.audioMuted]).toEqual([true, false, true])
  })

  it('keeps a muted website muted when every tab is unmuted again, and every tab muted when the website is unmuted', async () => {
    const video = tab('video', 'https://video.test/')
    const music = tab('music', 'https://music.test/')
    const { manager } = await browser([video, music])
    await setSiteMuted(manager, 'video', true)

    setAllTabsMuted(manager, true)
    setAllTabsMuted(manager, false)
    expect([video.muted, music.muted]).toEqual([true, false])

    setAllTabsMuted(manager, true)
    await setSiteMuted(manager, 'video', false)
    expect([video.muted, video.webContents.audioMuted, music.muted]).toEqual([true, true, true])
  })

  it('applies a decision changed or forgotten in Settings to the open tabs', async () => {
    const video = tab('video', 'https://video.test/')
    const { manager, store, changed } = await browser([video])
    await store.set('https://video.test', 'sound', 'deny', { workspaceId: WORK })
    applySiteMutingToTabs(manager)
    expect([video.muted, video.webContents.audioMuted]).toEqual([true, true])
    // The tabs' saved mute preferences stay as they are, so there is nothing to save.
    expect(changed).toHaveBeenCalledExactlyOnceWith(false)

    await store.set('https://video.test', 'sound', 'allow', { workspaceId: WORK })
    applySiteMutingToTabs(manager)
    expect([video.muted, video.webContents.audioMuted]).toEqual([false, false])
    applySiteMutingToTabs(manager)
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('is only for a website in a workspace, once the site permission store is there', async () => {
    const home = tab('home', 'hronaut://home/')
    const data = tab('data', 'data:text/html,<audio>')
    const loose = tab('loose', 'https://video.test/')
    delete loose.mcpGroupId
    const site = tab('site', 'https://video.test/')
    const { manager } = await browser([home, data, loose, site])
    expect([home, data, loose, site].map((page) => canMuteSite(manager, page))).toEqual([false, false, false, true])
    await expect(setSiteMuted(manager, 'home', true)).rejects.toThrow('Only a website in a workspace can be muted')
    expect(home.muted).toBe(false)

    const { manager: withoutStore } = await browser([site], { store: false })
    expect(canMuteSite(withoutStore, site)).toBe(false)
    await expect(setSiteMuted(withoutStore, 'site', true)).rejects.toThrow('Only a website in a workspace can be muted')
  })

  it('leaves a closed page alone', async () => {
    const page = tab('page', 'https://video.test/')
    page.webContents.isDestroyed = () => true
    const { manager, store } = await browser([page])
    await store.set('https://video.test', 'sound', 'deny', { workspaceId: WORK })
    expect(applySiteMuting(manager, page)).toBe(false)
    expect(page.muted).toBe(false)
  })
})
