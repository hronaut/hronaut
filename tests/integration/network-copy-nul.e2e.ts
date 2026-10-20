import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'
import { closeFixtureServer } from './fixtures.js'

const unsupported = 'Copy cURL cannot represent literal NUL characters. Use Copy fetch instead.'
// The panel says it in the interface language, and in words for a person; agents keep the message above.
const unsupportedInPanel = 'This request contains a NUL character, which cURL cannot send. Copy it as fetch instead.'

for (const [label, body] of [
  ['NUL', 'before\u0000after'],
  ['ordinary text', "literal ' $() `text` ; café"],
  ['empty', '']
] as const) test(`request copies preserve ${label} bodies and report unsupported cURL without changing the clipboard`, async ({ capabilities, appWindow, electronApp }) => {
  test.skip(process.platform === 'win32', 'The existing cURL copy requires a POSIX shell.')
  const { client, tabId, openPageTool } = capabilities
  const received: Array<{ hex: string; authorization?: string }> = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      if (request.url === '/nul-copy') received.push({ hex: Buffer.concat(chunks).toString('hex'), authorization: request.headers.authorization })
      response.setHeader('Content-Type', 'text/html')
      response.end('<title>Request copy fixture</title>ok')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return text(result)
  }
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    const origin = `http://127.0.0.1:${address.port}`
    await call('browser_navigate', { url: origin })
    await call('browser_network', {})
    const options = { method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer private-copy-canary' }, body }
    await call('browser_evaluate', { script: `fetch('/nul-copy', ${JSON.stringify(options)}).then(r => r.text())` })
    let requestId: string | undefined
    await expect.poll(async () => {
      const records = JSON.parse(await call('browser_network', {})) as Array<{ id: string; url: string; completedAt?: string }>
      requestId = records.find(record => record.url === `${origin}/nul-copy` && record.completedAt)?.id
      return requestId
    }).toBeTruthy()
    const details = JSON.parse(await call('browser_network_request', { requestId })) as { request: { body?: { text?: string; truncated: boolean } } }
    expect(details.request.body?.text ?? '').toBe(body)
    if (body) expect(details.request.body?.truncated).toBe(false)
    const curlResult = await client.callTool({ name: 'browser_network_request', arguments: { tabId, requestId, copyAs: 'curl' } }) as CallToolResult
    const curl = text(curlResult)
    expect(curl).not.toContain('private-copy-canary')
    if (label === 'NUL') {
      expect(curlResult.isError).toBe(true)
      expect(curl).toContain(unsupported)
      expect(curl).not.toContain('before')
      expect(curl).not.toContain('--data-raw')
      expect(curl).not.toContain('\u0000')
    } else expect(curlResult.isError, curl).not.toBe(true)
    const fetchCopy = await call('browser_network_request', { requestId, copyAs: 'fetch' })
    expect(fetchCopy).not.toContain('private-copy-canary')
    expect(fetchCopy).not.toContain('\u0000')
    if (label === 'NUL') expect(fetchCopy).toContain('before\\u0000after')
    await openPageTool('Open network monitor')
    const panel = appWindow.getByRole('dialog', { name: 'Network', exact: true })
    await panel.getByRole('searchbox', { name: 'Filter network requests', exact: true }).fill('/nul-copy')
    const rows = panel.getByRole('listbox', { name: 'Network requests' }).getByRole('option')
    await expect(rows).toHaveCount(1)
    await rows.first().click()
    await electronApp.evaluate(({ clipboard }) => clipboard.writeText('NUL copy clipboard sentinel'))
    await panel.getByRole('button', { name: 'Copy sanitized cURL (POSIX shell)', exact: true }).click()
    if (label === 'NUL') {
      await expect(panel.getByRole('alert')).toHaveText(unsupportedInPanel)
      await expect(panel.getByRole('button', { name: 'Copied cURL (POSIX shell)', exact: true })).toHaveCount(0)
      expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe('NUL copy clipboard sentinel')
    } else {
      await expect(panel.getByRole('button', { name: 'Copied cURL (POSIX shell)', exact: true })).toBeVisible()
      expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(curl)
    }
    await panel.getByRole('button', { name: 'Copy sanitized fetch', exact: true }).click()
    await expect(panel.getByRole('button', { name: 'Copied fetch', exact: true })).toBeVisible()
    await expect(panel.getByRole('alert')).toHaveCount(0)
    const clipboardCopy = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(clipboardCopy).toBe(fetchCopy)
    expect(received).toEqual([{ hex: Buffer.from(body).toString('hex'), authorization: 'Bearer private-copy-canary' }])
    // Only these explicit fixture executions replay traffic; copying never does.
    await call('browser_evaluate', { script: clipboardCopy })
    await expect.poll(() => received.length).toBe(2)
    if (label !== 'NUL') {
      await promisify(execFile)('sh', ['-c', curl], { timeout: 5_000 })
      expect(received).toHaveLength(3)
    }
    for (const replay of received.slice(1)) expect(replay).toEqual({ hex: Buffer.from(body).toString('hex'), authorization: undefined })
  } finally { await closeFixtureServer(server) }
})
