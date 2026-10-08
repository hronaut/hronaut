import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUNDLE, digest, CASE_FILE, CASE_TITLE, assertPlainPath, removeCapture, verifyPrepared, type CaptureManifest } from './protocol-capture-loader.ts'
import { readBoundedFile, readCaptureFile, unknownCapture } from './protocol-capture-worker.ts'

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

export function readVerdict(path: string): { status: number; flaky: number; attempts: number[][] } {
  const unknown = { status: 0, flaky: 0, attempts: [] as number[][] }
  try {
    const raw = readBoundedFile(path, 1024)
    if (raw.byteLength > 1024) return unknown
    const data = JSON.parse(raw.toString('utf8'))
    if (Object.keys(data).sort().join('|') !== 'attempts|flaky|status' || !Number.isInteger(data.status) || data.status < 1 || data.status > 4 || (data.flaky !== 0 && data.flaky !== 1) || !Array.isArray(data.attempts) || data.attempts.length < 1 || data.attempts.length > 2) return unknown
    if (!data.attempts.every((row: unknown, index: number) => Array.isArray(row) && row.length === 2 && row[0] === index && Number.isInteger(row[1]) && row[1] >= 1 && row[1] <= 5)) return unknown
    return { status: data.status, flaky: data.flaky, attempts: data.attempts }
  } catch { return unknown }
}

// Explicit opt-in API only; no CLI, workflow, retries loop or implicit invocation.
// Caller must preserve original exitCode and separately gate artifactValid.
export async function runPreparedCapture(manifest: CaptureManifest, temporaryParent: string, outputFile: string, optIn: 'reviewed-single-capture', signal?: AbortSignal) {
  if (optIn !== 'reviewed-single-capture') throw new Error('Protocol capture requires explicit opt-in')
  let outcome: { exitCode: number | null; killed: number } = { exitCode: null, killed: 0 }
  let cleanup = 0
  let sourceUnchanged = 0
  let verdict = { status: 0, flaky: 0, attempts: [] as number[][] }
  let captures = [unknownCapture()]
  try {
    verifyPrepared(manifest)
    mkdirSync(join(manifest.root, 'diagnostic-output'), { mode: 0o700 })
    const cli = join(manifest.root, 'node_modules/@playwright/test/cli.js')
    assertPlainPath(manifest.root, cli)
    mkdirSync(join(manifest.root, 'diagnostic-temp'), { mode: 0o700 })
    const env: NodeJS.ProcessEnv = { CI: 'true', TMPDIR: join(manifest.root, 'diagnostic-temp') }
    for (const key of ['PATH', 'HOME', 'DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'LANG', 'LC_ALL'])
      if (process.env[key] !== undefined) env[key] = process.env[key]
    outcome = await isolatedProcess(process.execPath, [cli, 'test', CASE_FILE, '--grep', `${CASE_TITLE}$`, '--workers=1', '--reporter=./scripts/diagnostics/protocol-capture-reporter.ts'], manifest.root, env, signal)
    verdict = readVerdict(join(manifest.root, 'diagnostic-output/verdict.json'))
    // Expect both attempts only when the ORIGINAL runner actually attempted retry.
    captures = (verdict.attempts.length ? verdict.attempts : [[0, 0]]).map(([retry]) => readCaptureFile(join(manifest.root, `diagnostic-output/attempt-${retry}.json`)))
  } catch { /* Preserve any actual child result; missing diagnostic evidence is unknown. */ }
  finally {
    try { removeCapture(manifest, temporaryParent); cleanup = 1 } catch { /* Report rollback failure as a fixed numeric flag. */ }
    try {
      assertPlainPath(manifest.sourceRoot, join(manifest.sourceRoot, BUNDLE))
      sourceUnchanged = digest(readFileSync(join(manifest.sourceRoot, BUNDLE))) === manifest.sourceBundleHash ? 1 : 0
    } catch { /* A missing/changed original cannot be called a successful rollback. */ }
  }
  const artifactValid = cleanup === 1 && sourceUnchanged === 1 && outcome.killed === 0 && outcome.exitCode !== null && verdict.status !== 0 && captures.every(c => c.status !== 0) ? 1 : 0
  const result = { publication: 1, sourceUnchanged, exitCode: outcome.exitCode ?? -1, killed: outcome.killed, cleanup, artifactValid, verdict, captures }
  // Only this exact numeric/fixed-key object leaves the disposable workspace.
  try { writeFileSync(outputFile, JSON.stringify(result), { flag: 'wx', mode: 0o600 }) }
  catch { result.publication = 0; result.artifactValid = 0 }
  return result
}
