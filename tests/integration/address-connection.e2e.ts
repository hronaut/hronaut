import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

// Chrome says "Not secure" beside an HTTP page's address and says first in its site information whether the connection
// is secure; Hronaut's site controls button showed the same icon for every website.
test('says “Not secure” beside an HTTP page’s address and in Site controls, as Chrome does, but not for this computer', async ({ profileDirectory, mcpPort }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end('<title>Plain page</title><p>Served over HTTP</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  // A name that is not this computer's reaches the fixture without a proxy, as a server on the local network would.
  const instance = await launchHronaut(profileDirectory, mcpPort, 1, [], ['--host-resolver-rules=MAP plain.test 127.0.0.1', '--no-proxy-server'])
  const window = instance.window
  const open = (url: string) => window.evaluate(async url => {
    await (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true })
  }, url)
  const activeTitle = () => window.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    .then(state => state.tabs.find(tab => tab.active)?.title))
  try {
    await open(`http://plain.test:${address.port}/`)
    await expect.poll(activeTitle).toBe('Plain page')
    const notSecure = window.getByRole('button', { name: 'Not secure. Site controls for plain.test', exact: true })
    await expect(notSecure).toHaveText('Not secure')
    const label = notSecure.locator('.site-security-label')
    await expect(label).toBeVisible()
    // As in Chrome, the label leaves while you type in the field, and comes back with the page's address.
    const field = window.getByRole('combobox', { name: 'Address', exact: true })
    await field.click()
    await field.pressSequentially('plain')
    await expect(label).toBeHidden()
    await field.press('Escape')
    await expect(label).toBeVisible()
    await notSecure.click()
    const siteControls = window.getByRole('dialog', { name: 'plain.test', exact: true })
    await expect(siteControls.getByText('Your connection to this site is not secure')).toBeVisible()
    await expect(siteControls.getByText(/You should not enter any sensitive information on this site/)).toBeVisible()
    await siteControls.getByRole('button', { name: 'Close site controls' }).click()

    // A page on this computer is a secure context, so, as in Chrome, its address shows no warning.
    await open(`http://127.0.0.1:${address.port}/`)
    await expect.poll(activeTitle).toBe('Plain page')
    const local = window.getByRole('button', { name: 'Site controls for 127.0.0.1', exact: true })
    await expect(local).toHaveText('')
    await local.click()
    const localControls = window.getByRole('dialog', { name: '127.0.0.1', exact: true })
    await expect(localControls.getByText('This page comes from this computer, so its connection does not leave it.')).toBeVisible()
    await expect(localControls.getByText(/You should not enter any sensitive information/)).toHaveCount(0)
  } finally {
    await closeHronaut(instance.app)
    await closeFixtureServer(server)
  }
})
