import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// A documentation site that moves its address to the section in view, with `history.replaceState`, closed Find as soon
// as the person stepped to a match further down the page.

const GUIDE = `<!doctype html><title>Guide</title><style>section { min-height: 150vh }</style>
<section id="intro"><h2>Intro</h2><p>needle one</p></section>
<section id="setup"><h2>Setup</h2><p>needle two</p></section>
<section id="usage"><h2>Usage</h2><p>needle three</p></section>
<script>
addEventListener('scroll', () => {
  const current = [...document.querySelectorAll('section')].filter(section => section.getBoundingClientRect().top <= innerHeight / 2).pop()
  if (current && location.hash !== '#' + current.id) history.replaceState(null, '', '#' + current.id)
})
</script>`

test('keeps Find open while a site moves its address to the match in view', async ({ appWindow }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(GUIDE)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/guide`
  const activeUrl = () => appWindow.evaluate(async () => (
    (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.active)?.url
  ))
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    await expect.poll(() => appWindow.evaluate(async () => (
      (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).tabs.find(tab => tab.active)?.loading
    ))).toBe(false)
    await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
    const bar = appWindow.getByRole('search', { name: 'Find in page' })
    const search = bar.getByRole('searchbox', { name: 'Find text' })
    await search.fill('needle')
    await expect(bar.locator('.find-count')).toHaveText('1 / 3')

    // The person steps to the next match; the page scrolls to it and the site moves its address there.
    await search.press('Enter')
    await expect.poll(activeUrl).toBe(`${url}#setup`)
    // The shell has applied that state once its address field shows it.
    await expect(appWindow.getByRole('combobox', { name: 'Address', exact: true })).toHaveValue(`${url}#setup`)
    await expect(bar).toBeVisible()
    await expect(bar.locator('.find-count')).toHaveText('2 / 3')

    await search.press('Enter')
    await expect.poll(activeUrl).toBe(`${url}#usage`)
    await expect(appWindow.getByRole('combobox', { name: 'Address', exact: true })).toHaveValue(`${url}#usage`)
    await expect(bar.locator('.find-count')).toHaveText('3 / 3')
    await expect(search).toHaveValue('needle')
  } finally {
    await closeFixtureServer(server)
  }
})
