import { spawn } from 'node:child_process'

// Synthetic unit-test process helper, NOT the diagnostic containment boundary.
// The same output route is tested with a synthetic process writing sentinel
// payloads to both descriptors. Never pipe these streams into hosted logs.
export async function isolatedProcess(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<{ exitCode: number | null; killed: number }> {
  if (signal?.aborted) return { exitCode: null, killed: 1 }
  return await new Promise(resolve => {
    const child = spawn(executable, args, { cwd, env, stdio: 'ignore', detached: true })
    let killed = 0
    const stopOwnedGroup = () => {
      if (child.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch { /* Already exited. */ } }
    }
    const terminate = () => { killed = 1; stopOwnedGroup() }
    signal?.addEventListener('abort', terminate, { once: true })
    child.once('error', () => { signal?.removeEventListener('abort', terminate); resolve({ exitCode: null, killed }) })
    child.once('close', code => { signal?.removeEventListener('abort', terminate); stopOwnedGroup(); resolve({ exitCode: code, killed }) })
  })
}

