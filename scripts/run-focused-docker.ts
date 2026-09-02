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

const dependencyLockHash = spawnSync(
  process.execPath,
  ['scripts/docker-dependency-cache-key.ts', 'package-lock.json'],
  { encoding: 'utf8' }
)
if (dependencyLockHash.status !== 0) process.exit(dependencyLockHash.status ?? 1)
const dependencyCacheKey = createHash('sha256')
  .update(dependencyLockHash.stdout.trim())
  .update(readFileSync('Dockerfile.test'))
  .update(readFileSync('scripts/docker-dependency-cache-key.ts'))
  .update(JSON.stringify(installManifest))
  .digest('hex')
  .slice(0, 20)
const volumeName = `${cachePrefix}${dependencyCacheKey}`
const volumeCreate = spawnSync('docker', ['volume', 'create', volumeName], {
  stdio: ['ignore', 'ignore', 'inherit']
})
if (volumeCreate.status !== 0) process.exit(volumeCreate.status ?? 1)
const imageName = `hronaut-focused-${dependencyCacheKey}-integration`
const imageAvailable = spawnSync('docker', ['image', 'inspect', imageName], {
  stdio: 'ignore'
}).status === 0
const composeBaseArguments = [
  'compose',
  '--project-name', `hronaut-focused-${dependencyCacheKey}`,
  '--file', 'compose.test.ci.yaml',
  '--file', 'compose.test.focused.yaml'
]
const focusedDockerEnvironment = {
  ...process.env,
  HRONAUT_DEPENDENCY_CACHE_KEY: dependencyCacheKey,
  ...(mode === 'integration-all' ? { HRONAUT_INTEGRATION_SKIP_TYPECHECK: 'true' } : {})
}

if (!imageAvailable) {
  const imageBuild = spawnSync(
    'docker',
    [...composeBaseArguments, 'build', 'integration'],
    { env: focusedDockerEnvironment, stdio: 'inherit' }
  )
  if (imageBuild.error) console.error(imageBuild.error.message)
  if (imageBuild.status !== 0) process.exit(imageBuild.status ?? 1)
}

const cacheBootstrapScript = `
source_marker=/workspace/node_modules/.hronaut-package-lock.sha256
ready_marker=/cache/.hronaut-cache-ready.sha256
expected_hash="$(tr -d '[:space:]' < "$source_marker")"
actual_hash=""
if [[ -f "$ready_marker" ]]; then
  actual_hash="$(tr -d '[:space:]' < "$ready_marker")"
fi
if [[ "$actual_hash" == "$expected_hash" ]]; then
  exit 0
fi
find /cache -mindepth 1 -maxdepth 1 ! -name .hronaut-bootstrap.lock -exec rm -rf -- {} +
cp -a /workspace/node_modules/. /cache/
printf '%s\n' "$expected_hash" > "$ready_marker.tmp"
mv "$ready_marker.tmp" "$ready_marker"
`
const cacheBootstrap = spawnSync('docker', [
  'run', '--rm',
  '--mount', `type=volume,source=${volumeName},target=/cache`,
  imageName,
  'flock', '/cache/.hronaut-bootstrap.lock',
  'bash', '-ceu', cacheBootstrapScript
], { stdio: 'inherit' })
if (cacheBootstrap.error) console.error(cacheBootstrap.error.message)
if (cacheBootstrap.status !== 0) process.exit(cacheBootstrap.status ?? 1)

const testCommand = mode === 'unit'
  ? ['npm', 'test', '--', ...forwardedArguments]
  : mode === 'integration-all'
    ? ['bash', 'scripts/run-integration-suite-docker.sh']
    : ['bash', 'scripts/run-focused-integration-docker.sh', ...forwardedArguments]
const composeArguments = [
  ...composeBaseArguments,
  'run', '--rm', 'integration',
  'bash', 'scripts/run-with-verified-dependencies.sh',
  ...testCommand
]
const result = spawnSync('docker', composeArguments, {
  env: focusedDockerEnvironment,
  stdio: 'inherit'
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
