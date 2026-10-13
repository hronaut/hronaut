import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

for (const method of ['GET', 'POST'] as const) test(`copied cURL preserves retained empty headers for ${method} without replaying secrets`, async ({ capabilities }) => {
  test.skip(process.platform === 'win32', 'This cURL copy format requires a POSIX shell.')
  const { client, tabId } = capabilities
  const observed: Array<{ headers: Record<string, string | string[] | undefined>; method?: string; body: string }> = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      if (request.url === '/probe') observed.push({ headers: request.headers, method: request.method, body: Buffer.concat(chunks).toString('utf8') })
      response.setHeader('Content-Type', 'text/html')
      response.end('<title>Request copy fixture</title>ok')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
    expect(result.isError, name).not.toBe(true)
    return text(result)
  }
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    const origin = `http://127.0.0.1:${address.port}`
    await call('browser_navigate', { url: origin })
    await call('browser_network', {})
    const body = method === 'POST' ? "literal ' $() `text` ; café" : undefined
    const options = { method, headers: { 'X-Empty': '', 'X-Control': 'retained', 'Content-Type': '', Authorization: 'Bearer private-header-canary' }, ...(body === undefined ? {} : { body }) }
    await call('browser_evaluate', { script: `fetch('/probe', ${JSON.stringify(options)}).then(r => r.text())` })
    let requestId: string | undefined
    await expect.poll(async () => {
      const records = JSON.parse(await call('browser_network', {})) as Array<{ id: string; url: string }>
      requestId = records.find(record => record.url === `${origin}/probe`)?.id
      return requestId
    }).toBeTruthy()
    const details = JSON.parse(await call('browser_network_request', { requestId })) as { request: { headers: Record<string, string | string[]> } }
    const entries = Object.entries(details.request.headers)
    expect(entries.find(([name]) => name.toLowerCase() === 'x-empty')?.[1]).toBe('')
    expect(entries.find(([name]) => name.toLowerCase() === 'content-type')?.[1]).toBe('')
    const copied = await call('browser_network_request', { requestId, copyAs: 'curl' })
    expect(copied).not.toContain('private-header-canary')
    const { stdout } = await promisify(execFile)('sh', ['-c', copied], { timeout: 5_000 })
    expect(stdout).toContain('Request copy fixture')
    expect(observed).toHaveLength(2)
    for (const received of observed) {
      expect(received.method).toBe(method)
      expect(received.body).toBe(body ?? '')
      expect(Object.hasOwn(received.headers, 'x-empty')).toBe(true)
      expect(received.headers['x-empty']).toBe('')
      expect(Object.hasOwn(received.headers, 'content-type')).toBe(true)
      expect(received.headers['content-type']).toBe('')
      expect(received.headers['x-control']).toBe('retained')
    }
    const [original, replay] = observed
    if (!original || !replay) throw new Error('Missing original or replayed request')
    expect(original.headers.authorization).toBe('Bearer private-header-canary')
    expect(replay.headers.authorization).toBeUndefined()
  } finally { await closeFixtureServer(server) }
})
