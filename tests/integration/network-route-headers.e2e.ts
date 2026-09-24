import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

for (const source of ['shell', 'mcp'] as const) {
  test(`preserves valid mock response header names through ${source}`, async ({ capabilities, appWindow }) => {
    const { client, tabId, address } = capabilities
    const input = {
      urlPattern: `http://127.0.0.1:${address.port}/route-target`,
      response: {
        body: 'mocked response',
        headers: Object.fromEntries([
          ['__proto__', 'prototype-header'],
          ['constructor', 'constructor-header'],
          ['content-type', 'text/plain']
        ])
      }
    }
    if (source === 'shell') {
      await appWindow.evaluate(`window.hronaut.addNetworkRoute(${JSON.stringify(tabId)}, JSON.parse(${JSON.stringify(JSON.stringify(input))}))`)
    } else {
      const added = await client.callTool({
        name: 'browser_network_routes', arguments: { action: 'add', tabId, ...input }
      }) as CallToolResult
      expect(added.isError, text(added)).not.toBe(true)
    }
    const fetched = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId,
        script: `fetch('/route-target').then(async response => ({
          body: await response.text(),
          prototypeHeader: response.headers.get('__proto__'),
          constructorHeader: response.headers.get('constructor')
        }))`
      }
    }) as CallToolResult
    expect(fetched.isError, text(fetched)).not.toBe(true)
    expect(JSON.parse(text(fetched))).toEqual({
      body: 'mocked response', prototypeHeader: 'prototype-header', constructorHeader: 'constructor-header'
    })
  })
}
