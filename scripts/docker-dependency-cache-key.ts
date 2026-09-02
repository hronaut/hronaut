import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

interface PackageLock {
  name?: unknown
  version?: unknown
  packages?: Record<string, unknown>
  [key: string]: unknown
}

export function dependencyLockSource(source: string): string {
  const lock = JSON.parse(source) as PackageLock
  delete lock.name
  delete lock.version
  if (lock.packages) delete lock.packages['']
  return JSON.stringify(lock)
}

export function dependencyLockHash(source: string): string {
  return createHash('sha256').update(dependencyLockSource(source)).digest('hex')
}

export function dependencyCacheKey(inputs: {
  packageLockSource: string
  dockerfileSource: string
  cacheKeySource: string
  installManifestSource: string
}): string {
  return createHash('sha256')
    .update(dependencyLockSource(inputs.packageLockSource))
    .update(inputs.dockerfileSource)
    .update(inputs.cacheKeySource)
    .update(inputs.installManifestSource)
    .digest('hex')
    .slice(0, 20)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const packageLockPath = process.argv[2]
  if (!packageLockPath) {
    console.error('Usage: node scripts/docker-dependency-cache-key.ts <package-lock.json>')
    process.exit(2)
  }
  process.stdout.write(`${dependencyLockHash(readFileSync(packageLockPath, 'utf8'))}\n`)
}
