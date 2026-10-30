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

test('leaves a page a form sent that could not reach its website as it is, as Chrome does', async ({ appWindow, electronApp }) => {
  const requests: string[] = []
  const server = createServer((request, response) => {
    // The page's icon is asked for once it shows, whenever that is.
    if (request.url === '/favicon.ico') {
      response.writeHead(404).end()
      return
    }
    requests.push(`${request.method} ${request.url}`)
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end('<!doctype html><title>Form page</title><form method="post" action="/send#sent"><input name="note" value="hi"></form>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as AddressInfo).port
  const sent = `http://127.0.0.1:${port}/send#sent`
  const activeProblem = () => appWindow.evaluate(async () => {
    const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    return state.tabs.find(candidate => candidate.id === state.activeTabId)?.pageProblem ?? null
  })
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), `http://127.0.0.1:${port}/form`)
    await expect.poll(() => requests).toEqual(['GET /form'])
    await closeFixtureServer(server)
    // The form is sent while the website cannot be reached.
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
      if (!page) throw new Error('The form page was not found')
      void page.executeJavaScript('document.forms[0].submit()')
    }, `http://127.0.0.1:${port}/form`)
    await expect.poll(activeProblem).toMatchObject({ url: sent, errorDescription: 'ERR_CONNECTION_REFUSED' })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
    // A page that was asked for loads again a second after it failed; the form's page does not.
    await new Promise(resolve => setTimeout(resolve, 2_500))
    expect(requests).toEqual(['GET /form'])
    expect(await activeProblem()).toMatchObject({ url: sent, errorDescription: 'ERR_CONNECTION_REFUSED' })
  } finally {
    if (server.listening) await closeFixtureServer(server)
  }
})
