import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

interface HistoryWindow {
  hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> }
  hronautHistory: { list(): Promise<Array<{ url: string; visitCount: number }>> }
}

test('counts one visit for a page that saves its state with replaceState', async ({ appWindow }) => {
  const server = createServer((_request, response) => {
    // A single-page app saving its scroll position ten times, then opening another route.
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Router fixture</title><main>Inbox</main>
      <script>
        let saves = 0
        const save = () => {
          history.replaceState({ scroll: saves }, '')
          saves += 1
          if (saves < 10) setTimeout(save, 30)
          else history.pushState({}, '', '/settings')
        }
        addEventListener('load', () => setTimeout(save, 100))
      </script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const inbox = `http://127.0.0.1:${address.port}/inbox`
  const settings = `http://127.0.0.1:${address.port}/settings`
  try {
    await appWindow.evaluate(url => (window as unknown as HistoryWindow).hronaut.newTab({ url, active: true }), inbox)
    const visits = () => appWindow.evaluate(async () => Object.fromEntries(
      (await (window as unknown as HistoryWindow).hronautHistory.list()).map(entry => [entry.url, entry.visitCount])
    ))
    // The route change comes after every save, so once it is recorded the saves have all been seen.
    await expect.poll(visits).toHaveProperty([settings], 1)
    // Each replaceState counted another visit: the inbox had 11.
    expect(await visits()).toEqual({ [inbox]: 1, [settings]: 1 })
  } finally {
    await closeFixtureServer(server)
  }
})
