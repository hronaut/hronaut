import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// A documentation site that moves its address to the section in view, with `history.replaceState`, ended the element
// picker as soon as the person scrolled toward the element they wanted.

const GUIDE = `<!doctype html><title>Guide</title><style>section { min-height: 150vh }</style>
<section id="intro"><h2>Intro</h2></section>
<section id="setup"><h2>Setup</h2><button>Install</button></section>
<script>
addEventListener('scroll', () => {
  const current = [...document.querySelectorAll('section')].filter(section => section.getBoundingClientRect().top <= innerHeight / 2).pop()
  if (current && location.hash !== '#' + current.id) history.replaceState(null, '', '#' + current.id)
})
</script>`

test('keeps the element picker while a site moves its address to the section in view', async ({ appWindow, electronApp }) => {
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
    await appWindow.getByRole('button', { name: 'Select an element to copy for agent' }).click()
    const cancel = appWindow.getByRole('button', { name: 'Cancel element selection' })
    await expect(cancel).toBeVisible()

    // The person scrolls toward the element; the site moves its address to that section.
    await electronApp.evaluate(({ webContents }, pageUrl) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)
      if (!page) throw new Error('The guide page was not found')
      return page.executeJavaScript('scrollTo(0, document.querySelector("#setup").offsetTop)')
    }, url)
    await expect.poll(activeUrl).toBe(`${url}#setup`)

    await expect(cancel).toBeVisible()
    await expect(appWindow.getByRole('button', { name: 'Select an element to copy for agent' })).toHaveCount(0)
    await cancel.click()
    await expect(appWindow.getByRole('button', { name: 'Select an element to copy for agent' })).toBeVisible()
  } finally {
    await closeFixtureServer(server)
  }
})
