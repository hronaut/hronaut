import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { closeFixtureServer, expect, test } from './fixtures.js'

interface HistoryWindow {
  hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> }
  hronautHistory: { list(): Promise<Array<{ url: string; title: string }>> }
}

test('keeps a sign-in token in an untitled page\'s fragment out of the history', async ({ appWindow, profileDirectory }) => {
  const server = createServer((_request, response) => {
    // A sign-in callback page with no title, which reads its token from the fragment.
    response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><p>Signing you in</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const page = `http://127.0.0.1:${address.port}/oauth/callback`
  try {
    await appWindow.evaluate(url => (window as unknown as HistoryWindow).hronaut.newTab({ url, active: true }), `${page}#access_token=history-secret-token`)
    await expect.poll(() => appWindow.evaluate(() => (window as unknown as HistoryWindow).hronautHistory.list())).toEqual([
      expect.objectContaining({ url: page, title: page })
    ])
    // The title was saved as 127.0.0.1:…/oauth/callback#access_token=…, the address Chromium shows for an untitled page.
    await expect.poll(() => readFile(join(profileDirectory, 'history.json'), 'utf8').catch(() => '')).toContain('/oauth/callback')
    expect(await readFile(join(profileDirectory, 'history.json'), 'utf8')).not.toContain('history-secret-token')
  } finally {
    await closeFixtureServer(server)
  }
})
