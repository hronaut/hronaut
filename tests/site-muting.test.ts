import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applySiteMuting, applySiteMutingToTabs, canMuteSite, isSiteMuted, setSiteMuted } from '../src/main/browser/site-muting/site-muting.js'
import type { SiteMutingAccess } from '../src/main/browser/site-muting/site-muting-access.js'
import { setAllTabsMuted, setTabMuted } from '../src/main/browser/tab-muting/tab-muting.js'
import { SitePermissionStore } from '../src/main/site-permission-store.js'
import type { BrowserState } from '../src/shared/types.js'

// Chrome's Mute Site mutes a website in every tab and on its later pages, and Unmute Site forgets that. Hronaut keeps it
// per workspace, as a "sound" decision of the site permission store, which Settings lists with the other decisions.

const WORK = '01912345-6789-7abc-8def-0123456789ab'
const PERSONAL = '01912345-6789-7abc-8def-0123456789ac'

interface Tab {
  id: string
  url: string
  mcpGroupId?: string
  tabMuted: boolean
  muted: boolean
  mutedBySite: boolean
  webContents: { audioMuted: boolean; isDestroyed(): boolean; setAudioMuted(muted: boolean): void }
}

function tab(id: string, url: string, mcpGroupId: string | undefined = WORK): Tab {
  return {
    id, url, mcpGroupId, tabMuted: false, muted: false, mutedBySite: false,
    webContents: { audioMuted: false, isDestroyed: () => false, setAudioMuted(muted) { this.audioMuted = muted } }
  }
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
  let allTabsMuted = options.allTabsMuted === true
  const sitePermissionsChanged = vi.fn()
  const changed = vi.fn()
  const access: SiteMutingAccess<Tab> & { setAllTabsMutedPreference(muted: boolean): void } = {
    getTab: (id) => tabs.find((candidate) => candidate.id === id)!,
    tabs: () => tabs.values(),
    allTabsMuted: () => allTabsMuted,
    setAllTabsMutedPreference: (muted) => { allTabsMuted = muted },
    store: () => options.store === false ? null : store,
    sitePermissionsChanged,
    changed,
    getState: () => ({ tabs: [] }) as unknown as BrowserState
  }
  return { access, store, sitePermissionsChanged, changed }
}

const navigate = (access: SiteMutingAccess<Tab>, page: Tab, url: string) => {
  page.url = url
  return applySiteMuting(access, page)
}

