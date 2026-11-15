import { createServer } from 'node:http'
import type { ElectronApplication, Page } from '@playwright/test'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

type TestWindow = { hronaut: HronautApi }

// A tab whose page crashed was retitled Page unavailable. The saved session and an archived workspace kept it so, and
// it came back so, asleep, until its page loaded again; Chrome's crashed tab keeps its page's title and comes back by it.

async function reportServer() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end('<!doctype html><title>Quarterly report</title><h1>Report</h1>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/report` }
}

const titleOf = (window: Page, url: string) => window.evaluate(async (address) => (
  (await (window as unknown as TestWindow).hronaut.getState()).tabs.find(tab => tab.url === address)?.title
), url)
const problemOf = (window: Page, url: string) => window.evaluate(async (address) => (
  (await (window as unknown as TestWindow).hronaut.getState()).tabs.find(tab => tab.url === address)?.pageProblem?.kind
), url)

/** Opens the page in a tab, crashes its page and shows another tab, which leaves the crashed tab behind. */
async function crashBehind(app: ElectronApplication, window: Page, url: string, mcpGroupId?: string): Promise<void> {
  await window.evaluate(({ url, mcpGroupId }) => (
    (window as unknown as TestWindow).hronaut.newTab({ url, active: true, ...(mcpGroupId ? { mcpGroupId } : {}) })
  ), { url, mcpGroupId })
  await expect.poll(() => titleOf(window, url)).toBe('Quarterly report')
  await app.evaluate(({ webContents }, address) => new Promise<void>((resolve) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === address)
    if (!page) throw new Error('Report page was not found')
    page.once('render-process-gone', () => resolve())
    page.forcefullyCrashRenderer()
  }), url)
  await expect.poll(() => problemOf(window, url)).toBe('renderer-gone')
  expect(await titleOf(window, url)).toBe('Quarterly report')
  await window.evaluate(mcpGroupId => (
    (window as unknown as TestWindow).hronaut.newTab({ url: 'data:text/html,<title>Other</title>', active: true, ...(mcpGroupId ? { mcpGroupId } : {}) })
  ), mcpGroupId)
}

test('a tab whose page crashed comes back by its page\'s title after a restart', async ({ profileDirectory, mcpPort }) => {
  const { server, url } = await reportServer()
  let running: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    running = await launchHronaut(profileDirectory, mcpPort)
    await crashBehind(running.app, running.window, url)
    await closeHronaut(running.app)
    running = undefined

    running = await launchHronaut(profileDirectory, mcpPort)
    const { window } = running
    await expect.poll(() => titleOf(window, url)).toBe('Quarterly report')
    // It comes back asleep, behind the tab shown at quit, so the title is the saved one, not its page's again.
    expect((await window.evaluate(() => (window as unknown as TestWindow).hronaut.getState())).tabs.find(tab => tab.url === url)?.sleeping).toBe(true)
  } finally {
    if (running) await closeHronaut(running.app)
    await closeFixtureServer(server)
  }
})

test('an archived workspace keeps a tab whose page crashed by its page\'s title', async ({ appWindow, electronApp }) => {
  const { server, url } = await reportServer()
  try {
    const workspace = await appWindow.evaluate(async () => {
      const state = await (window as unknown as TestWindow).hronaut.createWorkspace({ name: 'Reports', storage: 'scratch' })
      return state.mcpTabGroups.find(group => group.name === 'Reports')!.id
    })
    await crashBehind(electronApp, appWindow, url, workspace)
    await appWindow.evaluate(id => (window as unknown as TestWindow).hronaut.saveAndCloseTabGroup(id), workspace)
    await expect.poll(() => appWindow.evaluate(async ({ id, url }) => (
      (await (window as unknown as TestWindow).hronaut.getState()).savedTabGroups.find(group => group.id === id)?.tabs.find(tab => tab.url === url)?.title
    ), { id: workspace, url })).toBe('Quarterly report')
  } finally {
    await closeFixtureServer(server)
  }
})
