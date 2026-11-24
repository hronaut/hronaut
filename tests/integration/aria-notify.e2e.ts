import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('records ariaNotify announcements the DOM never shows, and restores the page\'s functions', async ({ capabilities }) => {
  const { client, tabId } = capabilities
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return text(result)
  }
  const original = await call('browser_evaluate', { script: 'String(document.ariaNotify === Document.prototype.ariaNotify && typeof document.ariaNotify)' })
  expect(original).toBe('function')

  expect(JSON.parse(await call('browser_aria_notify', { action: 'start', durationMs: 30_000 }))).toMatchObject({ status: 'recording', supported: true })
  await call('browser_evaluate', {
    script: `(() => {
      function announceCartTotal () { document.ariaNotify('Cart total is 42 dollars', { priority: 'high' }) }
      announceCartTotal()
      const status = document.createElement('div')
      status.setAttribute('role', 'status')
      document.body.append(status)
      status.ariaNotify('Saved')
      return true
    })()`
  })
  const report = JSON.parse(await call('browser_aria_notify', { action: 'get' }))
  expect(report.announcements).toEqual([
    expect.objectContaining({ text: 'Cart total is 42 dollars', priority: 'high', target: { kind: 'document' }, callSite: expect.objectContaining({ functionName: 'announceCartTotal' }) }),
    expect.objectContaining({ text: 'Saved', target: { kind: 'element', localName: 'div', role: 'status' } })
  ])

  expect(JSON.parse(await call('browser_aria_notify', { action: 'stop' }))).toMatchObject({ status: 'stopped', ended: { reason: 'stopped' } })
  await expect.poll(async () => call('browser_evaluate', { script: 'String(Document.prototype.ariaNotify.toString().includes("[native code]"))' })).toBe('true')
  await call('browser_evaluate', { script: `document.ariaNotify('after stop'); true` })
  expect(JSON.parse(await call('browser_aria_notify', { action: 'get' })).announcements).toHaveLength(2)
})
