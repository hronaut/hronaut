import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const INSTALL_MANIFEST_FIELDS = [
  'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies',
  'peerDependenciesMeta', 'engines', 'os', 'cpu', 'workspaces'
] as const

export function dependencyInstallManifest(source: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(INSTALL_MANIFEST_FIELDS
    .filter(field => source[field] !== undefined)
    .map(field => [field, source[field]]))
}

/** Only the root release version is normalized; every dependency remains locked. */
export function dockerInstallInputs(source: string): { manifest: string; lock: string } {
  const lock = JSON.parse(source) as {
    version?: string
    packages?: Record<string, Record<string, unknown>>
  }
  const root = lock.packages?.['']
  if (!root || typeof root.name !== 'string') throw new Error("package-lock.json must contain a named packages[''] entry")
  lock.version = '0.0.0'
  root.version = '0.0.0'
  const manifest = { name: root.name, version: root.version, private: true, ...dependencyInstallManifest(root) }
  return { manifest: JSON.stringify(manifest), lock: JSON.stringify(lock) }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [lockPath, outputDirectory] = process.argv.slice(2)
  if (!lockPath || !outputDirectory) {
    console.error('Usage: node scripts/docker-install-inputs.ts <package-lock.json> <output-directory>')
    process.exit(2)
  }
  const inputs = dockerInstallInputs(readFileSync(lockPath, 'utf8'))
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(join(outputDirectory, 'package.json'), inputs.manifest)
  writeFileSync(join(outputDirectory, 'package-lock.json'), inputs.lock)
}
