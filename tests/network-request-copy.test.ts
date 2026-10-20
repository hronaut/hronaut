import { execFile, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { canFormatNetworkRequestCopy, formatNetworkRequestCopy } from '../src/shared/network-request-copy.js'
import type { BrowserNetworkRequestDetails } from '../src/shared/types.js'

function requestDetails(overrides: Partial<BrowserNetworkRequestDetails> = {}): BrowserNetworkRequestDetails {
  return {
    id: 'request-1',
    url: 'https://alice:password@example.com/api/items?token=secret&view=full#private',
    method: 'POST',
    resourceType: 'fetch',
    startedAt: '2026-08-15T10:00:00.000Z',
    completedAt: '2026-08-15T10:00:00.100Z',
    status: 201,
    detailsAvailable: true,
    request: {
      headers: {
        Accept: 'application/json',
        Authorization: '[REDACTED]',
        Cookie: '[REDACTED]',
        'Content-Length': '57',
        'Content-Type': 'application/json',
        'X-Debug': "first line\r\nsecond line"
      },
      body: {
        text: '{\n  "name": "kept",\n  "password": "[REDACTED]"\n}',
        originalChars: 57,
        truncated: false,
        redacted: true
      }
    },
    response: {
      headers: {},
      body: { available: false, reason: 'Not required for request copying.' }
    },
    ...overrides
  }
}

// Windows PowerShell 5.1 is `powershell`; PowerShell 7 is `pwsh` on every platform, including GitHub's Linux runners.
const powerShells = ['powershell', 'pwsh'].filter(command => (
  spawnSync(command, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { timeout: 30_000 }).status === 0
))

interface ReceivedRequest {
  method?: string
  url?: string
  headers: string[]
  body: Buffer
}

async function withFixtureServer(run: (origin: string, received: ReceivedRequest[]) => Promise<void>): Promise<void> {
  const received: ReceivedRequest[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      received.push({ method: request.method, url: request.url, headers: request.rawHeaders, body: Buffer.concat(chunks) })
      response.end('ok')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture server address')
    await run(`http://127.0.0.1:${address.port}`, received)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
}

function headerValues(request: ReceivedRequest, name: string): string[] {
  return request.headers.flatMap((header, index, headers) => index % 2 === 0 && header.toLowerCase() === name ? [headers[index + 1]!] : [])
}

describe('formatNetworkRequestCopy', () => {
  it.each(['\u0000after', 'before\u0000after', 'before\u0000'])('rejects a retained literal NUL body for cURL while preserving exact fetch data (%j)', body => {
    const details = requestDetails({ request: { headers: {}, body: { text: body, originalChars: body.length, truncated: false, redacted: false } } })
    expect(() => formatNetworkRequestCopy(details, 'curl')).toThrow('Copy cURL cannot represent literal NUL characters. Use Copy fetch instead.')
    const calls: RequestInit[] = []
    const fetch = formatNetworkRequestCopy(details, 'fetch')
    expect(fetch).not.toContain('\u0000')
    runInNewContext(fetch, { fetch: (_url: string, options: RequestInit) => { calls.push(options) } })
    expect(calls).toEqual([{ method: 'POST', body }])
  })

  it('rejects NUL in retained cURL headers without exposing their value', () => {
    const details = requestDetails({ request: { headers: { 'X-Allowed': 'private-before\u0000private-after' } } })
    expect(() => formatNetworkRequestCopy(details, 'curl')).toThrow(new Error('Copy cURL cannot represent literal NUL characters. Use Copy fetch instead.'))
  })

  it('filters omitted NUL headers before checking cURL representability', () => {
    const details = requestDetails({ request: { headers: {
      Authorization: 'secret\u0000value', 'Content-Length': '\u0000', 'Invalid\u0000Name': 'value',
      'X-Oversized': '\u0000' + 'x'.repeat(2_000), 'X-Allowed': 'kept'
    } } })
    const curl = formatNetworkRequestCopy(details, 'curl')
    expect(curl).toContain("--header 'X-Allowed: kept'")
    expect(curl).toContain('4 sensitive, transport, invalid, or oversized headers were omitted')
    expect(curl).not.toContain('\u0000')
    expect(curl).not.toContain('secret\u0000value')
  })

  it.each([true, false])('keeps already omitted NUL bodies omitted (truncated=%s)', truncated => {
    const body = truncated ? 'partial\u0000' : 'x'.repeat(20_000) + '\u0000'
    const details = requestDetails({ request: { headers: {}, body: { text: body, originalChars: body.length, truncated, redacted: false } } })
    const curl = formatNetworkRequestCopy(details, 'curl')
    expect(curl).not.toContain('--data-raw')
    expect(curl).not.toContain('\u0000')
    expect(curl).toContain('request body was omitted')
  })

  it.each(['', 'before\\u0000after'])('preserves empty and textual escaped-NUL bodies (%j)', body => {
    const details = requestDetails({ request: { headers: {}, body: { text: body, originalChars: body.length, truncated: false, redacted: false } } })
    expect(formatNetworkRequestCopy(details, 'curl')).toContain(`--data-raw '${body}'`)
    const calls: RequestInit[] = []
    runInNewContext(formatNetworkRequestCopy(details, 'fetch'), { fetch: (_url: string, options: RequestInit) => { calls.push(options) } })
    expect(calls).toEqual([{ method: 'POST', body }])
  })

  it('uses curl empty-field syntax for each retained empty header without changing fetch output', () => {
    const details = requestDetails({ request: { headers: { 'X-Mixed': ['', 'kept'], "X-Owner's": '' } } })
    const curl = formatNetworkRequestCopy(details, 'curl')
    expect(curl).toContain("--header 'X-Mixed;'")
    expect(curl).toContain("--header 'X-Mixed: kept'")
    expect(curl).toContain("--header 'X-Owner'\"'\"'s;'")
    const fetch = formatNetworkRequestCopy(details, 'fetch')
    const calls: RequestInit[] = []
    runInNewContext(fetch, { fetch: (_url: string, options: RequestInit) => { calls.push(options) } })
    expect(calls).toEqual([{ method: 'POST', headers: [['X-Mixed', ''], ['X-Mixed', 'kept'], ["X-Owner's", '']] }])
  })

  it('omits pwd and passphrase headers like other sensitive headers', () => {
    const curl = formatNetworkRequestCopy(requestDetails({ request: { headers: { 'X-Pwd': 'SECRET', 'X-Passphrase': 'SECRET', 'X-Allowed': 'kept' } } }), 'curl')
    expect(curl).not.toContain('SECRET')
    expect(curl).toContain("--header 'X-Allowed: kept'")
    expect(curl).toContain('2 sensitive, transport, invalid, or oversized headers were omitted')
  })

  it('keeps empty sensitive, transport and invalid headers filtered before curl formatting', () => {
    const curl = formatNetworkRequestCopy(requestDetails({ request: { headers: {
      Authorization: '', Cookie: '', 'X-Api-Key': '', 'Content-Length': '', 'Bad\r\nName': '', 'X-Allowed': ''
    } } }), 'curl')
    expect(curl).toContain("--header 'X-Allowed;'")
    expect(curl).toContain('5 sensitive, transport, invalid, or oversized headers were omitted')
    for (const name of ['Authorization', 'Cookie', 'X-Api-Key', 'Content-Length', 'Bad']) expect(curl).not.toContain(`--header '${name}`)
  })

  it('preserves nonempty values and existing newline normalization and shell quoting', () => {
    const curl = formatNetworkRequestCopy(requestDetails({ request: { headers: {
      'X-Spaces': ' \t ', 'X-Punctuation': "'; $(fixture) `fixture`;", 'X-Lines': 'first\r\nsecond'
    } } }), 'curl')
    expect(curl).toContain("--header 'X-Spaces:  \t '")
    expect(curl).toContain("--header 'X-Punctuation: '\"'\"'; $(fixture) `fixture`;'")
    expect(curl).toContain("--header 'X-Lines: first second'")
  })

  it.skipIf(process.platform === 'win32').each(['GET', 'POST'])('replays empty and repeated headers literally with %s', async method => {
    const received: Array<{ headers: string[]; body: string; method?: string }> = []
    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        received.push({ headers: request.rawHeaders, body: Buffer.concat(chunks).toString('utf8'), method: request.method })
        response.end('ok')
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture server address')
      const body = method === 'POST' ? "literal ' $() `text` ; café" : undefined
      const command = formatNetworkRequestCopy(requestDetails({
        url: `http://127.0.0.1:${address.port}/empty`, method,
        request: { headers: { 'X-Empty': '', 'X-Mixed': ['', 'retained'], 'X-Control': 'kept', Authorization: 'private-canary', Cookie: '', 'Content-Type': '' },
          ...(body === undefined ? {} : { body: { text: body, originalChars: body.length, truncated: false, redacted: false } }) }
      }), 'curl')
      const { stdout } = await promisify(execFile)('sh', ['-c', command], { timeout: 5_000 })
      expect(stdout).toBe('ok')
      expect(command).not.toContain('private-canary')
      expect(received).toHaveLength(1)
      const request = received[0]
      if (!request) throw new Error('Missing replayed request')
      expect(request.method).toBe(method)
      expect(request.body).toBe(body ?? '')
      const values = (name: string) => request.headers.flatMap((header, index, headers) => index % 2 === 0 && header.toLowerCase() === name ? [headers[index + 1]] : [])
      expect(values('x-empty')).toEqual([''])
      expect(values('x-mixed')).toEqual(['', 'retained'])
      expect(values('x-control')).toEqual(['kept'])
      expect(values('content-type')).toEqual([''])
      expect(values('authorization')).toEqual([])
      expect(values('cookie')).toEqual([])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  it('creates a shell-safe sanitized cURL command with a complete text body', () => {
    const result = formatNetworkRequestCopy(requestDetails(), 'curl')

    expect(result).toContain("curl --request 'POST'")
    expect(result).toContain("--url 'https://%5BREDACTED%5D:%5BREDACTED%5D@example.com/api/items?")
    expect(result).toContain('view=full')
    expect(result).toContain('token=%5BREDACTED%5D')
    expect(result).toContain("--header 'Accept: application/json'")
    expect(result).toContain("--header 'X-Debug: first line second line'")
    expect(result).toContain("--data-raw '{")
    expect(result).toContain('"name": "kept"')
    expect(result).toContain('Review before sharing or running.')
    expect(result).toContain('arbitrary URL paths and body text can remain')
    expect(result).not.toContain('Authorization:')
    expect(result).not.toContain('Cookie:')
    expect(result).not.toContain('Content-Length:')
    expect(result).not.toContain('password@example.com')
    expect(result).not.toContain('token=secret')
    expect(result).not.toContain('#private')
  })

  it.skipIf(process.platform === 'win32')('replays bracketed paths literally in one cURL request', async () => {
    const received: string[] = []
    const server = createServer((request, response) => {
      received.push(request.url ?? '')
      response.end('ok')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture server address')
      for (const path of ['/items/[draft]', '/items/[1-3]']) {
        const command = formatNetworkRequestCopy(requestDetails({
          url: `http://127.0.0.1:${address.port}${path}`,
          method: 'GET', request: { headers: {} }
        }), 'curl')
        const { stdout } = await promisify(execFile)('sh', ['-c', command], { timeout: 5_000 })
        expect(stdout).toBe('ok')
      }
      expect(received).toEqual(['/items/[draft]', '/items/[1-3]'])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it.skipIf(process.platform === 'win32')('replays HEAD without expecting the advertised response body', async () => {
    const received: string[] = []
    const server = createServer((request, response) => {
      received.push(request.method ?? '')
      response.writeHead(200, {
        'Content-Length': '20',
        Connection: 'close',
        'X-Fixture': 'head-response'
      })
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture server address')
      const command = formatNetworkRequestCopy(requestDetails({
        url: `http://127.0.0.1:${address.port}/head`,
        method: 'HEAD', request: { headers: {} }
      }), 'curl')
      const { stdout } = await promisify(execFile)('sh', ['-c', command], { timeout: 5_000 })
      expect(stdout).toContain('HTTP/1.1 200 OK')
      expect(stdout).toContain('Content-Length: 20')
      expect(stdout).toContain('X-Fixture: head-response')
      expect(received).toEqual(['HEAD'])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('escapes single quotes without allowing shell command injection', () => {
    const result = formatNetworkRequestCopy(requestDetails({
      url: "https://example.com/search?q=it's-safe",
      request: {
        headers: { 'X-Label': "owner's request" },
        body: { text: "value='kept'", originalChars: 12, truncated: false, redacted: false }
      }
    }), 'curl')

    expect(result).toContain("q=it%27s-safe")
    expect(result).toContain("--header 'X-Label: owner'\"'\"'s request'")
    expect(result).toContain("--data-raw 'value='\"'\"'kept'\"'\"''")
  })

  it('creates a fetch call with duplicate headers represented as header pairs', () => {
    const result = formatNetworkRequestCopy(requestDetails({
      method: 'GET',
      request: {
        headers: { Accept: ['application/json', 'text/plain'] }
      }
    }), 'fetch')

    expect(result).toContain('fetch("https://%5BREDACTED%5D:%5BREDACTED%5D@example.com/api/items?')
    expect(result).toContain('view=full')
    expect(result).toContain('token=%5BREDACTED%5D')
    expect(result).toContain('method: "GET"')
    expect(result).toMatch(/\[\s+"Accept",\s+"application\/json"\s+\]/)
    expect(result).toMatch(/\[\s+"Accept",\s+"text\/plain"\s+\]/)
  })

  it('omits truncated and non-text bodies instead of generating a misleading replay', () => {
    const truncated = formatNetworkRequestCopy(requestDetails({
      request: {
        headers: { 'Content-Type': 'application/json' },
        body: { text: '{"partial":', originalChars: 50_000, truncated: true, redacted: false }
      }
    }), 'fetch')
    const binary = formatNetworkRequestCopy(requestDetails({
      request: {
        headers: { 'Content-Type': 'application/octet-stream' },
        body: { text: '[non-text body omitted]', originalChars: 512, truncated: false, redacted: true }
      }
    }), 'curl')

    expect(truncated).toContain('the incomplete, oversized, or non-text request body was omitted')
    expect(truncated).not.toContain('body:')
    expect(binary).toContain('the incomplete, oversized, or non-text request body was omitted')
    expect(binary).not.toContain('--data-raw')
  })

  it('does not replay a JSON redaction failure placeholder as request data', () => {
    const details = requestDetails({ request: {
      headers: { 'Content-Type': 'application/json' },
      body: { text: '[JSON body omitted: could not safely redact]', originalChars: 24_000, truncated: false, redacted: true }
    } })
    expect(formatNetworkRequestCopy(details, 'curl')).not.toContain('--data-raw')
    expect(formatNetworkRequestCopy(details, 'fetch')).not.toContain('body:')
    expect(formatNetworkRequestCopy(details, 'curl')).toContain('request body was omitted')
  })

  it('omits oversized headers and bodies instead of creating partial replay data', () => {
    const result = formatNetworkRequestCopy(requestDetails({
      request: {
        headers: {
          Accept: 'application/json',
          'X-Oversized': 'h'.repeat(2_001)
        },
        body: {
          text: 'b'.repeat(20_001),
          originalChars: 20_001,
          truncated: false,
          redacted: false
        }
      }
    }), 'fetch')

    expect(result).toContain('1 sensitive, transport, invalid, or oversized header was omitted')
    expect(result).toContain('the incomplete, oversized, or non-text request body was omitted')
    expect(result).not.toContain('X-Oversized')
    expect(result).not.toContain('body:')
  })

  it('rejects invalid methods and non-HTTP request URLs', () => {
    const webSocket = requestDetails({ url: 'wss://example.com/socket', resourceType: 'websocket' })
    const invalidUrl = requestDetails({ url: 'not a URL' })
    const invalidMethod = requestDetails({ method: 'POST\r\nX-Injected: yes' })

    expect(canFormatNetworkRequestCopy(webSocket)).toBe(false)
    expect(canFormatNetworkRequestCopy(invalidUrl)).toBe(false)
    expect(canFormatNetworkRequestCopy(invalidMethod)).toBe(false)
    expect(() => formatNetworkRequestCopy(webSocket, 'curl')).toThrow(/only for HTTP\(S\)/)
    expect(() => formatNetworkRequestCopy(invalidUrl, 'fetch')).toThrow(/valid HTTP\(S\)/)
    expect(() => formatNetworkRequestCopy(invalidMethod, 'curl')).toThrow(/method cannot be represented/)
  })

  it('rejects an oversized URL instead of silently truncating it', () => {
    const details = requestDetails({ url: `https://example.com/search?q=${'a'.repeat(8_000)}` })

    expect(canFormatNetworkRequestCopy(details)).toBe(false)
    expect(() => formatNetworkRequestCopy(details, 'curl')).toThrow(/URL is too long/)
  })
  it('creates a sanitized PowerShell command with headers, content type and a UTF-8 body', () => {
    const result = formatNetworkRequestCopy(requestDetails({ request: {
      headers: { Accept: 'application/json', Authorization: '[REDACTED]', 'Content-Type': 'application/json', 'User-Agent': 'Fixture/1.0', 'X-Debug': 'first\r\nsecond' },
      body: { text: '{"name":"kept"}', originalChars: 15, truncated: false, redacted: false }
    } }), 'powershell')
    expect(result.split('\n')).toEqual([
      expect.stringMatching(/^# Sanitized by Hronaut: .*Review before sharing or running\.$/),
      '# For Windows PowerShell 5.1 or PowerShell 7 and later. Invoke-WebRequest follows redirects and stops with an error on an HTTP error status.',
      "Invoke-WebRequest -UseBasicParsing -Uri 'https://%5BREDACTED%5D:%5BREDACTED%5D@example.com/api/items?view=full&token=%5BREDACTED%5D' `",
      "  -Method 'POST' `",
      '  -Headers @{',
      "    'Accept' = 'application/json'",
      "    'X-Debug' = 'first second'",
      '  } `',
      "  -ContentType 'application/json' `",
      "  -UserAgent 'Fixture/1.0' `",
      `  -Body ([System.Text.Encoding]::UTF8.GetBytes('{"name":"kept"}'))`
    ])
    expect(result).not.toContain('Authorization')
  })

  it('doubles every PowerShell single quote and writes control characters as codes', () => {
    const body = "it's ‘quoted’ ‚low‛ $(Get-Date) `tick`\u0000end\r\nnext\tline\u001b[0m"
    const result = formatNetworkRequestCopy(requestDetails({ method: 'PUT', request: {
      headers: { 'X-Label': "owner's" },
      body: { text: body, originalChars: body.length, truncated: false, redacted: false }
    } }), 'powershell')
    expect(result).toContain("    'X-Label' = 'owner''s'")
    expect(result).toContain("-Body ([System.Text.Encoding]::UTF8.GetBytes(('it''s ‘‘quoted’’ ‚‚low‛‛ $(Get-Date) `tick`' + [char]0x00 + 'end' + [char]0x0D + '\nnext' + [char]0x09 + 'line' + [char]0x1B + '[0m')))")
  })

  it('starts a PowerShell value that opens with control characters with text, so + joins instead of adding codes', () => {
    const body = '\r\n{}'
    const result = formatNetworkRequestCopy(requestDetails({ request: {
      headers: { 'Content-Type': '\u0001' },
      body: { text: body, originalChars: body.length, truncated: false, redacted: false }
    } }), 'powershell')
    expect(result).toContain("  -ContentType ('' + [char]0x01) `")
    expect(result).toContain("-Body ([System.Text.Encoding]::UTF8.GetBytes(('' + [char]0x0D + '\n{}')))")
  })

  it.each([
    [{ method: 'PROPFIND' }, 'Copy PowerShell supports GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, TRACE and MERGE requests. Use Copy cURL or Copy fetch instead.'],
    [{ method: 'GET', request: { headers: {}, body: { text: 'q=1', originalChars: 3, truncated: false, redacted: false } } }, 'Copy PowerShell cannot send a request body with GET or HEAD. Use Copy cURL or Copy fetch instead.'],
    [{ request: { headers: { Accept: ['application/json', 'text/plain'] } } }, 'Copy PowerShell cannot send the same header more than once. Use Copy cURL or Copy fetch instead.'],
    [{ request: { headers: { 'X-Trace': 'a', 'x-trace': 'b' } } }, 'Copy PowerShell cannot send the same header more than once. Use Copy cURL or Copy fetch instead.'],
    [{ request: { headers: { 'X-Allowed': 'private-before\u0000private-after' } } }, 'Copy PowerShell cannot send literal NUL characters in a header. Use Copy fetch instead.']
  ] satisfies Array<[Partial<BrowserNetworkRequestDetails>, string]>)('refuses a PowerShell copy it cannot send faithfully (%#)', (overrides, message) => {
    expect(() => formatNetworkRequestCopy(requestDetails(overrides), 'powershell')).toThrow(new Error(message))
  })

  it('leaves out an empty GET body and keeps the request copyable as PowerShell', () => {
    const result = formatNetworkRequestCopy(requestDetails({ method: 'GET', request: { headers: {}, body: { text: '', originalChars: 0, truncated: false, redacted: false } } }), 'powershell')
    expect(result).toContain("-Method 'GET'")
    expect(result).not.toContain('-Body')
  })

  describe.runIf(powerShells.length > 0)('PowerShell replay', () => {
    for (const shell of powerShells) {
      it(`sends exactly the copied request in ${shell}, with shell syntax kept literal`, { timeout: 60_000 }, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hronaut-powershell-copy-'))
        try {
          await withFixtureServer(async (origin, received) => {
            const body = "\r\n\tliteral ' ‘quoted’ $(Write-Output injected) `text` ; % [x] café 😀\r\nline two\n'; $sentinel = 'changed'; '"
            const command = formatNetworkRequestCopy(requestDetails({
              url: `${origin}/items/[draft]/100%25?q=%24x&name=it%27s`, method: 'POST',
              request: {
                headers: {
                  Accept: 'application/json', 'Content-Type': 'text/plain; charset=utf-8', 'User-Agent': 'Fixture/1.0 (it\'s)',
                  'X-Punctuation': "'; $($sentinel = 'changed') `n ; %", 'X-Tab': 'a\tb', 'X-Empty': '', Authorization: 'private-canary', Cookie: 'private-cookie'
                },
                body: { text: body, originalChars: body.length, truncated: false, redacted: false }
              }
            }), 'powershell')
            expect(command).not.toContain('private-canary')
            expect(command).not.toContain('private-cookie')
            const script = join(directory, 'copy.ps1')
            // A byte-order mark makes Windows PowerShell 5.1 read the file as UTF-8, as a pasted command is.
            await writeFile(script, `\uFEFF$sentinel = 'unchanged'\n${command} | Out-Null\nWrite-Output $sentinel\n`, 'utf8')
            const { stdout } = await promisify(execFile)(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { timeout: 45_000 })
            expect(stdout.trim()).toBe('unchanged')
            expect(received).toHaveLength(1)
            const request = received[0]!
            expect(request.method).toBe('POST')
            expect(request.url).toBe('/items/[draft]/100%25?q=%24x&name=it%27s')
            expect(request.body.toString('utf8')).toBe(body)
            expect(headerValues(request, 'accept')).toEqual(['application/json'])
            expect(headerValues(request, 'content-type')).toEqual(['text/plain; charset=utf-8'])
            expect(headerValues(request, 'user-agent')).toEqual(["Fixture/1.0 (it's)"])
            expect(headerValues(request, 'x-punctuation')).toEqual(["'; $($sentinel = 'changed') `n ; %"])
            expect(headerValues(request, 'x-tab')).toEqual(['a\tb'])
            expect(headerValues(request, 'x-empty')).toEqual([''])
            expect(headerValues(request, 'authorization')).toEqual([])
            expect(headerValues(request, 'cookie')).toEqual([])
          })
        } finally {
          await rm(directory, { recursive: true, force: true })
        }
      })

      it(`sends one GET and one HEAD in ${shell}`, { timeout: 60_000 }, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hronaut-powershell-copy-'))
        try {
          await withFixtureServer(async (origin, received) => {
            const commands = ['GET', 'HEAD'].map(method => formatNetworkRequestCopy(requestDetails({
              url: `${origin}/${method.toLowerCase()}`, method, request: { headers: { 'X-Control': 'kept' } }
            }), 'powershell'))
            const script = join(directory, 'copy.ps1')
            await writeFile(script, `\uFEFF${commands.map(command => `${command} | Out-Null`).join('\n')}\n`, 'utf8')
            await promisify(execFile)(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { timeout: 45_000 })
            expect(received.map(request => [request.method, request.url, headerValues(request, 'x-control'), request.body.length])).toEqual([
              ['GET', '/get', ['kept'], 0],
              ['HEAD', '/head', ['kept'], 0]
            ])
          })
        } finally {
          await rm(directory, { recursive: true, force: true })
        }
      })
    }
  })
})
