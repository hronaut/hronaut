import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('keeps keyboard position when clearing retained website history', async ({ appWindow }) => {
  const servers = Array.from({ length: 3 }, () => createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<title>History focus fixture</title>')
  }))
  try {
    for (const server of servers) {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture address')
      const url = `http://127.0.0.1:${address.port}/history`
      const state = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`) as { activeTabId: string }
      await expect.poll(() => appWindow.evaluate('window.hronautHistory.list()')).toEqual(expect.arrayContaining([expect.objectContaining({ url })]))
      await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(state.activeTabId)})`)
    }
    await expect.poll(() => appWindow.evaluate('window.hronautHistory.list()')).toHaveLength(3)
    await appWindow.keyboard.press('Control+Shift+Delete')
    const panel = appWindow.locator('.privacy-settings')
    await expect(panel.locator('.janitor-site')).toHaveCount(3)
    const origins = await panel.locator('.janitor-site-copy > small').allTextContents()
    const [first, middle, last] = origins
    if (!first || !middle || !last) throw new Error('Missing retained website origins')
    const clear = (origin: string) => panel.getByRole('button', { name: `Clear history for ${origin}`, exact: true })
    const retained = new Set(origins)
    await clear(middle).focus()
    const steps = [
      { origin: middle, nextOrigin: last, remaining: 2 },
      { origin: last, nextOrigin: first, remaining: 1 },
      { origin: first, nextOrigin: null, remaining: 0 }
    ]
    for (const { origin, nextOrigin, remaining } of steps) {
      appWindow.once('dialog', confirmation => { void confirmation.accept() })
      await appWindow.keyboard.press('Enter')
      await expect(clear(origin)).toHaveCount(0)
      await expect.poll(() => appWindow.evaluate('window.hronautHistory.list()')).toHaveLength(remaining)
      retained.delete(origin)
      const history = await appWindow.evaluate('window.hronautHistory.list()') as { url: string }[]
      expect(history.map(entry => new URL(entry.url).origin).sort()).toEqual([...retained].sort())
      if (nextOrigin) await expect(clear(nextOrigin)).toBeFocused()
      else await expect(panel.getByRole('heading', { name: 'Global history', exact: true })).toBeFocused()
    }
    await expect(panel.getByText('No websites yet', { exact: true })).toBeVisible()
  } finally {
    await Promise.all(servers.map(closeFixtureServer))
  }
})
