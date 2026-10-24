import { EventEmitter } from 'node:events'
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setZoom } from '../src/main/browser/page-zoom/page-zoom.js'
import { attachSiteZoom, rememberSiteZoom, siteZoomHost, SiteZoomStore } from '../src/main/browser/site-zoom/site-zoom.js'
import type { SiteZoomAccess, SiteZoomLevels, SiteZoomTab } from '../src/main/browser/site-zoom/site-zoom-access.js'
import type { BrowserState } from '../src/shared/types.js'

const atomicWrite = vi.hoisted(() => ({ failing: false }))
vi.mock('../src/main/atomic-file.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/atomic-file.js')>()
  return {
    ...actual,
    writeTextFileAtomically: async (...args: Parameters<typeof actual.writeTextFileAtomically>) => {
      if (atomicWrite.failing) throw Object.assign(new Error('The file is in use'), { code: 'EBUSY' })
      return actual.writeTextFileAtomically(...args)
    }
  }
})

const WORK = '0b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b'
const OTHER = '1b6f5a4e-2c1d-4e3f-9a8b-7c6d5e4f3a2b'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  atomicWrite.failing = false
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'hronaut-site-zoom-'))
  cleanups.push(() => rm(path, { recursive: true, force: true }))
  return path
}

function page(url: string): WebContents & EventEmitter {
  let factor = 1
  let address = url
  return Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    getURL: () => address,
    getZoomFactor: () => factor,
    setZoomFactor: (next: number) => { factor = next },
    navigate: (next: string) => { address = next }
  }) as unknown as WebContents & EventEmitter
}

function fixture(url = 'https://docs.example/guide', overrides: Partial<SiteZoomTab> = {}, levels: SiteZoomLevels = new Map()) {
  const webContents = page(url)
  const tab: SiteZoomTab = { id: 'tab', webContents, zoomIsolated: false, sleeping: false, nativeInputEnvironmentGeneration: 0, ...overrides }
  const changed = vi.fn()
  const access: SiteZoomAccess<SiteZoomTab> = {
    findTab: (tabId) => tabId === tab.id ? tab : undefined,
    storageId: () => WORK,
    levels: () => levels,
    changed
  }
  attachSiteZoom(access, tab, webContents)
  const navigate = (next: string) => {
    (webContents as unknown as { navigate(url: string): void }).navigate(next)
    webContents.emit('did-navigate', {}, next)
  }
  return { tab, webContents, access, levels, changed, navigate, percent: () => Math.round(webContents.getZoomFactor() * 100) }
}

describe('the site a zoom goes by', () => {
  it('is the host of a website, whatever its scheme, port or path, as Chromium keeps it', () => {
    expect(siteZoomHost('https://Docs.Example:8443/guide?q=1#top')).toBe('docs.example')
    expect(siteZoomHost('http://127.0.0.1:5173/')).toBe('127.0.0.1')
    expect(siteZoomHost('http://[::1]:8080/')).toBe('[::1]')
  })

  it('is none for a page that is not a website', () => {
    for (const url of ['hronaut://home/', 'about:blank', 'data:text/html,hi', 'file:///tmp/a.html', 'not a url']) expect(siteZoomHost(url)).toBeUndefined()
  })
})

describe("keeping a site's zoom", () => {
  it('keeps the zoom a page now has for its site and workspace, and forgets it back at 100%', () => {
    const { tab, access, levels } = fixture()
    expect(rememberSiteZoom(access, tab, 125)).toBe(true)
    expect(levels).toEqual(new Map([[WORK, new Map([['docs.example', 125]])]]))
    expect(rememberSiteZoom(access, tab, 125)).toBe(false)
    expect(rememberSiteZoom(access, tab, 100)).toBe(true)
    expect(levels).toEqual(new Map())
    expect(rememberSiteZoom(access, tab, 100)).toBe(false)
  })

  it('keeps none for a tab with its own zoom, a page that is not a website or a tab without a workspace', () => {
    const isolated = fixture(undefined, { zoomIsolated: true })
    expect(rememberSiteZoom(isolated.access, isolated.tab, 150)).toBe(false)
    const home = fixture('hronaut://home/')
    expect(rememberSiteZoom(home.access, home.tab, 150)).toBe(false)
    const loose = fixture()
    expect(rememberSiteZoom({ ...loose.access, storageId: () => undefined }, loose.tab, 150)).toBe(false)
    expect(loose.levels.size).toBe(0)
  })

  it('forgets the site zoomed longest ago once a workspace keeps 1,000', () => {
    const { tab, access, levels, webContents } = fixture()
    const at = (host: string) => { (webContents as unknown as { navigate(url: string): void }).navigate(`https://${host}/`) }
    for (let index = 0; index < 1_000; index += 1) { at(`site${index}.example`); rememberSiteZoom(access, tab, 110) }
    // Zoomed again, the first site becomes the most recent.
    at('site0.example')
    rememberSiteZoom(access, tab, 125)
    at('new.example')
    rememberSiteZoom(access, tab, 150)
    const sites = levels.get(WORK)!
    expect(sites.size).toBe(1_000)
    expect(sites.has('site1.example')).toBe(false)
    expect([...sites.keys()].slice(-2)).toEqual(['site0.example', 'new.example'])
  })

  it('is kept by every zoom of a page, from the zoom bar, the keyboard, the wheel or an agent', () => {
    const { tab, access, levels } = fixture()
    const zoomed = vi.fn((zoomedTab: SiteZoomTab, percent: number) => { rememberSiteZoom(access, zoomedTab, percent) })
    const zoomAccess = { getTab: () => tab, changed: vi.fn(), getState: () => ({}) as BrowserState, zoomed }
    setZoom(zoomAccess, { action: 'in' })
    setZoom(zoomAccess, { action: 'set', percent: 175 })
    expect(zoomed.mock.calls.map(([, percent]) => percent)).toEqual([110, 175])
    expect(levels.get(WORK)?.get('docs.example')).toBe(175)
    setZoom(zoomAccess, { action: 'reset' })
    expect(levels.size).toBe(0)
  })
})

