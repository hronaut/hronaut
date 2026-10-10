import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('MCP records pathname expectations without author code and rejects ambiguous or stale requests', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const call = (args: Record<string, unknown>) => client.callTool({ name: 'browser_repro', arguments: { tabId, ...args } }) as Promise<CallToolResult>
  const started = await call({ action: 'start' })
  expect(started.isError, text(started)).not.toBe(true)
  const context = JSON.parse(text(started)).checkpointContext as string
  const checkpoint = { context, condition: 'urlPath', path: new URL(fixtureUrl).pathname, reviewed: true }
  const pageId = await electronApp.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
    await page.executeJavaScript("globalThis.pathAuthorCalls=0;globalThis.URL=new Proxy(URL,{construct(){pathAuthorCalls++;throw Error('Author URL constructor')}});void 0", false)
    return page.id
  }, fixtureUrl)
  const observed = await call({ action: 'checkpoint', checkpoint })
  expect(observed.isError, text(observed)).not.toBe(true)
  expect(JSON.parse(text(observed)).steps.at(-1).expectation).toEqual({ condition: 'urlPath', path: checkpoint.path, observedMatch: true })
  for (const extra of [{ selector: 'body' }, { text: 'private' }, { count: 1 }, { path: '/?token=private' }, { reviewed: false }]) {
    expect((await call({ action: 'checkpoint', checkpoint: { ...checkpoint, ...extra } })).isError).toBe(true)
  }
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, true), tabId)
  expect((await call({ action: 'checkpoint', checkpoint })).isError).toBe(true)
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.setTabAgentPaused(id, false), tabId)
  // Pause blocks the request; document navigation invalidates the review context.
  await electronApp.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript("history.pushState({},'', '/path-changed');void 0", false), pageId)
  await expect.poll(async () => JSON.parse(text(await call({ action: 'get' }))).checkpointContext).not.toBe(context)
  expect((await call({ action: 'checkpoint', checkpoint })).isError).toBe(true)
  const current = JSON.parse(text(await call({ action: 'get' })))
  expect((await call({ action: 'checkpoint', checkpoint: { ...checkpoint, path: '/path-changed', context: current.checkpointContext } })).isError).not.toBe(true)
  expect(await electronApp.evaluate(async ({ webContents }, id) => webContents.fromId(id)!.executeJavaScript('pathAuthorCalls', false), pageId)).toBe(0)
  await call({ action: 'stop' })
})
