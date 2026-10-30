import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// A tab whose page could not reach its website, such as one restored at login before the network was up, kept showing
// the failure until the person reloaded it. As in Chrome, the page now loads again by itself once the website answers.

test('loads a page that could not reach its website again by itself once the website answers', async ({ appWindow }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end('<!doctype html><title>Dev server is back</title><main>Dev server is back</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as AddressInfo).port
  await closeFixtureServer(server)
  const url = `http://127.0.0.1:${port}/app`
  const activeTab = () => appWindow.evaluate(async () => {
    const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    const tab = state.tabs.find(candidate => candidate.id === state.activeTabId)
    return tab && { title: tab.title, problem: tab.pageProblem?.errorDescription ?? null }
  })
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    await expect.poll(async () => (await activeTab())?.problem).toBe('ERR_CONNECTION_REFUSED')
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
    // Tries come 1 s after the failure, then 5 s after each failed one.
    await expect.poll(activeTab, { timeout: 20_000 }).toEqual({ title: 'Dev server is back', problem: null })
  } finally {
    if (server.listening) await closeFixtureServer(server)
  }
})
