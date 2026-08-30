import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const cachePrefix = 'hronaut-focused-node-modules-'
const mode = process.argv[2]
const forwardedArguments = process.argv.slice(3)

if (mode === 'prune') {
  const list = spawnSync('docker', ['volume', 'ls', '--filter', `name=^${cachePrefix}`, '--quiet'], {
    encoding: 'utf8'
  })
  if (list.status !== 0) process.exit(list.status ?? 1)
  const volumes = list.stdout.split(/\r?\n/u).filter((name) => name.startsWith(cachePrefix))
  if (volumes.length === 0) {
    console.log('No Hronaut focused Docker dependency caches found.')
    process.exit(0)
  }
  process.exit(spawnSync('docker', ['volume', 'rm', ...volumes], { stdio: 'inherit' }).status ?? 1)
}

if (mode !== 'unit' && mode !== 'integration' && mode !== 'integration-all') {
  console.error('Usage: node scripts/run-focused-docker.ts <unit|integration|integration-all|prune> [test arguments]')
  process.exit(2)
}
if (mode === 'integration-all' && forwardedArguments.length > 0) {
  console.error('integration-all runs the complete Electron suite and does not accept test arguments')
  process.exit(2)
}

const manifestCheck = spawnSync(process.execPath, ['scripts/verify-dependency-manifest.ts'], {
  stdio: 'inherit'
})
if (manifestCheck.status !== 0) process.exit(manifestCheck.status ?? 1)

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, unknown>
const installFields = [
  'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies',
  'peerDependenciesMeta', 'engines', 'os', 'cpu', 'workspaces'
]
const installManifest = Object.fromEntries(
  installFields.filter((field) => packageJson[field] !== undefined).map((field) => [field, packageJson[field]])
)

const dependencyCacheKey = createHash('sha256')
  .update(readFileSync('package-lock.json'))
  .update(readFileSync('Dockerfile.test'))
  .update(JSON.stringify(installManifest))
  .digest('hex')
  .slice(0, 20)
const volumeName = `${cachePrefix}${dependencyCacheKey}`
const volumeCreate = spawnSync('docker', ['volume', 'create', volumeName], {
  stdio: ['ignore', 'ignore', 'inherit']
})
if (volumeCreate.status !== 0) process.exit(volumeCreate.status ?? 1)

const testCommand = mode === 'unit'
  ? ['npm', 'test', '--', ...forwardedArguments]
  : mode === 'integration-all'
    ? ['bash', 'scripts/run-integration-suite-docker.sh']
    : ['bash', 'scripts/run-focused-integration-docker.sh', ...forwardedArguments]
const composeArguments = [
  'compose',
  '--project-name', `hronaut-focused-${dependencyCacheKey}`,
  '--file', 'compose.test.ci.yaml',
  '--file', 'compose.test.focused.yaml',
  'run', '--build', '--rm', 'integration',
  'bash', 'scripts/run-with-verified-dependencies.sh',
  ...testCommand
]
const result = spawnSync('docker', composeArguments, {
  env: {
    ...process.env,
    HRONAUT_DEPENDENCY_CACHE_KEY: dependencyCacheKey,
    ...(mode === 'integration-all' ? { HRONAUT_INTEGRATION_SKIP_TYPECHECK: 'true' } : {})
  },
  stdio: 'inherit'
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
