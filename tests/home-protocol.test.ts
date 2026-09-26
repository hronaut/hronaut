import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createHomeProtocolHandler } from '../src/main/platform/home-protocol.js'
import { buildMcpReadinessDiagnostic } from '../src/main/mcp/readiness.js'
import type { HomePageOptions } from '../src/shared/home.js'

describe('isolated Home protocol', () => {
  it('serves only Home and its built assets with a restrictive CSP and uncached status', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-home-protocol-'))
    const options: HomePageOptions = { locale: 'en-US', endpoint: 'http://127.0.0.1:47812/mcp', initialState: {
      name: 'hronaut', version: 'test', endpoint: 'http://127.0.0.1:47812/mcp', status: 'ready', startedAt: null,
      activeRequests: 0, totalRequests: 0, completedToolCalls: 0, paused: false, clients: [], recentActivity: [], toolMetrics: [], tools: [],
      readiness: buildMcpReadinessDiagnostic({ checkedAt: '', serverStatus: 'ready', startedAt: null, advertisedToolNames: [], clients: [] })
    } }
    try {
      await mkdir(join(directory, '.vite')); await mkdir(join(directory, 'assets'))
      await writeFile(join(directory, '.vite/manifest.json'), JSON.stringify({ 'src/home.ts': { file: 'assets/home.js', imports: ['tokens'], css: ['assets/home.css'] }, tokens: { css: ['assets/tokens.css'] } }))
      await writeFile(join(directory, 'assets/home.js'), 'export const mounted = true')
      const handle = createHomeProtocolHandler({ rendererDirectory: directory, state: () => options })
      const document = await handle(new Request('hronaut://home/'))
      expect(document.headers.get('content-security-policy')).toContain("script-src hronaut://home;")
      expect(await document.text()).toContain('href="/assets/tokens.css"')
      expect((await handle(new Request('hronaut://home/assets/home.js'))).headers.get('content-type')).toBe('text/javascript')
      const status = await handle(new Request('hronaut://home/api/status'))
      expect(status.headers.get('cache-control')).toBe('no-store')
      expect(await status.json()).toMatchObject({ version: 'test' })
      for (const url of ['hronaut://home.evil/', 'https://home/', 'hronaut://home/.vite/manifest.json', 'hronaut://home/assets/%2e%2e%2fsecret.js']) {
        expect((await handle(new Request(url))).status).toBe(404)
      }
      expect((await handle(new Request('hronaut://home/api/status', { method: 'POST' }))).status).toBe(404)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
