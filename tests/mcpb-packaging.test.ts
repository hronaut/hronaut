import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { Ajv } from 'ajv'
import formatsPlugin from 'ajv-formats'
import express from 'express'
import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { readStoredZipEntries } from '../scripts/zip-archive.js'

const outputDirectory = join(import.meta.dirname, '.mcpb-output')

beforeAll(() => {
  const result = spawnSync(process.execPath, ['scripts/build-mcpb.ts', outputDirectory], {
    cwd: join(import.meta.dirname, '..'),
    encoding: 'utf8'
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
})

describe('MCPB release package', () => {
  it('contains only the adapter, metadata, and public license notices', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
    const artifact = join(outputDirectory, `hronaut-mcp-adapter-${packageJson.version}.mcpb`)
    const entries = readStoredZipEntries(await readFile(artifact))
    expect(entries.map(({ name }) => name)).toEqual([
      'manifest.json',
      'server/index.mjs',
      'LICENSE',
      'NOTICE',
      'THIRD_PARTY_NOTICES.md'
    ])
  })

  it('keeps manifest and registry metadata aligned with the desktop release', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
    const artifactName = `hronaut-mcp-adapter-${packageJson.version}.mcpb`
    const artifact = await readFile(join(outputDirectory, artifactName))
    const metadata = JSON.parse(await readFile(join(outputDirectory, 'hronaut-mcp-server.json'), 'utf8'))
    expect(metadata).toMatchObject({
      $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
      name: 'io.github.hronaut/hronaut',
      version: packageJson.version,
      packages: [{
        registryType: 'mcpb',
        identifier: `https://github.com/hronaut/hronaut/releases/download/v${packageJson.version}/${artifactName}`,
        version: packageJson.version,
        transport: { type: 'stdio' }
      }]
    })
    expect(metadata.packages[0].fileSha256)
      .toBe(createHash('sha256').update(artifact).digest('hex'))

    const entries = readStoredZipEntries(artifact)
    const manifestEntry = entries.find(({ name }) => name === 'manifest.json')
    expect(manifestEntry).toBeDefined()
    const manifest = JSON.parse(Buffer.from(manifestEntry?.data ?? []).toString('utf8'))
    expect(manifest).toMatchObject({
      manifest_version: '0.3',
      name: 'hronaut-mcp-adapter',
      version: packageJson.version,
      license: 'PolyForm-Noncommercial-1.0.0',
      tools_generated: true,
      server: { type: 'node', entry_point: 'server/index.mjs' },
      user_config: { token: { sensitive: true, required: false } }
    })
    expect(manifest.server.mcp_config.args).toEqual(['${__dirname}/server/index.mjs'])

    const ajv = new Ajv({ allErrors: true, strict: false })
    const addFormats = formatsPlugin as unknown as (validator: Ajv) => Ajv
    addFormats(ajv)
    const manifestSchema = JSON.parse(await readFile(
      'packaging/mcpb/schemas/mcpb-manifest-v0.3.schema.json', 'utf8'
    ))
    const registrySchema = JSON.parse(await readFile(
      'packaging/mcpb/schemas/server-2025-12-11.schema.json', 'utf8'
    ))
    expect(ajv.validate(manifestSchema, manifest), ajv.errorsText()).toBe(true)
    expect(ajv.validate(registrySchema, metadata), ajv.errorsText()).toBe(true)
  })

  it('initializes and calls a tool through the bundled stdio-to-HTTP adapter', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
    const artifact = await readFile(join(outputDirectory, `hronaut-mcp-adapter-${packageJson.version}.mcpb`))
    const adapter = readStoredZipEntries(artifact).find(({ name }) => name === 'server/index.mjs')
    expect(adapter).toBeDefined()
    const adapterDirectory = join(outputDirectory, 'bundle with spaces')
    await mkdir(adapterDirectory, { recursive: true })
    const adapterPath = join(adapterDirectory, 'adapter smoke.mjs')
    await writeFile(adapterPath, adapter?.data ?? new Uint8Array())

    const app = express()
    app.use(express.json())
    let session: { server: McpServer, transport: StreamableHTTPServerTransport } | undefined
    app.all('/mcp', async (request, response) => {
      if (!session) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          enableJsonResponse: true
        })
        const server = new McpServer({ name: 'adapter-smoke', version: '1.0.0' })
        server.registerTool('echo', {
          description: 'Return a test value',
          inputSchema: { value: z.string() }
        }, ({ value }) => ({ content: [{ type: 'text', text: value }] }))
        await server.connect(transport)
        session = { server, transport }
      }
      await session.transport.handleRequest(request, response, request.body)
    })
    const httpServer = createServer(app)
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject)
      httpServer.listen(0, '127.0.0.1', resolve)
    })
    const address = httpServer.address()
    if (!address || typeof address === 'string') throw new Error('Smoke server did not expose a port')

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [adapterPath],
      env: {
        ...getDefaultEnvironment(),
        HRONAUT_MCP_URL: `http://127.0.0.1:${address.port}/mcp`
      },
      stderr: 'pipe'
    })
    const client = new Client({ name: 'adapter-smoke-client', version: '1.0.0' })
    try {
      await client.connect(transport)
      const result = await client.callTool({ name: 'echo', arguments: { value: 'adapter-ready' } })
      expect(result.content).toEqual([{ type: 'text', text: 'adapter-ready' }])
    } finally {
      await client.close()
      if (session) await session.server.close()
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    }
  }, 15_000)
})
