import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { Ajv } from 'ajv'
import formatsPlugin from 'ajv-formats'
import express from 'express'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { readStoredZipEntries } from '../scripts/zip-archive.js'

const rootDirectory = join(import.meta.dirname, '..')
let outputDirectory = ''

beforeAll(async () => {
  const cacheDirectory = join(rootDirectory, 'node_modules/.cache')
  await mkdir(cacheDirectory, { recursive: true })
  outputDirectory = await mkdtemp(join(cacheDirectory, 'hronaut-mcpb-test-'))
  const result = spawnSync(process.execPath, ['scripts/build-mcpb.ts', outputDirectory], {
    cwd: rootDirectory,
    encoding: 'utf8'
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
})

afterAll(async () => {
  if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true })
})

describe('MCPB release package', () => {
  it('generates operator metadata when the output directory is a symlink', async () => {
    const directory = await mkdtemp(join(rootDirectory, 'node_modules/.cache/hronaut-mcpb-symlink-'))
    const output = join(directory, 'actual')
    const alias = join(directory, 'alias')
    try {
      await mkdir(output)
      await symlink(output, alias, process.platform === 'win32' ? 'junction' : 'dir')
      const result = spawnSync(process.execPath, ['scripts/build-mcpb.ts', alias], { cwd: rootDirectory, encoding: 'utf8' })
      expect(result.status, result.stderr || result.stdout).toBe(0)
      const manifest = JSON.parse(await readFile(join(alias, 'hronaut-operator-manifest.json'), 'utf8'))
      const packageJson = JSON.parse(await readFile(join(rootDirectory, 'package.json'), 'utf8'))
      expect(manifest.hronautVersion).toBe(packageJson.version)
      expect(manifest.tools.length).toBeGreaterThan(0)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

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

  it('keeps adapter, registry, and operator metadata aligned with the desktop release', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
    const publicFacts = JSON.parse(await readFile('docs/PUBLIC_FACTS.json', 'utf8')) as {
      product: { licenseIdentifier: string }
      mcpRegistry: { name: string; registryType: string }
    }
    const artifactName = `hronaut-mcp-adapter-${packageJson.version}.mcpb`
    const artifact = await readFile(join(outputDirectory, artifactName))
    const metadata = JSON.parse(await readFile(join(outputDirectory, 'hronaut-mcp-server.json'), 'utf8'))
    expect(metadata).toMatchObject({
      $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
      name: publicFacts.mcpRegistry.name,
      version: packageJson.version,
      packages: [{
        registryType: publicFacts.mcpRegistry.registryType,
        identifier: `https://github.com/hronaut/hronaut/releases/download/v${packageJson.version}/${artifactName}`,
        version: packageJson.version,
        transport: { type: 'stdio' }
      }]
    })
    expect(metadata.packages[0].fileSha256)
      .toBe(createHash('sha256').update(artifact).digest('hex'))
    const operatorManifest = JSON.parse(await readFile(
      join(outputDirectory, 'hronaut-operator-manifest.json'),
      'utf8'
    ))
    expect(operatorManifest).toMatchObject({
      schemaVersion: '1.0',
      hronautVersion: packageJson.version,
      kind: 'hronaut-operator-contract',
      informationalOnly: true,
      interfaces: {
        mcp: {
          networkScope: 'loopback-only',
          stdioAdapterArtifact: artifactName,
          endpointAndCredentialsIncluded: false
        }
      }
    })
    expect(operatorManifest.toolSets.complete).toEqual(operatorManifest.tools.map(({ name }: { name: string }) => name))

    const entries = readStoredZipEntries(artifact)
    const manifestEntry = entries.find(({ name }) => name === 'manifest.json')
    expect(manifestEntry).toBeDefined()
    const manifest = JSON.parse(Buffer.from(manifestEntry?.data ?? []).toString('utf8'))
    expect(manifest).toMatchObject({
      manifest_version: '0.3',
      name: 'hronaut-mcp-adapter',
      version: packageJson.version,
      license: publicFacts.product.licenseIdentifier,
      documentation: `https://github.com/hronaut/hronaut/blob/v${packageJson.version}/docs/MCPB_ADAPTER.md`,
      tools_generated: true,
      server: {
        type: 'node',
        entry_point: 'server/index.mjs',
        mcp_config: {
          env: {
            HRONAUT_MCP_URL: '${user_config.endpoint}',
            HRONAUT_MCP_TOKEN_FILE: '${user_config.token_file}'
          }
        }
      },
      user_config: {
        token_file: { type: 'file', required: false }
      }
    })
    expect(manifest.user_config).not.toHaveProperty('token')
    expect(manifest.user_config.token_file).not.toHaveProperty('sensitive')
    expect(manifest.server.mcp_config.env).not.toHaveProperty('HRONAUT_MCP_TOKEN')
    expect(manifest.user_config.token_file.description).toContain('path shown on Hronaut Home')
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

  it.skipIf(process.platform !== 'linux')('extracts as readable regular files with a standard Linux ZIP tool', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
    const artifact = join(outputDirectory, `hronaut-mcp-adapter-${packageJson.version}.mcpb`)
    const extractionDirectory = await mkdtemp(join(tmpdir(), 'hronaut-mcpb-extract-'))
    try {
      const extraction = spawnSync('unzip', ['-q', artifact, '-d', extractionDirectory], {
        encoding: 'utf8'
      })
      expect(extraction.status, extraction.stderr || extraction.stdout).toBe(0)

      const adapterPath = join(extractionDirectory, 'server/index.mjs')
      for (const name of ['manifest.json', 'server/index.mjs', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
        expect((await stat(join(extractionDirectory, name))).mode & 0o777, name).toBe(0o644)
      }

      const syntaxCheck = spawnSync(process.execPath, ['--check', adapterPath], { encoding: 'utf8' })
      expect(syntaxCheck.status, syntaxCheck.stderr || syntaxCheck.stdout).toBe(0)
    } finally {
      await rm(extractionDirectory, { recursive: true, force: true })
    }
  })

  it('initializes and calls a tool through the bundled stdio-to-HTTP adapter', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
    const artifactPath = join(outputDirectory, `hronaut-mcp-adapter-${packageJson.version}.mcpb`)
    const artifact = await readFile(artifactPath)
    let extractionDirectory: string | undefined
    let adapterPath: string
    if (process.platform === 'linux') {
      extractionDirectory = await mkdtemp(join(tmpdir(), 'hronaut-mcpb-smoke-'))
      const extraction = spawnSync('unzip', ['-q', artifactPath, '-d', extractionDirectory], {
        encoding: 'utf8'
      })
      expect(extraction.status, extraction.stderr || extraction.stdout).toBe(0)
      adapterPath = join(extractionDirectory, 'server/index.mjs')
    } else {
      const adapter = readStoredZipEntries(artifact).find(({ name }) => name === 'server/index.mjs')
      expect(adapter).toBeDefined()
      const adapterDirectory = join(outputDirectory, 'bundle with spaces')
      await mkdir(adapterDirectory, { recursive: true })
      adapterPath = join(adapterDirectory, 'adapter smoke.mjs')
      await writeFile(adapterPath, adapter?.data ?? new Uint8Array())
    }

    const token = 'b'.repeat(64)
    const tokenPath = join(outputDirectory, 'owner-token')
    await writeFile(tokenPath, `${token}\n`, { mode: 0o600 })
    const app = express()
    app.use(express.json())
    let session: { server: McpServer, transport: StreamableHTTPServerTransport } | undefined
    let terminationRequests = 0
    app.all('/mcp', async (request, response) => {
      if (request.headers.authorization !== `Bearer ${token}`) {
        response.status(401).end()
        return
      }
      if (request.method === 'DELETE') terminationRequests += 1
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
        HRONAUT_MCP_URL: `http://127.0.0.1:${address.port}/mcp`,
        HRONAUT_MCP_TOKEN_FILE: tokenPath
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
      await vi.waitFor(() => expect(terminationRequests).toBe(1))
      if (session) await session.server.close()
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
      if (extractionDirectory) await rm(extractionDirectory, { recursive: true, force: true })
    }
  }, 15_000)

  it('documents the private file handoff and the verified compatibility boundary', async () => {
    const [guide, readme] = await Promise.all([
      readFile('docs/MCPB_ADAPTER.md', 'utf8'),
      readFile('README.md', 'utf8')
    ])
    const normalizedGuide = guide.replace(/\s+/gu, ' ')

    expect(readme).toContain('[MCPB adapter guide](docs/MCPB_ADAPTER.md)')
    expect(normalizedGuide).toContain('Home displays the owner-only token file path, not the raw token')
    expect(normalizedGuide).toContain('select that file in the host\'s **Hronaut MCP token file** field')
    expect(normalizedGuide).toContain('leave the token-file field empty')
    expect(normalizedGuide).toContain('Disconnect and reconnect the bundle')
    expect(normalizedGuide).toContain('does not prove that a graphical MCPB host installed or exposed the tools')
    expect(normalizedGuide).toContain('No specific graphical MCPB host/version has completed this end-to-end path yet')
    expect(guide).not.toContain('copy the token locally from Hronaut Home')
  })
})
