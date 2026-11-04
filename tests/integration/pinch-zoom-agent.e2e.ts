import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

// Chromium sends native input to the part of a page a pinch shows, from its offset, so an agent's native click on a
// page the person pinched landed away from the point it measured. It is refused, saying how to go on, until the agent
// resets the zoom, which also shows the page at its normal scale.
test('refuses an agent\'s native pointer input on a pinched page until browser_zoom resets it', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
    await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
  const evaluate = async (script: string): Promise<unknown> => {
    // As JSON, since browser_evaluate gives a string result as it is.
    const result = await call('browser_evaluate', { script: `JSON.stringify(${script})` })
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  const page = (input: { url: string; script: string }): Promise<unknown> => electronApp.evaluate(async ({ webContents }, input) => {
    return webContents.getAllWebContents().find(candidate => candidate.getURL() === input.url)?.executeJavaScript(input.script)
  }, input)
  await evaluate(`(() => {
    document.body.style.margin = '0'
    document.body.innerHTML = '<div style="width:1600px;height:2400px"><button id="button" style="position:absolute;left:250px;top:150px;width:120px;height:60px">Go</button></div>'
    window.seen = { clicks: 0 }
    document.querySelector('#button').addEventListener('click', () => { window.seen.clicks++ })
    return true
  })()`)

  // A touchpad pinch, as Chromium's own input tests synthesize it.
  await electronApp.evaluate(async ({ webContents }, url) => {
    const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
    const attached = contents.debugger.isAttached()
    if (!attached) contents.debugger.attach('1.3')
    try {
      await contents.debugger.sendCommand('Input.synthesizePinchGesture', { x: 300, y: 200, scaleFactor: 2, gestureSourceType: 'mouse' })
    } finally {
      if (!attached) contents.debugger.detach()
    }
  }, fixtureUrl)
  await expect.poll(async () => Math.round(Number(await page({ url: fixtureUrl, script: 'visualViewport.scale' })) * 100) / 100).toBe(2)

  const refused = await call('browser_click', { selector: '#button', native: true })
  expect(refused.isError).toBe(true)
  expect(text(refused)).toContain('Click with native input needs the page at its normal scale, and it is pinched larger. '
    + 'Reset it with browser_zoom (action reset), then try again.')
  const hover = await call('browser_hover', { selector: '#button' })
  expect(hover.isError).toBe(true)
  expect(text(hover)).toContain('Hover with native input needs the page at its normal scale')
  expect(await evaluate('window.seen.clicks')).toBe(0)

  const reset = await call('browser_zoom', { action: 'reset' })
  expect(reset.isError, text(reset)).not.toBe(true)
  // The answer comes once the pinch is undone.
  expect(await page({ url: fixtureUrl, script: 'visualViewport.scale' })).toBe(1)
  const clicked = await call('browser_click', { selector: '#button', native: true })
  expect(clicked.isError, text(clicked)).not.toBe(true)
  await expect.poll(() => evaluate('window.seen.clicks')).toBe(1)
})

// Hronaut set its pinch limits again after each load and reset, which applies all of the tab's preferences again, over
// the scale a phone viewport sets for itself: a wide page was no longer shown smaller to fit, and native input then
// took the page for one pinched larger. A page made for phones that is wider than the phone is shown at its own scale,
// with Chromium's layout viewport wider than the part shown, which is no pinch either.
test('leaves a phone viewport\'s fit-to-width scale alone across loads and a zoom reset', async ({ capabilities }) => {
  const { client, tabId } = capabilities
  const server = createServer((request, response) => {
    const phonePage = request.url === '/phone-page'
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html>
      ${phonePage ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : ''}<body style="margin:0">
      <div style="width:${phonePage ? 1560 : 980}px;height:3000px;background:#c33"><button id="button" style="width:300px;height:200px">Go</button></div>
      <script>window.seen = { clicks: 0, hovers: 0 }; const button = document.querySelector('#button')
        button.addEventListener('click', () => { window.seen.clicks++ }); button.addEventListener('mouseover', () => { window.seen.hovers++ })</script></body>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const call = async (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
    await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
  const evaluate = async (script: string): Promise<unknown> => {
    const result = await call('browser_evaluate', { script: `JSON.stringify(${script})` })
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  const fit = (): Promise<unknown> => evaluate('Math.round(visualViewport.scale * 100) / 100')
  try {
    const emulated = await call('browser_emulate', { viewportPreset: 'phone' })
    expect(emulated.isError, text(emulated)).not.toBe(true)
    for (const path of ['/wide', '/wide?again']) {
      const loaded = await call('browser_navigate', { url: `http://127.0.0.1:${address.port}${path}` })
      expect(loaded.isError, text(loaded)).not.toBe(true)
      await expect.poll(fit).toBeLessThan(0.5)
    }
    const reset = await call('browser_zoom', { action: 'reset' })
    expect(reset.isError, text(reset)).not.toBe(true)
    expect(await fit()).toBeLessThan(0.5)
    const clicked = await call('browser_click', { selector: '#button', native: true })
    expect(clicked.isError, text(clicked)).not.toBe(true)
    await expect.poll(() => evaluate('window.seen.clicks')).toBe(1)

    const phonePage = await call('browser_navigate', { url: `http://127.0.0.1:${address.port}/phone-page` })
    expect(phonePage.isError, text(phonePage)).not.toBe(true)
    await expect.poll(fit).toBe(1)
    const hovered = await call('browser_hover', { selector: '#button' })
    expect(hovered.isError, text(hovered)).not.toBe(true)
    await expect.poll(() => evaluate('window.seen.hovers')).toBe(1)
  } finally {
    await closeFixtureServer(server)
  }
})
