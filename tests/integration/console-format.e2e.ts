import type { HronautApi } from '../../src/shared/types.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('presents primitive Console templates consistently without changing stacks or event counts', async ({ capabilities, appWindow, electronApp }) => {
  const { client, tabId, openPageTool, fixtureUrl } = capabilities
  const seed = await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: `(() => {
    window.consoleProbeGetterCalls = 0;
    const object = {get secret(){window.consoleProbeGetterCalls++;return 'never-read'}, toString(){window.consoleProbeGetterCalls++;return 'never-coerced'}};
    function probe() {
      console.log('fmt-string %s', 'world');
      console.info('fmt-numeric %d %i %f', 3.8, '12px', '1.25px');
      console.warn('fmt-style %cBanner%c ready', 'color:red;background:blue', '');
      console.error('fmt-missing %s %d', 'only');
      console.log('fmt-extra %s', 'one', 'two', {safe:1});
      console.log('fmt-percent 100%% %s', 'done');
      console.log('fmt-object %s %o %O', object, object, object);
      console.log('fmt-literal %s');
      console.warn('fmt-split token=%s%s', 'private-', 'secret');
      for(let i=0;i<3;i++)console.warn('fmt-repeat %s', 'same');
      for(let i=0;i<3;i++)console.info('fmt-repeat-info %s', 'same');
      for(const style of ['color:red','color:blue'])console.warn('fmt-distinct %cSame', style);
    } probe(); return true;
  })()` } }) as CallToolResult
  expect(seed.isError, text(seed)).not.toBe(true)
  let messages: Array<Record<string, unknown>> = []
  await expect.poll(async () => {
    const result = await client.callTool({ name: 'browser_console', arguments: { tabId } }) as CallToolResult
    messages = JSON.parse(text(result)).filter((m: {message:string}) => m.message.includes('fmt-'))
    return messages.length
  }).toBe(13)
  const getters = await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: 'window.consoleProbeGetterCalls' } }) as CallToolResult
  expect(text(getters)).toBe('1') // Chromium performs the original %s conversion; Hronaut adds none.
  expect(messages.map(message => message.message)).toEqual([
    'fmt-string world',
    'fmt-numeric 3 12 1.25',
    'fmt-style Banner ready',
    'fmt-missing only %d',
    'fmt-extra %s one two [object Object]',
    'fmt-percent 100% done',
    'fmt-object %s %o %O never-coerced [object Object] [object Object]',
    'fmt-literal %s',
    'fmt-split token=[REDACTED]',
    'fmt-repeat same',
    'fmt-repeat-info same',
    'fmt-distinct Same',
    'fmt-distinct Same'
  ])
  expect(messages[9]?.repeatCount).toBe(3)
  expect(messages[10]?.repeatCount).toBe(3)
  expect(messages[11]?.repeatCount).toBeUndefined()
  expect(messages[12]?.repeatCount).toBeUndefined()
  for (const index of [2, 3, 8, 9]) expect(messages[index]?.stack).toEqual(expect.arrayContaining([expect.objectContaining({ functionName: 'probe' })]))
  expect(JSON.stringify(messages)).not.toContain('private-')
  expect(JSON.stringify(messages)).not.toContain('presentation')
  await openPageTool('Open Console')
  const panel = appWindow.getByRole('dialog', { name: 'Console' })
  await expect(panel).toContainText('fmt-style Banner ready')
  await expect(panel).not.toContainText('color:red')
  await expect(panel).not.toContainText('private-')
  await panel.getByRole('button', { name: 'Copy all', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Copied all', exact: true })).toBeVisible()
  const copied = JSON.parse(await electronApp.evaluate(({ clipboard }) => clipboard.readText()))
  expect(copied.messages.filter((message: { message: string }) => message.message.includes('fmt-'))).toEqual([...messages].reverse())
  const report = await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.createDebugReport({ tabId }), tabId)
  expect(JSON.stringify(report)).toContain('fmt-style Banner ready')
  expect(JSON.stringify(report)).not.toContain('private-')
  expect(JSON.stringify(report)).not.toContain('presentation')
  await electronApp.evaluate(async ({ webContents }, fixtureUrl) => {
    const contents = webContents.getAllWebContents().find(contents => contents.getURL() === fixtureUrl)!
    await contents.debugger.sendCommand('Runtime.disable')
    await contents.executeJavaScript("console.log('fmt-fallback %s', 'kept')")
  }, fixtureUrl)
  await expect.poll(async () => {
    const result = await client.callTool({ name: 'browser_console', arguments: { tabId } }) as CallToolResult
    return JSON.parse(text(result)).find((message: { message: string }) => message.message.includes('fmt-fallback'))?.message
  }).toBe('fmt-fallback %s kept')
})