describe("a page opening at its site's zoom", () => {
  it('gets the zoom kept for its site as its document commits', () => {
    // After a restart every site opened at 100%, as Electron keeps each site's zoom only while it runs.
    const { navigate, percent, changed, tab } = fixture('about:blank', {}, new Map([[WORK, new Map([['docs.example', 150]])]]))
    navigate('https://docs.example/guide')
    expect(percent()).toBe(150)
    expect(changed).toHaveBeenCalledWith(false)
    expect(tab.nativeInputEnvironmentGeneration).toBe(1)
    // Another site keeps the zoom Chromium gives it.
    navigate('https://other.example/')
    expect(percent()).toBe(150)
    expect(changed).toHaveBeenCalledOnce()
  })

  it('leaves a page already at that zoom, a tab with its own zoom and a sleeping tab as they are', () => {
    const levels: SiteZoomLevels = new Map([[WORK, new Map([['docs.example', 150]])]])
    const isolated = fixture('about:blank', { zoomIsolated: true }, levels)
    isolated.navigate('https://docs.example/')
    expect(isolated.percent()).toBe(100)
    const sleeping = fixture('about:blank', { sleeping: true }, levels)
    sleeping.navigate('https://docs.example/')
    expect(sleeping.percent()).toBe(100)
    const zoomed = fixture('about:blank', {}, levels)
    zoomed.webContents.setZoomFactor(1.5)
    zoomed.navigate('https://docs.example/')
    expect(zoomed.changed).not.toHaveBeenCalled()
  })

  it("takes the zoom of the tab's own workspace only", () => {
    const { navigate, percent } = fixture('about:blank', {}, new Map([[OTHER, new Map([['docs.example', 150]])]]))
    navigate('https://docs.example/')
    expect(percent()).toBe(100)
  })
})

describe('the saved site zoom', () => {
  it('is kept readable only by the person and read back', async () => {
    const path = join(await directory(), 'site-zoom.json')
    const levels: SiteZoomLevels = new Map([[WORK, new Map([['docs.example', 125], ['127.0.0.1', 80]])], [OTHER, new Map([['docs.example', 200]])]])
    await new SiteZoomStore(path).save(() => levels)
    expect((await lstat(path)).mode & 0o777).toBe(0o600)
    expect(await new SiteZoomStore(path).load()).toEqual(levels)
  })

  it('does not write what the file holds already, nor anything once the browser closed', async () => {
    const path = join(await directory(), 'site-zoom.json')
    const store = new SiteZoomStore(path)
    await store.save(() => new Map([[WORK, new Map([['docs.example', 125]])]]))
    const written = (await lstat(path)).mtimeMs
    await new Promise((resolve) => setTimeout(resolve, 20))
    await store.save(() => new Map([[WORK, new Map([['docs.example', 125]])]]))
    await store.save(() => undefined)
    expect((await lstat(path)).mtimeMs).toBe(written)
  })

  it("leaves out entries that are not a workspace's zoom for a website", async () => {
    const path = join(await directory(), 'site-zoom.json')
    await writeFile(path, JSON.stringify({ version: 1, workspaces: [
      { storageId: WORK, sites: [
        { host: 'docs.example', percent: 125 },
        { host: 'a/b', percent: 125 },
        { host: 'Upper.example', percent: 125 },
        { host: 'hundred.example', percent: 100 },
        { host: 'small.example', percent: 30 },
        { host: 'fraction.example', percent: 125.5 },
        'not a site'
      ] },
      { storageId: WORK.toUpperCase(), sites: [{ host: 'twice.example', percent: 150 }] },
      { storageId: 'not-a-storage', sites: [{ host: 'docs.example', percent: 150 }] },
      { storageId: OTHER, sites: [] },
      'not a workspace'
    ] }))
    expect(await new SiteZoomStore(path).load()).toEqual(new Map([[WORK, new Map([['docs.example', 125]])]]))
  })

  it('starts at 100% from a missing, linked, foreign or unreadable file', async () => {
    const root = await directory()
    expect(await new SiteZoomStore(join(root, 'missing.json')).load()).toEqual(new Map())
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const valid = JSON.stringify({ version: 1, workspaces: [{ storageId: WORK, sites: [{ host: 'docs.example', percent: 125 }] }] })
    await writeFile(join(root, 'real.json'), valid)
    await symlink(join(root, 'real.json'), join(root, 'link.json'))
    expect(await new SiteZoomStore(join(root, 'link.json')).load()).toEqual(new Map())
    await writeFile(join(root, 'other.json'), valid.replace('"version":1', '"version":2'))
    expect(await new SiteZoomStore(join(root, 'other.json')).load()).toEqual(new Map())
    await writeFile(join(root, 'broken.json'), '{')
    expect(await new SiteZoomStore(join(root, 'broken.json')).load()).toEqual(new Map())
  })

  it('removes the file when a save fails, so a zoom reset since does not come back', async () => {
    const path = join(await directory(), 'site-zoom.json')
    const store = new SiteZoomStore(path)
    await store.save(() => new Map([[WORK, new Map([['docs.example', 125]])]]))
    atomicWrite.failing = true
    await expect(store.save(() => new Map())).rejects.toThrow('The file is in use')
    await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    atomicWrite.failing = false
    await store.save(() => new Map([[WORK, new Map([['docs.example', 150]])]]))
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 1, workspaces: [{ storageId: WORK, sites: [{ host: 'docs.example', percent: 150 }] }] })
  })
})
