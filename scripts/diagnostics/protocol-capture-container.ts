import { execFile } from 'node:child_process'

export interface ContainerOutcome { exitCode: number | null; killed: number; stopped: number }
export interface ContainerEngine {
  create(args: string[]): Promise<string>
  start(id: string): Promise<void>
  wait(id: string, signal?: AbortSignal): Promise<number>
  remove(id: string): Promise<void>
  absent(id: string): Promise<boolean>
}

// Docker control output is bounded metadata only. Container stdout/stderr are
// neither attached nor retained by a logging driver. Never include CLI errors.
async function docker(args: string[], signal?: AbortSignal, timeout = 15_000): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile('docker', args, { encoding: 'utf8', maxBuffer: 1024, timeout, signal }, (error, stdout) => {
      if (error) reject(new Error('Protocol container control unavailable'))
      else resolve(stdout.trim())
    })
  })
}
const idPattern = /^[a-f0-9]{64}$/
export const dockerEngine: ContainerEngine = {
  async create(args) {
    const id = await docker(['create', ...args])
    if (!idPattern.test(id)) throw new Error('Protocol container identity unavailable')
    return id
  },
  async start(id) { await docker(['start', id]) },
  async wait(id, signal) {
    const result = await docker(['wait', id], signal, 0)
    if (!/^\d{1,3}$/.test(result) || Number(result) > 255) throw new Error('Protocol container exit unavailable')
    return Number(result)
  },
  async remove(id) {
    await docker(['stop', '--time', '0', id])
    if (await docker(['inspect', '--format', '{{.State.Running}} {{.State.Pid}}', id]) !== 'false 0')
      throw new Error('Protocol container termination unverified')
    await docker(['rm', '--force', id])
  },
  async absent(id) { return await docker(['container', 'ls', '--all', '--no-trunc', '--filter', `id=${id}`, '--format', '{{.ID}}']) === '' }
}

export async function isolatedContainer(root: string, image: string, command: string[], signal?: AbortSignal, engine: ContainerEngine = dockerEngine, privateErrors = false): Promise<ContainerOutcome> {
  // Only an immutable local image ID; no implicit pull, tag resolution or build.
  if (!/^sha256:[a-f0-9]{64}$/.test(image) || !root.startsWith('/') || root.includes(',') || command.length === 0)
    return { exitCode: null, killed: 0, stopped: 0 }
  const uid = process.getuid?.()
  const gid = process.getgid?.()
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || uid! < 0 || gid! < 0)
    return { exitCode: null, killed: 0, stopped: 0 }
  if (signal?.aborted) return { exitCode: null, killed: 1, stopped: 1 }
  let id: string | undefined
  const result: ContainerOutcome = { exitCode: null, killed: 0, stopped: 0 }
  try {
    // Default private PID/IPC namespaces, no added capabilities, privileged mode,
    // host PID namespace, Docker socket, host ports or broader mounts.
    id = await engine.create(['--pull=never', '--user', `${uid}:${gid}`, '--init', '--network', 'bridge', '--log-driver', 'none',
      '--mount', `type=bind,source=${root},target=${root}`,
      // A second view of the same owned directory avoids Unix socket path overflow.
      // This is a real bind mount, not a symlink back to the long source path.
      '--mount', `type=bind,source=${root}/diagnostic-temp,target=/h-tmp`, '--workdir', root,
      ...(privateErrors ? ['--env', 'HRONAUT_PRIVATE_SYNTHETIC_ERRORS=1'] : []),
      '--env', 'CI=true', '--env', 'TMPDIR=/h-tmp',
      '--env', 'HRONAUT_TEST_ISOLATED_DISPLAYS=1', '--entrypoint', command[0]!, image, ...command.slice(1)])
    if (!idPattern.test(id)) throw new Error('Protocol container identity unavailable')
    if (!signal?.aborted) {
      await engine.start(id)
      result.exitCode = await engine.wait(id, signal)
    }
  } catch { /* Original exit is unknown unless Docker wait actually returned it. */ }
  finally {
    result.killed = signal?.aborted ? 1 : 0
    if (id && idPattern.test(id)) {
      try {
        // Docker tears down every process in the private PID namespace, including
        // detached Electron groups. Do not delete the bind-mounted copy first.
        await engine.remove(id)
        result.stopped = await engine.absent(id) ? 1 : 0
      } catch { /* Unverified containment teardown MUST retain the workspace. */ }
    }
  }
  return result
}