describe('Mute Site', () => {
  it('mutes the website in every tab of the workspace, and saves it as the workspace\'s sound decision', async () => {
    const video = tab('video', 'https://video.test/watch?v=1')
    const sameSite = tab('same', 'https://video.test/other')
    const otherSite = tab('other', 'https://music.test/')
    const otherWorkspace = tab('personal', 'https://video.test/watch?v=1', PERSONAL)
    const { access, store, sitePermissionsChanged, changed } = await browser([video, sameSite, otherSite, otherWorkspace])

    await setSiteMuted(access, 'video', true)

    expect(store.list()).toEqual([{ origin: 'https://video.test', permission: 'sound', decision: 'deny', workspaceId: WORK }])
    expect([video, sameSite].map((page) => [page.muted, page.mutedBySite, page.webContents.audioMuted])).toEqual([[true, true, true], [true, true, true]])
    expect([otherSite, otherWorkspace].map((page) => [page.muted, page.webContents.audioMuted])).toEqual([[false, false], [false, false]])
    // A tab's own preference is not touched, so Unmute Site can give its sound back.
    expect(video.tabMuted).toBe(false)
    expect(isSiteMuted(access, sameSite)).toBe(true)
    expect(isSiteMuted(access, otherWorkspace)).toBe(false)
    expect(sitePermissionsChanged).toHaveBeenCalledOnce()
    expect(changed).toHaveBeenCalledOnce()
  })

  it('mutes the website\'s later pages and gives sound back on another website, as Chrome does', async () => {
    const page = tab('page', 'https://video.test/')
    const { access } = await browser([page])
    await setSiteMuted(access, 'page', true)

    expect(navigate(access, page, 'https://music.test/')).toBe(true)
    expect([page.muted, page.mutedBySite, page.webContents.audioMuted]).toEqual([false, false, false])
    expect(navigate(access, page, 'https://music.test/next')).toBe(false)
    expect(navigate(access, page, 'https://video.test/later')).toBe(true)
    expect([page.muted, page.mutedBySite, page.webContents.audioMuted]).toEqual([true, true, true])
    // Another page of the same muted website changes nothing.
    expect(navigate(access, page, 'https://video.test/again')).toBe(false)
  })

  it('lets the person unmute one tab of a muted website until its next page', async () => {
    const page = tab('page', 'https://video.test/')
    const { access } = await browser([page])
    await setSiteMuted(access, 'page', true)

    setTabMuted(access as never, 'page', false)
    expect([page.muted, page.mutedBySite, page.webContents.audioMuted]).toEqual([false, false, false])
    // Its next page of the website starts muted again.
    expect(navigate(access, page, 'https://video.test/next')).toBe(true)
    expect([page.muted, page.mutedBySite, page.webContents.audioMuted]).toEqual([true, true, true])
  })

  it('gives sound back with Unmute Site only to tabs muted for their website', async () => {
    const video = tab('video', 'https://video.test/')
    const mutedByPerson = tab('person', 'https://video.test/talk')
    mutedByPerson.tabMuted = true
    mutedByPerson.muted = true
    mutedByPerson.webContents.audioMuted = true
    const { access, store } = await browser([video, mutedByPerson])
    await setSiteMuted(access, 'video', true)

    await setSiteMuted(access, 'video', false)

    expect(store.list()).toEqual([])
    expect([video.muted, video.mutedBySite, video.webContents.audioMuted]).toEqual([false, false, false])
    expect([mutedByPerson.muted, mutedByPerson.mutedBySite, mutedByPerson.webContents.audioMuted]).toEqual([true, false, true])
  })

  it('keeps a muted website muted when every tab is unmuted again, and every tab muted when the website is unmuted', async () => {
    const video = tab('video', 'https://video.test/')
    const music = tab('music', 'https://music.test/')
    const { access } = await browser([video, music])
    await setSiteMuted(access, 'video', true)

    setAllTabsMuted(access as never, true)
    setAllTabsMuted(access as never, false)
    expect([video.muted, music.muted]).toEqual([true, false])

    setAllTabsMuted(access as never, true)
    await setSiteMuted(access, 'video', false)
    expect([video.muted, video.webContents.audioMuted, music.muted]).toEqual([true, true, true])
  })

  it('applies a decision changed or forgotten in Settings to the open tabs', async () => {
    const video = tab('video', 'https://video.test/')
    const { access, store, changed } = await browser([video])
    await store.set('https://video.test', 'sound', 'deny', { workspaceId: WORK })
    applySiteMutingToTabs(access)
    expect([video.muted, video.webContents.audioMuted]).toEqual([true, true])
    expect(changed).toHaveBeenCalledOnce()

    await store.set('https://video.test', 'sound', 'allow', { workspaceId: WORK })
    applySiteMutingToTabs(access)
    expect([video.muted, video.webContents.audioMuted]).toEqual([false, false])
    applySiteMutingToTabs(access)
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('is only for a website in a workspace, once the site permission store is there', async () => {
    const home = tab('home', 'hronaut://home/')
    const data = tab('data', 'data:text/html,<audio>')
    const loose = tab('loose', 'https://video.test/')
    delete loose.mcpGroupId
    const site = tab('site', 'https://video.test/')
    const { access } = await browser([home, data, loose, site])
    expect([home, data, loose, site].map((page) => canMuteSite(access, page))).toEqual([false, false, false, true])
    await expect(setSiteMuted(access, 'home', true)).rejects.toThrow('Only a website in a workspace can be muted')
    expect(home.muted).toBe(false)

    const { access: withoutStore } = await browser([site], { store: false })
    expect(canMuteSite(withoutStore, site)).toBe(false)
    await expect(setSiteMuted(withoutStore, 'site', true)).rejects.toThrow('Only a website in a workspace can be muted')
  })

  it('leaves a closed page alone', async () => {
    const page = tab('page', 'https://video.test/')
    page.webContents.isDestroyed = () => true
    const { access, store } = await browser([page])
    await store.set('https://video.test', 'sound', 'deny', { workspaceId: WORK })
    expect(applySiteMuting(access, page)).toBe(false)
    expect(page.muted).toBe(false)
  })
})
