import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { BUNDLE, CASE_FILE, CASE_TITLE, digest, IDENTITY_MARKER, overlayIdentity, patchCaptureCase, patchCaptureFixture, prepareCapture, removeCapture, verifyLoadedBundle, verifyPrepared, verifyResolution, type CaptureManifest } from '../scripts/diagnostics/protocol-capture-loader.js'
import { captureBeforeCleanup, MAX_ARTIFACT_BYTES, readCaptureFile, sanitizeSnapshot } from '../scripts/diagnostics/protocol-capture-worker.js'
import { readVerdict, runPreparedCapture } from '../scripts/diagnostics/protocol-capture-runner.js'
import { createProtocolTiming } from '../scripts/diagnostics/protocol-timing-runtime.js'

import { isolatedProcess } from './helpers/protocol-synthetic-process.js'
const containment = vi.hoisted(() => ({ stopped: 1, interrupt: '' }))
vi.mock('../scripts/diagnostics/protocol-capture-container.ts', () => ({
  isolatedContainer: async (root: string, _image: string, command: string[], signal?: AbortSignal) => {
    if (containment.interrupt) process.emit(containment.interrupt as 'SIGTERM')
    const outcome = await isolatedProcess(process.execPath, command.slice(1), root, { CI: 'true' }, signal)
    return { ...outcome, stopped: containment.stopped }
  }
}))
const image = 'sha256:' + '1'.repeat(64)

