import type { ElectronApplication } from '@playwright/test'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test } from './capability-fixtures.js'

// A static page: nothing animates or blinks, so two captures of it show the same pixels.
const STATIC_PAGE = `(() => {
  document.activeElement?.blur?.();
  document.body.innerHTML = '<div style="height:3000px;background:#fff"><h1 style="margin:0;padding:24px;font:24px sans-serif">Static fixture</h1><div id="dot" style="position:absolute;left:100px;top:120px;width:1px;height:1px;background:#fff"></div></div>';
  scrollTo(0, 0);
  return true;
})()`

async function onPage<T>(app: ElectronApplication, url: string, script: string): Promise<T> {
  return app.evaluate(async ({ webContents }, { url, script }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    if (!page) throw new Error('Missing screenshot fixture page')
    return page.executeJavaScript(script) as Promise<T>
  }, { url, script })
}

interface Observation { status: string; observationId?: string; comparedWith?: string; baseline?: string; reason?: string }

function observation(result: CallToolResult): { observation: Observation; width: number; height: number; note?: string } {
  const block = result.content.find(item => item.type === 'text' && item.text.includes('"observation"'))
  if (!block || block.type !== 'text') throw new Error(`No observation in ${JSON.stringify(result.content.map(item => item.type))}`)
  return JSON.parse(block.text)
}

const images = (result: CallToolResult): number => result.content.filter(item => item.type === 'image').length

test('returns no image when the viewport pixels match an earlier tracked screenshot, and a new one when they changed or cannot be compared', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const screenshot = (args: Record<string, unknown>) => client.callTool({ name: 'browser_screenshot', arguments: { tabId, ...args } }) as Promise<CallToolResult>
  await onPage(electronApp, fixtureUrl, STATIC_PAGE)

  // An ordinary screenshot is unchanged: one image and nothing else.
  const plain = await screenshot({})
  expect(plain.content.map(item => item.type)).toEqual(['image'])

  const first = await screenshot({ trackChanges: true })
  expect(first.isError).not.toBe(true)
  expect(images(first)).toBe(1)
  const firstReport = observation(first)
  expect(firstReport.observation).toEqual({ status: 'NEW', observationId: expect.stringMatching(/^[0-9a-f-]{36}$/) })
  expect(firstReport.width).toBeGreaterThan(0)
  const firstId = firstReport.observation.observationId!

  const same = await screenshot({ ifChangedSince: firstId })
  expect(same.isError).not.toBe(true)
  expect(images(same)).toBe(0)
  expect(observation(same).observation).toEqual({ status: 'UNCHANGED', observationId: firstId })
  expect(observation(same).note).toContain('does not prove that the page or its state is unchanged')

  // One pixel changes colour.
  await onPage(electronApp, fixtureUrl, `document.querySelector('#dot').style.background = '#000'; new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`)
  const changed = await screenshot({ ifChangedSince: firstId })
  expect(images(changed)).toBe(1)
  const changedReport = observation(changed).observation
  expect(changedReport).toEqual({ status: 'CHANGED', observationId: expect.stringMatching(/^[0-9a-f-]{36}$/), comparedWith: firstId })
  expect(changedReport.observationId).not.toBe(firstId)
  expect(observation(await screenshot({ ifChangedSince: changedReport.observationId })).observation.status).toBe('UNCHANGED')
  // The first observation is still there to compare with: comparing never replaces it.
  expect(observation(await screenshot({ ifChangedSince: firstId })).observation.status).toBe('CHANGED')

  // Other capture options, a scrolled page, an unknown id and a reload cannot be compared.
  const scaled = await screenshot({ ifChangedSince: changedReport.observationId, maxWidth: 400 })
  expect(images(scaled)).toBe(1)
  expect(observation(scaled).observation).toMatchObject({ status: 'NEW', baseline: 'unavailable', reason: 'not-comparable' })
  await onPage(electronApp, fixtureUrl, 'scrollTo(0, 40); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
  const scrolled = await screenshot({ ifChangedSince: changedReport.observationId })
  expect(observation(scrolled).observation).toMatchObject({ status: 'NEW', baseline: 'unavailable', reason: 'not-comparable' })
  const unknown = await screenshot({ ifChangedSince: '00000000-0000-4000-8000-000000000000' })
  expect(images(unknown)).toBe(1)
  expect(observation(unknown).observation).toMatchObject({ status: 'NEW', baseline: 'unavailable', reason: 'unknown-or-expired' })
  const beforeReload = observation(await screenshot({ trackChanges: true })).observation.observationId
  await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: fixtureUrl } })
  await onPage(electronApp, fixtureUrl, STATIC_PAGE)
  await onPage(electronApp, fixtureUrl, 'scrollTo(0, 40); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))')
  expect(observation(await screenshot({ ifChangedSince: beforeReload })).observation).toMatchObject({ status: 'NEW', reason: 'not-comparable' })
})

test('refuses change tracking for anything but a plain viewport screenshot', async ({ capabilities }) => {
  const { client, tabId } = capabilities
  for (const args of [{ trackChanges: true, fullPage: true }, { trackChanges: true, selector: 'body' }, { trackChanges: true, clip: { x: 0, y: 0, width: 10, height: 10 } }, { ifChangedSince: '00000000-0000-4000-8000-000000000000', trackChanges: false }]) {
    const result = await client.callTool({ name: 'browser_screenshot', arguments: { tabId, ...args } }) as CallToolResult
    expect(result.isError, JSON.stringify(args)).toBe(true)
    expect(JSON.stringify(result.content), JSON.stringify(args)).toContain('support plain viewport screenshots only')
  }
  const invalid = await client.callTool({ name: 'browser_screenshot', arguments: { tabId, ifChangedSince: 'not-an-id' } }) as CallToolResult
  expect(invalid.isError).toBe(true)
})
