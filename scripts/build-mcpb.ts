import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { build } from 'esbuild'
import { createStoredZip } from './zip-archive.ts'

const root = resolve(import.meta.dirname, '..')
const outputDirectory = resolve(root, process.argv[2] || 'dist')
const stagingDirectory = join(outputDirectory, '.mcpb-staging')
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version: string }
const version = packageJson.version
const artifactName = `hronaut-mcp-adapter-${version}.mcpb`
const artifactPath = join(outputDirectory, artifactName)
const registryPath = join(outputDirectory, 'hronaut-mcp-server.json')

const manifest = {
  manifest_version: '0.3',
  name: 'hronaut-mcp-adapter',
  display_name: 'Hronaut Browser MCP',
  version,
  description: 'Connect MCP clients to the installed Hronaut desktop browser through its local endpoint.',
  long_description: 'This adapter connects stdio MCP clients to a running Hronaut desktop application. Hronaut remains visible and owns browser workspaces, permissions, authentication, licensing, updates, and human handoff.',
  author: { name: 'Hronaut', url: 'https://hronaut.dev' },
  repository: { type: 'git', url: 'https://github.com/hronaut/hronaut.git' },
  homepage: 'https://hronaut.dev',
  documentation: 'https://hronaut.dev/setup',
  support: 'https://github.com/hronaut/hronaut/issues',
  server: {
    type: 'node',
    entry_point: 'server/index.mjs',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/index.mjs'],
      env: {
        HRONAUT_MCP_URL: '${user_config.endpoint}',
        HRONAUT_MCP_TOKEN: '${user_config.token}'
      }
    }
  },
  tools_generated: true,
  keywords: ['browser', 'automation', 'coding-agents', 'mcp'],
  license: 'PolyForm-Noncommercial-1.0.0',
  privacy_policies: ['https://hronaut.dev/privacy'],
  compatibility: {
    platforms: ['darwin', 'win32', 'linux'],
    runtimes: { node: '>=22.0.0' }
  },
  user_config: {
    endpoint: {
      type: 'string',
      title: 'Hronaut MCP endpoint',
      description: 'Copy the loopback endpoint from Hronaut Home.',
      required: true,
      default: 'http://127.0.0.1:47812/mcp'
    },
    token: {
      type: 'string',
      title: 'Hronaut MCP token',
      description: 'Copy the token locally from Hronaut Home when authentication is enabled.',
      sensitive: true,
      required: false
    }
  }
}

await rm(stagingDirectory, { recursive: true, force: true })
await mkdir(join(stagingDirectory, 'server'), { recursive: true })
await build({
  entryPoints: [join(root, 'scripts/mcpb-adapter.ts')],
  outfile: join(stagingDirectory, 'server/index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none',
  sourcemap: false
})
await writeFile(join(stagingDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
const packageFiles = ['manifest.json', 'server/index.mjs', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']
const archiveEntries = await Promise.all(packageFiles.map(async (name) => ({
  name,
  data: await readFile(name === 'manifest.json' || name === 'server/index.mjs'
    ? join(stagingDirectory, name)
    : join(root, name))
})))
await writeFile(artifactPath, createStoredZip(archiveEntries))

const digest = createHash('sha256').update(await readFile(artifactPath)).digest('hex')
const registryMetadata = {
  $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
  name: 'io.github.hronaut/hronaut',
  title: 'Hronaut Browser MCP',
  description: 'Control visible, persistent Hronaut browser workspaces through a local MCP connection.',
  version,
  repository: { url: 'https://github.com/hronaut/hronaut', source: 'github' },
  websiteUrl: 'https://hronaut.dev',
  packages: [{
    registryType: 'mcpb',
    identifier: `https://github.com/hronaut/hronaut/releases/download/v${version}/${artifactName}`,
    version,
    fileSha256: digest,
    transport: { type: 'stdio' }
  }]
}
await writeFile(registryPath, `${JSON.stringify(registryMetadata, null, 2)}\n`)
await rm(stagingDirectory, { recursive: true, force: true })
process.stdout.write(`Built ${basename(artifactPath)} (${digest}) and ${basename(registryPath)}\n`)