const roots: string[] = []
const sentinel = 'PRIVATE_URL_EXPRESSION_TOKEN_ERROR_SENTINEL'
const write = (path: string, value: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value) }
const fresh = () => { const path = mkdtempSync(join(tmpdir(), 'protocol-loader-test-')); roots.push(path); return path }
function snapshot() {
  const timing = createProtocolTiming(); const owner = {}
  timing.register(owner, 1); timing.send(owner, { id: 1, method: 'Runtime.evaluate' }, 1)
  return timing.snapshot()
}
function prepared() {
  const parent = fresh(); const root = mkdtempSync(join(parent, 'hronaut-protocol-capture-'))
  for (const name of ['', 'node_modules/playwright', 'node_modules/@playwright/test', 'node_modules/playwright-core'])
    write(join(root, name, 'package.json'), '{"type":"commonjs"}')
  const body = '"use strict";\n'
  const bundle = body + `${IDENTITY_MARKER}"${digest(body)}";\n`
  write(join(root, BUNDLE), bundle)
  const caseSource = patchCaptureCase(readFileSync(CASE_FILE, 'utf8'))
  write(join(root, CASE_FILE), caseSource)
  write(join(root, 'playwright.config.ts'), readFileSync('playwright.config.ts', 'utf8'))
  const fixture = patchCaptureFixture(readFileSync('tests/integration/fixtures.ts', 'utf8'))
  write(join(root, 'tests/integration/fixtures.ts'), fixture)
  const sourceRoot = join(parent, 'original')
  write(join(sourceRoot, BUNDLE), bundle)
  const manifest: CaptureManifest = { root, sourceRoot, sourceBundleHash: digest(bundle), bundleHash: digest(bundle), identity: overlayIdentity(bundle), caseHash: digest(caseSource), fixtureHash: digest(fixture) }
  return { parent, root, manifest }
}
function cached(manifest: CaptureManifest, exports: unknown) {
  const path = join(manifest.root, BUNDLE)
  return { [path]: { filename: path, loaded: true, exports } } as unknown as NodeJS.Dict<NodeModule>
}
afterEach(() => { containment.stopped = 1; containment.interrupt = ''; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('disposable protocol loader and collector', () => {
  it('loads exported runner directly in Node without loading or launching Playwright', async () => {
    const url = new URL('../scripts/diagnostics/protocol-capture-runner.ts', import.meta.url).href
    const result = await isolatedProcess(process.execPath, ['--input-type=module', '-e',
      `const runner = await import(${JSON.stringify(url)}); if (typeof runner.runPreparedCapture !== 'function') process.exit(2);`], fresh(), {})
    expect(result.exitCode).toBe(0)
  })

  it('resolves all three package routes to the same plain pinned bundle', () => {
    const { manifest, root } = prepared()
    expect(verifyResolution(root)).toBe(join(root, BUNDLE))
    expect(() => verifyPrepared(manifest)).not.toThrow()
    const take = () => snapshot()
    expect(verifyLoadedBundle(manifest, cached(manifest, { __hronautProtocolTimingIdentity: manifest.identity, __hronautProtocolTimingSnapshot: take }))).toBe(take)
  })
  it('rejects nested resolution aliases and symlinked package paths', () => {
    const a = prepared()
    write(join(a.root, 'node_modules/playwright/node_modules/playwright-core/package.json'), '{}')
    expect(() => verifyResolution(a.root)).toThrow('boundary rejected')
    const b = prepared(); const real = join(b.root, BUNDLE)
    const target = join(b.parent, 'outside.js'); write(target, readFileSync(real, 'utf8')); rmSync(real); symlinkSync(target, real)
    expect(() => verifyResolution(b.root)).toThrow('boundary rejected')
    expect(readFileSync(target, 'utf8')).toContain('use strict')
  })
  it('rejects preloaded original, missing cache, alternate cached bundle, and stale identities', () => {
    const { manifest } = prepared()
    for (const exports of [{}, { __hronautProtocolTimingIdentity: 'old', __hronautProtocolTimingSnapshot: snapshot }])
      expect(() => verifyLoadedBundle(manifest, cached(manifest, exports))).toThrow('boundary rejected')
    expect(() => verifyLoadedBundle(manifest, {})).toThrow('boundary rejected')
    const cache = cached(manifest, { __hronautProtocolTimingIdentity: manifest.identity, __hronautProtocolTimingSnapshot: snapshot })
    cache['/alias.js'] = cache[join(manifest.root, BUNDLE)]
    expect(() => verifyLoadedBundle(manifest, cache)).toThrow('boundary rejected')
  })
  it('rejects changed bundle, directives, fixture/config or workload before launch', () => {
    for (const file of [BUNDLE, CASE_FILE, 'playwright.config.ts', 'tests/integration/fixtures.ts']) {
      const { manifest, root } = prepared(); write(join(root, file), sentinel)
      expect(() => verifyPrepared(manifest)).toThrow()
    }
    expect(() => patchCaptureCase(readFileSync(CASE_FILE, 'utf8') + '\n')).toThrow()
  })
  it('injects primary snapshot before all existing case/fixture cleanup, leaving body unchanged', () => {
    const original = readFileSync(CASE_FILE, 'utf8'); const patched = patchCaptureCase(original)
    expect(patched).toContain('  } finally {\n    collectBeforeCleanup(testInfo.retry)\n    await Promise.allSettled(clients.map(client => client.close()))')
    expect(patched.replace("import { collectBeforeCleanup } from '../../scripts/diagnostics/protocol-capture-worker.js'\n", '').replace('    collectBeforeCleanup(testInfo.retry)\n', '')).toBe(original)
    expect(new RegExp(`${CASE_TITLE}$`).test(`electron workspace-continuity.e2e.ts ${CASE_TITLE}`)).toBe(true)
  })
  it('captures timeout fallback before fixture diagnostics even when case finally has not run', () => {
    const original = readFileSync('tests/integration/fixtures.ts', 'utf8')
    const patched = patchCaptureFixture(original)
    const start = patched.indexOf('  try { await use(app) } catch')
    const primary = patched.indexOf('collectBeforeCleanup(base.info().retry)', start)
    expect(primary).toBeGreaterThan(start)
    expect(primary).toBeLessThan(patched.indexOf('const collect = () => collectRendererDiagnostics(app)', start))
    expect(primary).toBeLessThan(patched.indexOf('await attachActivityDiagnostics(app, info)', start))
    expect(primary).toBeLessThan(patched.indexOf('await closeHronaut(app)', start))
    expect(patched.replace("import { collectBeforeCleanup } from '../../scripts/diagnostics/protocol-capture-worker.js'\n", '')
      .replace('  try { collectBeforeCleanup(base.info().retry) } catch { /* Diagnostic collection never replaces the original verdict. */ }\n', '')).toBe(original)
    const file = join(fresh(), 'first.json')
    captureBeforeCleanup(snapshot, data => writeFileSync(file, data, { flag: 'wx' }))
    const first = readFileSync(file, 'utf8')
    captureBeforeCleanup(() => { throw new Error(sentinel) }, data => writeFileSync(file, data, { flag: 'wx' }))
    expect(readFileSync(file, 'utf8')).toBe(first)
  })

  it('preserves original body/cleanup error identity and captures before cleanup traffic', () => {
    const error = new Error(sentinel); const cleanupError = new Error('cleanup')
    for (const cleanupFails of [false, true]) {
      const order: string[] = []; let caught: unknown
      try { try { throw error } finally {
        captureBeforeCleanup(() => { order.push('snapshot'); return snapshot() }, () => { order.push('write'); throw new Error(sentinel) })
        const cleanup = () => { order.push('cleanup'); if (cleanupFails) throw cleanupError }
        cleanup()
      } } catch (failure) { caught = failure }
      expect(caught).toBe(cleanupFails ? cleanupError : error)
      expect(order).toEqual(['snapshot', 'write', 'cleanup'])
    }
  })
  it('maps missing, empty, invalid, timed-out or throwing snapshots to explicit unknown', () => {
    expect(readCaptureFile(join(fresh(), 'missing')).status).toBe(0)
    const invalid = [{}, { ...snapshot(), transports: 64 }, { ...snapshot(), rejectedTransports: 1 }, { ...snapshot(), observerErrors: 1 }, { ...snapshot(), total: 0, rows: [] }, { ...snapshot(), secret: sentinel }]
    for (const value of invalid) expect(sanitizeSnapshot(value).status).toBe(0)
    let output = ''
    captureBeforeCleanup(() => { throw new Error(sentinel) }, data => { output = data })
    expect(JSON.parse(output).status).toBe(0); expect(output).not.toContain(sentinel)
  })
  it('rejects nonnumeric/accessor/oversized payloads without serializing them', () => {
    const base = snapshot()
    for (const field of [NaN, Infinity, -1, sentinel, { secret: sentinel }])
      expect(sanitizeSnapshot({ ...base, rows: [[1, 1, 1, field, 0, 0, 1]] }).status).toBe(0)
    const poisoned = { ...base, get rows() { throw new Error(sentinel) } }
    expect(sanitizeSnapshot(poisoned).status).toBe(0)
    const file = join(fresh(), 'huge'); write(file, sentinel.repeat(MAX_ARTIFACT_BYTES))
    expect(readCaptureFile(file).status).toBe(0)
    expect(sanitizeSnapshot({ ...base, total: 2049, rows: Array(2049).fill(base.rows[0]) }).status).toBe(0)
  })
  it('reports eviction as partial and retains bounded numeric-only rows', () => {
    const base = snapshot()
    const result = sanitizeSnapshot({ ...base, total: 3000, dropped: 952, rows: Array.from({ length: 2048 }, () => [...base.rows[0]!]) })
    expect(result.status).toBe(2); expect(result.dropped).toBe(952)
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(MAX_ARTIFACT_BYTES)
  })
  it('prepares an exclusive disposable copy and leaves original pinned source unchanged', () => {
    const { root, parent } = prepared()
    const req = createRequire(import.meta.url)
    const installed = dirname(req.resolve('playwright-core/package.json'))
    const source = readFileSync(join(installed, 'lib/coreBundle.js'), 'utf8')
    write(join(root, BUNDLE), source)
    write(join(root, 'node_modules/playwright-core/package.json'), '{"version":"1.63.0"}')
    write(join(root, CASE_FILE), readFileSync(CASE_FILE, 'utf8'))
    write(join(root, 'tests/integration/fixtures.ts'), readFileSync('tests/integration/fixtures.ts', 'utf8'))
    mkdirSync(join(root, 'scripts/diagnostics'), { recursive: true })
    const result = prepareCapture(root, parent)
    expect(result.root).not.toBe(root)
    expect(() => verifyPrepared(result)).not.toThrow()
    expect(readFileSync(join(root, BUNDLE), 'utf8')).toBe(source)
    expect(readFileSync(join(result.root, CASE_FILE), 'utf8')).toContain('collectBeforeCleanup(testInfo.retry)')
    removeCapture(result, parent); expect(existsSync(root)).toBe(true)
  })

  it('rejects wrong source pin without making a disposable copy or touching source', () => {
    const { root, parent } = prepared(); const before = readFileSync(join(root, BUNDLE), 'utf8')
    expect(() => prepareCapture(root, parent)).toThrow()
    expect(readFileSync(join(root, BUNDLE), 'utf8')).toBe(before)
  })
  it('cleans only the owned disposable root and rejects foreign/symlink cleanup targets', () => {
    const { root, parent, manifest } = prepared(); removeCapture(manifest, parent); expect(existsSync(root)).toBe(false)
    expect(() => removeCapture({ ...manifest, root: parent }, parent)).toThrow()
    const b = prepared(); const link = join(b.parent, 'hronaut-protocol-capture-link'); symlinkSync(b.root, link)
    expect(() => removeCapture({ ...b.manifest, root: link }, b.parent)).toThrow(); expect(existsSync(b.root)).toBe(true)
  })
  it('discards sentinel stdout/stderr via the actual child route and preserves nonzero exit', async () => {
    const result = await isolatedProcess(process.execPath, ['-e', `process.stdout.write('${sentinel}'); process.stderr.write('${sentinel}'); process.exit(7)`], fresh(), {})
    expect(result).toEqual({ exitCode: 7, killed: 0 }); expect(JSON.stringify(result)).not.toContain(sentinel)
  })
  it('records killed and spawn-failed workers as unknown rather than empty success', async () => {
    const controller = new AbortController()
    const pending = isolatedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], fresh(), {}, controller.signal)
    controller.abort()
    expect(await pending).toEqual({ exitCode: null, killed: 1 })
    expect((await isolatedProcess('/nonexistent/diagnostic', [], fresh(), {})).exitCode).toBeNull()
  })
  it('exports only sanitized records, preserves exit/flaky verdict, and rolls back raw artifacts', async () => {
    const { manifest, parent, root } = prepared()
    const clean = sanitizeSnapshot(snapshot())
    write(join(root, 'node_modules/@playwright/test/cli.js'), `const fs=require('fs'); console.log('${sentinel}'); console.error('${sentinel}');
fs.writeFileSync('raw-trace.zip','${sentinel}');
fs.writeFileSync('diagnostic-output/attempt-0.json',${JSON.stringify(JSON.stringify(clean))});
fs.writeFileSync('diagnostic-output/attempt-1.json',${JSON.stringify(JSON.stringify(clean))});
import(${JSON.stringify(new URL('../scripts/diagnostics/protocol-capture-reporter.ts', import.meta.url).href)}).then(({default: Reporter}) => {
const reporter = new Reporter(); reporter.onTestEnd({outcome:()=> 'unexpected'}, {retry:0,status:'failed',error:{message:'${sentinel}'}});
reporter.onTestEnd({outcome:()=> 'flaky'}, {retry:1,status:'passed'}); reporter.onEnd({status:'failed'}); process.exit(1);
});`)
    const output = join(parent, 'sanitized.json')
    const result = await runPreparedCapture(manifest, parent, output, 'reviewed-single-capture', image)
    expect(result.exitCode).toBe(1); expect(result.verdict.flaky).toBe(1); expect(result.artifactValid).toBe(1)
    expect(readFileSync(output, 'utf8')).not.toContain(sentinel); expect(existsSync(root)).toBe(false)
  })
  it('cannot turn passed child with missing snapshot into valid diagnostic evidence', async () => {
    const { manifest, parent, root } = prepared()
    write(join(root, 'node_modules/@playwright/test/cli.js'), "require('fs').writeFileSync('diagnostic-output/verdict.json',JSON.stringify({status:1,flaky:0,attempts:[[0,1]]}))")
    const result = await runPreparedCapture(manifest, parent, join(parent, 'out.json'), 'reviewed-single-capture', image)
    expect(result.exitCode).toBe(0); expect(result.artifactValid).toBe(0); expect(result.captures[0]!.status).toBe(0)
    expect(existsSync(root)).toBe(false)
  })
  it('rolls back a cancelled invocation and reports missing timeout snapshots explicitly', async () => {
    for (const cancel of [true, false]) {
      const { manifest, parent, root } = prepared()
      write(join(root, 'node_modules/@playwright/test/cli.js'), "require('fs').writeFileSync('diagnostic-output/verdict.json',JSON.stringify({status:3,flaky:0,attempts:[[0,3]]}));process.exit(1)")
      const controller = new AbortController(); if (cancel) controller.abort()
      const result = await runPreparedCapture(manifest, parent, join(parent, 'out.json'), 'reviewed-single-capture', image, controller.signal)
      expect(result.exitCode).toBe(cancel ? -1 : 1)
      expect(result.killed).toBe(cancel ? 1 : 0)
      expect(result.artifactValid).toBe(0); expect(result.captures[0]!.status).toBe(0)
      expect(result.cleanup).toBe(1); expect(existsSync(root)).toBe(false)
    }
  })

  it('does not overwrite existing output or replace original exit when publication fails', async () => {
    const { manifest, parent, root } = prepared()
    write(join(root, 'node_modules/@playwright/test/cli.js'), 'process.exit(9)')
    const output = join(parent, 'out.json'); write(output, sentinel)
    const result = await runPreparedCapture(manifest, parent, output, 'reviewed-single-capture', image)
    expect(result.exitCode).toBe(9); expect(result.publication).toBe(0); expect(result.artifactValid).toBe(0)
    expect(readFileSync(output, 'utf8')).toBe(sentinel); expect(existsSync(root)).toBe(false)
  })

  it('maps SIGINT and SIGTERM at the actual caller to awaited cancellation and restores handlers', async () => {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const { manifest, parent, root } = prepared()
      write(join(root, 'node_modules/@playwright/test/cli.js'), 'process.exit(0)')
      const before = process.listenerCount(signal)
      containment.interrupt = signal
      const result = await runPreparedCapture(manifest, parent, join(parent, 'out.json'), 'reviewed-single-capture', image)
      expect(result.killed).toBe(1); expect(result.exitCode).toBe(-1)
      expect(result.containmentStopped).toBe(1); expect(result.cleanup).toBe(1)
      expect(result.artifactValid).toBe(0); expect(existsSync(root)).toBe(false)
      expect(process.listenerCount(signal)).toBe(before)
    }
  })

  it('retains the disposable copy and refuses cleanup success when containment stop is unverified', async () => {
    const { manifest, parent, root } = prepared()
    write(join(root, 'node_modules/@playwright/test/cli.js'), 'process.exit(8)')
    containment.stopped = 0
    const result = await runPreparedCapture(manifest, parent, join(parent, 'out.json'), 'reviewed-single-capture', image)
    expect(result.exitCode).toBe(8); expect(result.containmentStopped).toBe(0)
    expect(result.cleanup).toBe(0); expect(result.artifactValid).toBe(0)
    expect(existsSync(root)).toBe(true)
  })

  it('does not accept arbitrary reporter payloads', () => {
    const path = join(fresh(), 'verdict')
    for (const value of [{ status: 1, flaky: 0, attempts: [[0, 1]], payload: sentinel }, { status: 1, flaky: 0, attempts: [] }, { status: 1, flaky: 0, attempts: [[sentinel, 1]] }]) {
      write(path, JSON.stringify(value)); expect(readVerdict(path).status).toBe(0)
    }
  })
})
