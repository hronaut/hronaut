import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedPackagedMcpSmokeProfile } from './packaged-mcp-smoke-profile.js'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const executable = join(repositoryRoot, 'dist', 'linux-unpacked', 'hronaut')
const profileDirectory = await mkdtemp(join(tmpdir(), 'hronaut-packaged-smoke-'))
await seedPackagedMcpSmokeProfile(profileDirectory)

async function availableLoopbackPort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => resolve())
  })
  const address = probe.address()
  if (!address || typeof address === 'string') throw new Error('Could not allocate a loopback port')
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return address.port
}

async function waitForServer(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return
    } catch {
      // The packaged process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Packaged Hronaut MCP server did not start')
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code))
  })
}

const mcpPort = await availableLoopbackPort()
const applicationEnvironment = {
  ...process.env,
  HRONAUT_MCP_HOST: '127.0.0.1',
  HRONAUT_MCP_PORT: String(mcpPort),
  HRONAUT_USER_DATA_DIR: profileDirectory,
  HRONAUT_DOWNLOAD_DIR: profileDirectory
}
const application = spawn('xvfb-run', ['--auto-servernum', executable], {
  cwd: repositoryRoot,
  detached: true,
  env: applicationEnvironment,
  stdio: ['ignore', 'pipe', 'pipe']
})
application.stdout.pipe(process.stdout)
application.stderr.pipe(process.stderr)

try {
  await waitForServer(mcpPort)
  const smoke = spawn(process.execPath, ['scripts/mcp-smoke.ts'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      HRONAUT_MCP_URL: `http://127.0.0.1:${mcpPort}/mcp`,
      HRONAUT_MCP_TOKEN: ''
    },
    stdio: 'inherit'
  })
  const smokeExitCode = await waitForExit(smoke)
  if (smokeExitCode !== 0) throw new Error(`Packaged MCP smoke exited with code ${smokeExitCode}`)
} finally {
  const stopApplicationGroup = (signal: NodeJS.Signals): void => {
    if (!application.pid) return
    try {
      process.kill(-application.pid, signal)
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ESRCH') throw error
    }
  }
  if (application.exitCode === null) {
    // Exercise the packaged single-instance shutdown path so profile/MCP state
    // is flushed before Xvfb is stopped. Signals remain a bounded fallback.
    const quitRequest = spawn('xvfb-run', ['--auto-servernum', executable, '--quit'], {
      cwd: repositoryRoot,
      env: applicationEnvironment,
      stdio: 'ignore'
    })
    await Promise.race([
      waitForExit(quitRequest),
      new Promise<void>((resolve) => setTimeout(resolve, 3_000))
    ])
  }
  if (application.exitCode === null) {
    await Promise.race([
      waitForExit(application),
      new Promise<void>((resolve) => setTimeout(resolve, 7_000))
    ])
  }
  if (application.exitCode === null) {
    stopApplicationGroup('SIGTERM')
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000))
  }
  if (application.exitCode === null) stopApplicationGroup('SIGKILL')
  await rm(profileDirectory, { recursive: true, force: true })
}
