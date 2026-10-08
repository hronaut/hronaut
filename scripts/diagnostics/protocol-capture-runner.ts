import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isolatedContainer, type ContainerOutcome } from './protocol-capture-container.ts'
import { BUNDLE, digest, CASE_FILE, CASE_TITLE, assertPlainPath, removeCapture, verifyPrepared, type CaptureManifest } from './protocol-capture-loader.ts'
import { readBoundedFile, readCaptureFile, unknownCapture } from './protocol-capture-worker.ts'

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
export async function runPreparedCapture(manifest: CaptureManifest, temporaryParent: string, outputFile: string, optIn: 'reviewed-single-capture', image: string, signal?: AbortSignal) {
  if (optIn !== 'reviewed-single-capture') throw new Error('Protocol capture requires explicit opt-in')
  // The actual caller owns cancellation through the entire awaited teardown.
  // Do not process.exit from signal handlers: container stop must finish first.
  const cancellation = new AbortController()
  const abort = () => cancellation.abort()
  if (signal?.aborted) abort()
  signal?.addEventListener('abort', abort, { once: true })
  process.on('SIGINT', abort)
  process.on('SIGTERM', abort)
  let outcome: ContainerOutcome = { exitCode: null, killed: 0, stopped: 1 }
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
    outcome = await isolatedContainer(manifest.root, image, ['node', cli, 'test', CASE_FILE, '--grep', `${CASE_TITLE}$`, '--workers=1', '--reporter=./scripts/diagnostics/protocol-capture-reporter.ts'], cancellation.signal)
    verdict = readVerdict(join(manifest.root, 'diagnostic-output/verdict.json'))
    // Expect both attempts only when the ORIGINAL runner actually attempted retry.
    captures = (verdict.attempts.length ? verdict.attempts : [[0, 0]]).map(([retry]) => readCaptureFile(join(manifest.root, `diagnostic-output/attempt-${retry}.json`)))
  } catch { /* Preserve any actual child result; missing diagnostic evidence is unknown. */ }
  finally {
    try { if (outcome.stopped === 1) { removeCapture(manifest, temporaryParent); cleanup = 1 } } catch { /* Report rollback failure as a fixed numeric flag. */ }
    try {
      assertPlainPath(manifest.sourceRoot, join(manifest.sourceRoot, BUNDLE))
      sourceUnchanged = digest(readFileSync(join(manifest.sourceRoot, BUNDLE))) === manifest.sourceBundleHash ? 1 : 0
    } catch { /* A missing/changed original cannot be called a successful rollback. */ }
    signal?.removeEventListener('abort', abort)
    process.off('SIGINT', abort)
    process.off('SIGTERM', abort)
  }
  const artifactValid = cleanup === 1 && sourceUnchanged === 1 && outcome.killed === 0 && outcome.exitCode !== null && verdict.status !== 0 && captures.every(c => c.status !== 0) ? 1 : 0
  const result = { publication: 1, sourceUnchanged, containmentStopped: outcome.stopped, exitCode: outcome.exitCode ?? -1, killed: outcome.killed, cleanup, artifactValid, verdict, captures }
  // Only this exact numeric/fixed-key object leaves the disposable workspace.
  try { writeFileSync(outputFile, JSON.stringify(result), { flag: 'wx', mode: 0o600 }) }
  catch { result.publication = 0; result.artifactValid = 0 }
  return result
}
