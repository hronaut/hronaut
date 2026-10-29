import { createServer } from 'node:http'
import type { HronautApi, HronautPermissionsApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Chrome's Mute Site in a tab's menu mutes the website in every tab and on its later pages. Hronaut keeps it per
// workspace, as the website's Sound setting, which Settings lists, changes and forgets.

test('mutes a website in every tab of its workspace and on its later pages, until Unmute Site or Settings forgets it', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Page ${request.url!.slice(1)}</title><h1>Synthetic mute-site fixture</h1>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const site = `http://127.0.0.1:${port}`
  const otherSite = `http://localhost:${port}`
  try {
    const ids = await appWindow.evaluate(async ({ site, otherSite }) => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const open = async (name: string, urls: string[]) => {
        const created = await api.createWorkspace({ name, storage: 'scratch' })
        const workspace = created.mcpTabGroups.find(group => group.name === name)!.id
        const tabs: string[] = []
        for (const url of urls) tabs.push((await api.newTab({ url, mcpGroupId: workspace, active: true })).activeTabId!)
        return { workspace, tabs }
      }
      const clientA = await open('Client A', [`${site}/a`, `${site}/b`, `${otherSite}/c`])
      const clientB = await open('Client B', [`${site}/elsewhere`])
      await api.selectTab(clientA.tabs[0]!)
      return { clientA, clientB }
    }, { site, otherSite })
    const urls = [`${site}/a`, `${site}/b`, `${otherSite}/c`, `${site}/elsewhere`]
    const state = () => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
    await expect.poll(async () => (await state()).tabs.filter(tab => tab.url.startsWith('http')).map(tab => [tab.url, tab.loading]))
      .toEqual(urls.map(url => [url, false]))
    // Each page as the sound it plays: [tab, muted in Hronaut's state, muted page].
    const muted = async () => {
      const tabs = (await state()).tabs
      const pages = await electronApp.evaluate(({ webContents }, urls) => urls.map(url => (
        webContents.getAllWebContents().find(contents => contents.getURL() === url)?.isAudioMuted()
      )), tabs.filter(tab => tab.url.startsWith('http')).map(tab => tab.url))
      return tabs.filter(tab => tab.url.startsWith('http')).map((tab, index) => [new URL(tab.url).host === `127.0.0.1:${port}` ? 'site' : 'other', new URL(tab.url).pathname, tab.muted, pages[index]])
    }
    const decisions = () => appWindow.evaluate(() => (window as unknown as { hronautPermissions: HronautPermissionsApi }).hronautPermissions.list())

    await electronApp.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = this
      }
    })
    const choose = async (title: string, id: 'mute-site' | 'unmute-site') => {
      await electronApp.evaluate(() => { (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu = undefined })
      await appWindow.locator('.tab', { hasText: title }).first().click({ button: 'right' })
      await expect.poll(() => electronApp.evaluate(() => Boolean((globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu))).toBe(true)
      await electronApp.evaluate((_electron, id) => {
        const menu = (globalThis as typeof globalThis & { __hronautTabMenu?: Electron.Menu }).__hronautTabMenu!
        const other = menu.getMenuItemById(id === 'mute-site' ? 'unmute-site' : 'mute-site')
        const item = menu.getMenuItemById(id)
        if (other || !item?.click || !item.enabled) throw new Error(`Only an enabled ${id} item was expected in the tab menu`)
        ;(item.click as unknown as () => void)()
      }, id)
    }

    // Mute Site mutes the website in Client A's tabs, not another website's tab or the website in Client B.
    await choose('Page a', 'mute-site')
    await expect.poll(muted).toEqual([
      ['site', '/a', true, true],
      ['site', '/b', true, true],
      ['other', '/c', false, false],
      ['site', '/elsewhere', false, false]
    ])
    expect(await decisions()).toEqual([{ origin: site, permission: 'sound', decision: 'deny', workspaceId: ids.clientA.workspace }])

    // The website's next page starts muted, and a page of another website plays sound, as in Chrome.
    const navigate = (tabId: string, url: string) => appWindow.evaluate(({ tabId, url }) => (
      (window as unknown as { hronaut: HronautApi }).hronaut.navigate({ tabId, url })
    ), { tabId, url })
    await navigate(ids.clientA.tabs[2]!, `${site}/d`)
    await navigate(ids.clientA.tabs[0]!, `${otherSite}/e`)
    await expect.poll(muted).toEqual([
      ['other', '/e', false, false],
      ['site', '/b', true, true],
      ['site', '/d', true, true],
      ['site', '/elsewhere', false, false]
    ])

    // Unmute Site in a muted tab's menu gives the website's tabs their sound back and forgets the setting.
    await choose('Page b', 'unmute-site')
    await expect.poll(muted).toEqual([
      ['other', '/e', false, false],
      ['site', '/b', false, false],
      ['site', '/d', false, false],
      ['site', '/elsewhere', false, false]
    ])
    expect(await decisions()).toEqual([])

    // Forgetting the Sound setting in Settings does the same.
    await choose('Page d', 'mute-site')
    await expect.poll(async () => (await muted()).map(([, path, tabMuted]) => [path, tabMuted])).toEqual([['/e', false], ['/b', true], ['/d', true], ['/elsewhere', false]])
    await appWindow.evaluate(({ site, workspace }) => (
      (window as unknown as { hronautPermissions: HronautPermissionsApi }).hronautPermissions.remove(site, 'sound', { workspaceId: workspace })
    ), { site, workspace: ids.clientA.workspace })
    await expect.poll(muted).toEqual([
      ['other', '/e', false, false],
      ['site', '/b', false, false],
      ['site', '/d', false, false],
      ['site', '/elsewhere', false, false]
    ])
  } finally {
    await closeFixtureServer(server)
  }
})
