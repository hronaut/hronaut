import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'

const installFields = [
  'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies',
  'peerDependenciesMeta', 'engines', 'os', 'cpu', 'workspaces'
] as const
const unsupportedInstallFields = ['overrides', 'bundledDependencies', 'bundleDependencies'] as const
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, unknown>
const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
  packages?: Record<string, Record<string, unknown>>
}
const lockRoot = packageLock.packages?.['']

if (!lockRoot) {
  console.error("package-lock.json does not contain packages['']")
  process.exit(1)
}

for (const field of unsupportedInstallFields) {
  if (packageJson[field] !== undefined) {
    console.error(`package.json field ${field} is not supported by the optimized Docker dependency manifest`)
    process.exit(1)
  }
}

for (const field of installFields) {
  if (!isDeepStrictEqual(packageJson[field], lockRoot[field])) {
    console.error(`package.json and package-lock.json disagree on ${field}; run npm install before Docker tests`)
    process.exit(1)
  }
}
