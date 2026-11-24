import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { GenMapping, addMapping, toEncodedMap } from '@jridgewell/gen-mapping'
import { createServer } from 'node:http'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'
import type { LogpointReport } from '../../src/shared/logpoint.js'

const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>

// src/price.ts, minified so its variables are renamed:
// export function priceWithTax(amount) {
//   const doubled = amount * 2
//   return doubled + 1
// }
const CODE = '(()=>{function a(b){let c=b*2;return c+1}window.priceWithTax=a})();'
const BUNDLE = `${CODE}\n//# sourceMappingURL=price.js.map\n`

const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function vlq(value: number): string {
  let text = ''
  do {
    let digit = value & 31
    value >>>= 5
    if (value) digit |= 32
    text += DIGITS[digit]
  } while (value)
  return text
}
const item = (...values: number[]): string => values.map(vlq).join('')

function sourceMap(): object {
  const map = new GenMapping({ file: 'price.js' })
  const at = (needle: string) => CODE.indexOf(needle)
  for (const [generated, line, column] of [['function', 1, 7], ['let', 2, 2], ['return', 3, 2], ['}w', 4, 0]] as const) {
    addMapping(map, { generated: { line: 1, column: at(generated) }, source: 'src/price.ts', original: { line, column } })
  }
  const start = at('function')
  const end = at('}w') + 1
  // ECMA-426 scopes: one original function scope with amount and doubled, read in the generated code as b and c.
  const scopes = [
    item(1, 0, 0, 0), item(3, 0, 2), item(2, 3, 1),
    item(4, 2, start, 0), item(6, 3, 4), item(5, end - start)
  ].join(',')
  return { ...toEncodedMap(map), names: ['amount', 'doubled', 'b', 'c'], scopes }
}

test('a logpoint asked for by source reads original variable names through the source map\'s scopes', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fixture').pathname
    response.setHeader('cache-control', 'no-store')
    if (path === '/price.js') {
      response.setHeader('content-type', 'text/javascript')
      response.end(BUNDLE)
    } else if (path === '/price.js.map') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(sourceMap()))
    } else {
      response.setHeader('content-type', 'text/html')
      response.end('<!doctype html><title>Price</title><script src="/price.js"></script>')
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const pageUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/app`
  try {
    const navigated = await call(client, 'browser_navigate', { tabId, url: pageUrl })
    expect(navigated.isError, text(navigated)).not.toBe(true)
    const added = await call(client, 'browser_logpoint', {
      tabId, action: 'add', probes: [{ source: 'src/price.ts', line: 3, expression: '[doubled, amount, doubled + amount]' }]
    })
    expect(added.isError, text(added)).not.toBe(true)
    const probe = (JSON.parse(text(added)) as LogpointReport).probes[0]!
    expect(probe.expression).toBe('[doubled, amount, doubled + amount]')
    expect(probe.originalNames).toEqual([{ name: 'doubled', generated: 'c' }, { name: 'amount', generated: 'b' }])
    expect(probe.resolved.original).toMatchObject({ source: 'src/price.ts', line: 3 })

    const total = await electronApp.evaluate(async ({ webContents }, pageUrl) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === pageUrl)
      return page?.mainFrame.executeJavaScript('priceWithTax(5)')
    }, pageUrl)
    expect(total).toBe(11)
    const report = JSON.parse(text(await call(client, 'browser_logpoint', { tabId, action: 'get' }))) as LogpointReport
    expect(report.probes[0]!.records[0]!.value).toMatchObject({
      type: 'object', subtype: 'array',
      properties: [{ name: '0', type: 'number', value: '10' }, { name: '1', type: 'number', value: '5' }, { name: '2', type: 'number', value: '15' }]
    })
  } finally {
    await call(client, 'browser_logpoint', { tabId, action: 'remove' })
    await closeFixtureServer(server)
  }
})
