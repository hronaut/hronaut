import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  generateOperatorManifest,
  OPERATOR_MANIFEST_SCHEMA_VERSION
} from '../scripts/operator-manifest.js'
import { BROWSER_TOOL_CATALOG, mcpToolCatalogForSet } from '../src/main/mcp/server.js'
import { MCP_TOOL_SETS } from '../src/shared/mcp-tool-sets.js'

describe('version-matched operator manifest', () => {
  it('generates packaging metadata without loading the MCP server runtime', async () => {
    const result = await build({
      entryPoints: ['scripts/operator-manifest.ts'],
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      write: false,
      metafile: true
    })
    const runtimeInputs = Object.keys(result.metafile.inputs)
      .filter(path => path.startsWith('src/main/'))
    expect(runtimeInputs).toEqual(['src/main/mcp/tool-catalog.ts'])
    expect(result.metafile.outputs['operator-manifest.js']?.imports.every(entry =>
      entry.path.startsWith('node:')
    )).toBe(true)
  })

  it('derives every advertised tool set from the runtime catalog', () => {
    const manifest = generateOperatorManifest('9.8.7')

    expect(manifest.schemaVersion).toBe(OPERATOR_MANIFEST_SCHEMA_VERSION)
    expect(manifest.hronautVersion).toBe('9.8.7')
    expect(manifest.informationalOnly).toBe(true)
    expect(manifest.interfaces.mcp).toMatchObject({
      transport: 'streamable-http',
      networkScope: 'loopback-only',
      stdioAdapterArtifact: 'hronaut-mcp-adapter-9.8.7.mcpb',
      endpointAndCredentialsIncluded: false
    })
    expect(manifest.tools.map(({ name }) => name)).toEqual(BROWSER_TOOL_CATALOG.map(({ name }) => name))
    expect(manifest.toolSets).toEqual(Object.fromEntries(MCP_TOOL_SETS.map((toolSet) => [
      toolSet,
      mcpToolCatalogForSet(toolSet).map(({ name }) => name)
    ])))
  })

  it('keeps authority, ambiguous outcomes, and independent verification explicit', () => {
    const manifest = generateOperatorManifest('9.8.7')

    expect(manifest.context.manifestDoesNotGrantAuthority).toBe(true)
    expect(manifest.context.toolAvailabilityDoesNotGrantAuthority).toBe(true)
    expect(manifest.retry).toEqual({
      transportAcknowledgementIsVerification: false,
      blindRetryAfterUnknown: false,
      requireFreshObservationAfterInvalidation: true,
      requireReadBackBeforeRetryingPossibleSideEffect: true
    })
    expect(Object.keys(manifest.resultStates)).toEqual([
      'unsupported',
      'blocked',
      'unknown',
      'reconciliation_required',
      'verified'
    ])
    expect(manifest.operationFlow.at(-2)).toEqual({
      step: 'read-back',
      evidence: ['independent-authoritative-postcondition']
    })
  })

  it('contains policy only and never embeds live connection or browser data fields', () => {
    const manifest = generateOperatorManifest('9.8.7')
    const serialized = JSON.stringify(manifest)

    expect(manifest.interfaces.mcp).not.toHaveProperty('endpoint')
    expect(manifest.interfaces.mcp).not.toHaveProperty('token')
    expect(manifest.interfaces.mcp).not.toHaveProperty('authorization')
    expect(manifest.tools.every((tool) => (
      Object.keys(tool).every((key) => ['name', 'title', 'category', 'annotations'].includes(key))
    ))).toBe(true)
    expect(serialized).not.toMatch(/https?:\/\/127\.0\.0\.1/iu)
    expect(serialized).not.toContain('cookieValue')
    expect(serialized).not.toContain('formValue')
  })

  it('is deterministic and rejects an unversioned contract', () => {
    expect(generateOperatorManifest('9.8.7')).toEqual(generateOperatorManifest('9.8.7'))
    expect(() => generateOperatorManifest('latest')).toThrow('semantic Hronaut version')
  })

  it('documents the release download and read-back flow', async () => {
    const reference = await readFile('REFERENCE.md', 'utf8')

    expect(reference).toContain('hronaut-operator-manifest.json')
    expect(reference).toContain('independent bounded read-back')
    expect(reference).toMatch(/does not grant\s+authority/u)
  })
})
