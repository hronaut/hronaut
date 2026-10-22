import { createServer, type ServerResponse } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// The person opened a split view with a sleeping tab and closed that tab while it woke. The split view they no longer
// wanted reported the closed tab's failed load. And a sleeping tab the person picked, then left for a split view while
// it woke, replaced that split view once it woke.

test('opens no split view and reports no error when the person closes the sleeping tab it waits for', async ({ appWindow }) => {
  let holdSlow = false
  const heldSlow: ServerResponse[] = []
  let slowRequests = 0
  const server = createServer((request, response) => {
    if (request.url === '/slow' && holdSlow) {
      slowRequests += 1
      heldSlow.push(response)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end(`<!doctype html><title>${request.url}</title>${request.url}`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture server has no port')
  const base = `http://127.0.0.1:${address.port}`
  try {
    const ids = await appWindow.evaluate(async (baseUrl) => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const notes = (await api.newTab({ url: `${baseUrl}/notes`, active: true })).activeTabId!
      const slow = (await api.newTab({ url: `${baseUrl}/slow`, active: true })).activeTabId!
      await api.selectTab(notes)
      return { notes, slow }
    }, base)
    await expect.poll(() => appWindow.evaluate(async () => (
      await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    ).tabs.every(tab => !tab.loading))).toBe(true)
    await appWindow.evaluate((id) => (window as unknown as { hronaut: HronautApi }).hronaut.setTabSleeping(id, true), ids.slow)
    await expect.poll(() => appWindow.evaluate(async (id) => (
      await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    ).tabs.find(tab => tab.id === id)?.sleeping, ids.slow)).toBe(true)

    // The person opens the sleeping tab beside the notes; its site takes a while to answer.
    holdSlow = true
    await appWindow.evaluate((id) => {
      const state = window as unknown as { hronaut: HronautApi; __qaOpening?: Promise<string> }
      state.__qaOpening = state.hronaut.openSplitView(id).then(() => 'resolved', (error: unknown) => `failed: ${String(error)}`)
    }, ids.slow)
    await expect.poll(() => slowRequests).toBeGreaterThan(0)

    // They change their mind and close that tab.
    await appWindow.evaluate((id) => (window as unknown as { hronaut: HronautApi }).hronaut.closeTab(id), ids.slow)
    holdSlow = false
    for (const response of heldSlow.splice(0)) response.end()

    expect(await appWindow.evaluate(() => (window as unknown as { __qaOpening?: Promise<string> }).__qaOpening)).toBe('resolved')
    expect(await appWindow.evaluate(async () => {
      const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
      return { activeTabId: state.activeTabId, splitView: state.splitView ?? null }
    })).toEqual({ activeTabId: ids.notes, splitView: null })
  } finally {
    holdSlow = false
    for (const response of heldSlow.splice(0)) response.end()
    await closeFixtureServer(server)
  }
})

test('keeps the split view the person opens while a sleeping tab they picked before wakes', async ({ appWindow }) => {
  let holdSlow = false
  const heldSlow: ServerResponse[] = []
  let slowRequests = 0
  const server = createServer((request, response) => {
    if (request.url === '/slow' && holdSlow) {
      slowRequests += 1
      heldSlow.push(response)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end(`<!doctype html><title>${request.url}</title>${request.url}`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture server has no port')
  const base = `http://127.0.0.1:${address.port}`
  const shown = () => appWindow.evaluate(async () => {
    const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    return { activeTabId: state.activeTabId, splitView: state.splitView ?? null }
  })
  try {
    const ids = await appWindow.evaluate(async (baseUrl) => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const notes = (await api.newTab({ url: `${baseUrl}/notes`, active: true })).activeTabId!
      const reference = (await api.newTab({ url: `${baseUrl}/reference`, active: true })).activeTabId!
      const slow = (await api.newTab({ url: `${baseUrl}/slow`, active: true })).activeTabId!
      await api.selectTab(notes)
      return { notes, reference, slow }
    }, base)
    await expect.poll(() => appWindow.evaluate(async () => (
      await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    ).tabs.every(tab => !tab.loading))).toBe(true)
    await appWindow.evaluate((id) => (window as unknown as { hronaut: HronautApi }).hronaut.setTabSleeping(id, true), ids.slow)
    await expect.poll(() => appWindow.evaluate(async (id) => (
      await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    ).tabs.find(tab => tab.id === id)?.sleeping, ids.slow)).toBe(true)

    // The person picks the sleeping tab, whose site takes a while to answer.
    holdSlow = true
    await appWindow.evaluate((id) => {
      const state = window as unknown as { hronaut: HronautApi; __qaSelecting?: Promise<unknown> }
      state.__qaSelecting = state.hronaut.selectTab(id)
    }, ids.slow)
    await expect.poll(() => slowRequests).toBeGreaterThan(0)

    // Meanwhile they open the reference beside their notes.
    await appWindow.evaluate((id) => (window as unknown as { hronaut: HronautApi }).hronaut.openSplitView(id), ids.reference)
    const split = await shown()
    expect(split).toMatchObject({ activeTabId: ids.notes, splitView: { firstTabId: ids.notes, secondTabId: ids.reference } })

    // The sleeping tab finishes waking.
    holdSlow = false
    for (const response of heldSlow.splice(0)) {
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
      response.end('<!doctype html><title>/slow</title>/slow')
    }
    await appWindow.evaluate(() => (window as unknown as { __qaSelecting?: Promise<unknown> }).__qaSelecting)
    await expect.poll(() => appWindow.evaluate(async (id) => (
      await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    ).tabs.find(tab => tab.id === id)?.loading, ids.slow)).toBe(false)

    expect(await shown()).toEqual(split)
  } finally {
    holdSlow = false
    for (const response of heldSlow.splice(0)) response.end()
    await closeFixtureServer(server)
  }
})
