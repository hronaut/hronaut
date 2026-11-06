import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

type TestWindow = { hronaut: HronautApi }
type Tabs = { tabs: Array<{ id: string, url: string, title: string }>, closedTabs: Array<{ title: string, url: string }> }

// A tab whose page crashed is titled Page unavailable. It was remembered so in Recently closed, and reopened so until
// its page loaded; Chrome's Recently closed names it by its page.
test('a closed tab whose page crashed is remembered and reopened by its page\'s title', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Quarterly report</title><h1>Report</h1>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/report`
  const state = () => appWindow.evaluate(() => (window as unknown as TestWindow).hronaut.getState()) as Promise<Tabs>
  try {
    await appWindow.evaluate(address => (window as unknown as TestWindow).hronaut.newTab({ url: address, active: true }), url)
    await expect.poll(async () => (await state()).tabs.find(tab => tab.url === url)?.title).toBe('Quarterly report')
    await electronApp.evaluate(({ webContents }, address) => new Promise<void>(resolve => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === address)
      if (!page) throw new Error('Report page was not found')
      page.once('render-process-gone', () => resolve())
      page.forcefullyCrashRenderer()
    }), url)
    await expect.poll(async () => (await state()).tabs.find(tab => tab.url === url)?.title).toBe('Page unavailable')

    const tabId = (await state()).tabs.find(tab => tab.url === url)!.id
    await appWindow.evaluate(id => (window as unknown as TestWindow).hronaut.closeTab(id), tabId)
    await expect.poll(async () => (await state()).closedTabs.map(tab => tab.title)).toEqual(['Quarterly report'])

    await appWindow.evaluate(() => (window as unknown as TestWindow).hronaut.reopenClosedTab())
    const reopened = await state()
    expect(reopened.tabs.find(tab => tab.url === url)?.title).toBe('Quarterly report')
    await expect.poll(async () => (await state()).tabs.find(tab => tab.url === url)?.title).toBe('Quarterly report')
  } finally {
    await closeFixtureServer(server)
  }
})
