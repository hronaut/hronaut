import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { isMainModule } from './is-main-module.ts'

interface CycloneDxComponent {
  type: string
  name: string
  version: string
  'bom-ref'?: string
  purl?: string
  description?: string
}
interface CycloneDxBom {
  bomFormat: string
  metadata?: { timestamp?: string; component?: { version?: string } }
  components?: CycloneDxComponent[]
}

/**
 * The CycloneDX SBOM published with a release: npm's list of the packages the app ships, plus Electron, which
 * electron-builder bundles from devDependencies, so a scanner sees the Chromium runtime too. The timestamp is the
 * release commit's time, as for the other generated release metadata.
 */
export function releaseSbom(npmBom: CycloneDxBom, electronVersion: string, version: string, generatedAt: string): CycloneDxBom {
  if (npmBom.bomFormat !== 'CycloneDX') throw new Error('npm sbom did not return a CycloneDX document')
  if (!/^\d+\.\d+\.\d+$/u.test(electronVersion)) throw new Error(`Unexpected Electron version: ${electronVersion}`)
  const components = (npmBom.components ?? []).filter((component) => component.name !== 'electron')
  components.push({
    type: 'framework',
    name: 'electron',
    version: electronVersion,
    'bom-ref': `electron@${electronVersion}`,
    purl: `pkg:npm/electron@${electronVersion}`,
    description: 'Electron runtime with Chromium and Node.js, bundled into the app'
  })
  return {
    ...npmBom,
    metadata: { ...npmBom.metadata, timestamp: generatedAt, component: { ...npmBom.metadata?.component, version } },
    components
  }
}

if (isMainModule(import.meta.url)) {
  const [output, version, generatedAt] = process.argv.slice(2)
  if (!output || !version || !generatedAt) throw new Error('Usage: node scripts/release-sbom.ts <output.cdx.json> <version> <generated-at>')
  const npmBom = JSON.parse(execFileSync('npm', ['sbom', '--sbom-format', 'cyclonedx', '--omit', 'dev', '--package-lock-only'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })) as CycloneDxBom
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages?: Record<string, { version?: string }> }
  const electronVersion = lock.packages?.['node_modules/electron']?.version ?? ''
  writeFileSync(output, `${JSON.stringify(releaseSbom(npmBom, electronVersion, version, generatedAt), null, 2)}\n`)
}
