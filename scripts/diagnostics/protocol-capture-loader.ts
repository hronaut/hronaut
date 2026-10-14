import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { buildProtocolTimingOverlay } from './protocol-timing-overlay.ts'

export const CASE_TITLE = 'blocks a resumed write after navigation and rejects stale continuity reconciliation'
export const CASE_FILE = 'tests/integration/workspace-continuity.e2e.ts'
export const CASE_HASH = '92512d6b4ae437cc36cde892e2108d241ed69a5ddac792fc8b0053e17ee5d46e'
export const BUNDLE = 'node_modules/playwright-core/lib/coreBundle.js'
export const IDENTITY_MARKER = 'module.exports.__hronautProtocolTimingIdentity = '
export const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
export function fail(): never { throw new Error('Protocol capture boundary rejected') }

export interface CaptureManifest { root: string; bundleHash: string; identity: string; caseHash: string; fixtureHash: string; displayHash: string; sourceRoot: string; sourceBundleHash: string }
const CONFIG_HASH = '584d2559ae6a4e41ce5b9856d4ee72c56a0d2e7414a5cdf46afde19c23e5abfe'
const DISPLAY_HASH = 'dbeae9f61d8cdb29fb2791e4c3551c34ff8858dd139b3083ff6bd35165ad7841'
const FIXTURES_HASH = 'bb450c6a8adf6d0fea79c72ecdf9081835e7e834f8cc99fa8fffa4ff0511cc84'

export function verifyPrepared(manifest: CaptureManifest): void {
  const bundle = verifyResolution(manifest.root)
  const source = readFileSync(bundle, 'utf8')
  if (digest(source) !== manifest.bundleHash || overlayIdentity(source) !== manifest.identity) fail()
  for (const [path, hash] of [[CASE_FILE, manifest.caseHash], ['playwright.config.ts', CONFIG_HASH], ['tests/integration/fixtures.ts', manifest.fixtureHash], ['tests/integration/worker-display.ts', manifest.displayHash]]) {
    assertPlainPath(manifest.root, join(manifest.root, path!))
    if (digest(readFileSync(join(manifest.root, path!))) !== hash) fail()
  }
}

export function assertPlainPath(root: string, path: string): void {
  if (resolve(root) !== realpathSync(root)) fail()
  const rel = relative(root, path)
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || resolve(root, rel) !== path) fail()
  let current = root
  for (const part of rel.split(sep)) {
    current = join(current, part)
    if (lstatSync(current).isSymbolicLink()) fail()
  }
}

function assertPlainTree(root: string, path: string): void {
  assertPlainPath(root, path)
  if (lstatSync(path).isDirectory()) for (const child of readdirSync(path)) assertPlainTree(root, join(path, child))
}

export function overlayIdentity(source: string): string {
  const offset = source.lastIndexOf(IDENTITY_MARKER)
  if (offset < 0) fail()
  const identity = digest(source.slice(0, offset))
  if (source.slice(offset) !== `${IDENTITY_MARKER}"${identity}";\n`) fail()
  return identity
}

export function verifyResolution(root: string): string {
  const expected = join(root, BUNDLE)
  assertPlainPath(root, expected)
  for (const owner of ['package.json', 'node_modules/playwright/package.json', 'node_modules/@playwright/test/package.json']) {
    assertPlainPath(root, join(root, owner))
    const req = createRequire(join(root, owner))
    const packagePath = req.resolve('playwright-core/package.json')
    if (packagePath !== join(root, 'node_modules/playwright-core/package.json')) fail()
    assertPlainPath(root, packagePath)
  }
  return expected
}

export function verifyLoadedBundle(manifest: CaptureManifest, cache: NodeJS.Dict<NodeModule>): () => unknown {
  const bundle = verifyResolution(manifest.root)
  const source = readFileSync(bundle, 'utf8')
  if (digest(source) !== manifest.bundleHash || overlayIdentity(source) !== manifest.identity) fail()
  // No alternate loaded bundle, aliases, or already cached original exports.
  for (const [key, entry] of Object.entries(cache)) {
    if (!entry) continue
    const marked = entry.exports && typeof entry.exports === 'object' && Object.getOwnPropertyDescriptor(entry.exports, '__hronautProtocolTimingIdentity')
    const candidate = marked || key.endsWith('/coreBundle.js') || entry.filename?.endsWith('/coreBundle.js')
    if (candidate && (key !== bundle || entry.filename !== bundle)) fail()
  }
  const loaded = cache[bundle]
  if (!loaded || loaded.filename !== bundle || !loaded.loaded) fail()
  const exports: unknown = loaded.exports
  if (!exports || typeof exports !== 'object') fail()
  const identity = Object.getOwnPropertyDescriptor(exports, '__hronautProtocolTimingIdentity')?.value
  const snapshot = Object.getOwnPropertyDescriptor(exports, '__hronautProtocolTimingSnapshot')?.value
  if (identity !== manifest.identity || typeof snapshot !== 'function') fail()
  return snapshot as () => unknown
}

export function patchCaptureCase(source: string): string {
  if (digest(source) !== CASE_HASH) fail()
  const anchor = '  } finally {\n    await Promise.allSettled(clients.map(client => client.close()))'
  const end = source.indexOf("\ntest('retains the continuity guard across application restart until explicit fresh review'")
  if (end < 0 || source.slice(0, end).split(anchor).length !== 2) fail()
  const bridge = '    }, state.activeTabId)).toBe(false)'
  const bridgeStart = '    await expect.poll(() => appWindow.evaluate(async id => {'
  if (source.slice(0, end).split(bridgeStart).length !== 2) fail()
  if (source.slice(0, end).split(bridge).length !== 2) fail()
  return "import { recordStartup } from '../../scripts/diagnostics/protocol-capture-startup.js'\nimport { collectBeforeCleanup } from '../../scripts/diagnostics/protocol-capture-worker.js'\n" + source.slice(0, end).replace(bridgeStart, '    recordStartup(3, 1)\n' + bridgeStart).replace(bridge, bridge + '\n    recordStartup(3, 2)').replace(anchor,
    "  } finally {\n    collectBeforeCleanup(testInfo.retry)\n    await Promise.allSettled(clients.map(client => client.close()))") + source.slice(end)
}

export function patchCaptureFixture(source: string): string {
  if (digest(source) !== FIXTURES_HASH) fail()
  const anchor = '  const recorder = activityDiagnostics(app)\n  let cleanupFailed = false'
  if (source.split(anchor).length !== 2) fail()
  const admission = '    const instance = await launchHronaut(profileDirectory, mcpPort)'
  if (source.split(admission).length !== 2) fail()
  return "import { recordStartup, startupReason } from '../../scripts/diagnostics/protocol-capture-startup.js'\nimport { collectBeforeCleanup } from '../../scripts/diagnostics/protocol-capture-worker.js'\n" + source.replace(admission, `    recordStartup(9, 1)
    let instance: HronautInstance
    try { instance = await launchHronaut(profileDirectory, mcpPort) }
    catch (error) { recordStartup(9, 3, startupReason(error)); throw error }
    recordStartup(9, 2)`).replace(anchor,
    '  try { collectBeforeCleanup(base.info().retry) } catch { /* Diagnostic collection never replaces the original verdict. */ }\n' + anchor)
}

export function patchCaptureDisplay(source: string): string {
  if (digest(source) !== DISPLAY_HASH) fail()
  return "import { recordStartup, startupReason, startupSignal } from '../../scripts/diagnostics/protocol-capture-startup.js'\n" + source
    .replace("  const child = spawn('Xvfb', [", "  recordStartup(4, 1)\n  const child = spawn('Xvfb', [")
    .replace("  let stderr = ''", "  child.once('spawn', () => recordStartup(4, 2))\n  child.once('error', error => recordStartup(4, 3, startupReason(error)))\n  child.once('exit', (code, signal) => recordStartup(4, 4, startupSignal(signal), code))\n  let stderr = ''")
    .replace('    const display = await new Promise<string>', '    recordStartup(5, 1)\n    const display = await new Promise<string>')
    .replace('    return { display, close }', '    recordStartup(5, 2)\n    return { display, close }')
    .replace('  } catch (error) {\n    await close()', '  } catch (error) {\n    recordStartup(5, 3, startupReason(error))\n    await close()')
}

// Preparation only. This neither requires Playwright nor starts a child process.
function prepareCaptureInternal(sourceRoot: string, temporaryParent: string): CaptureManifest {
  const source = realpathSync(sourceRoot)
  if (source !== resolve(sourceRoot)) fail()
  const originalBundle = verifyResolution(source)
  for (const entry of Object.values(createRequire(import.meta.url).cache))
    if (entry?.filename?.endsWith('/coreBundle.js')) fail()
  for (const name of ['playwright-core', 'playwright', '@playwright/test']) assertPlainTree(source, join(source, 'node_modules', name))
  const version: unknown = JSON.parse(readFileSync(join(source, 'node_modules/playwright-core/package.json'), 'utf8')).version
  const generated = buildProtocolTimingOverlay(readFileSync(originalBundle, 'utf8'), typeof version === 'string' ? version : '')
  const test = patchCaptureCase(readFileSync(join(source, CASE_FILE), 'utf8'))
  const fixture = patchCaptureFixture(readFileSync(join(source, 'tests/integration/fixtures.ts'), 'utf8'))
  const display = patchCaptureDisplay(readFileSync(join(source, 'tests/integration/worker-display.ts'), 'utf8'))
  const parent = realpathSync(temporaryParent)
  if (parent === source || parent.startsWith(source + sep)) fail()
  const root = mkdtempSync(join(parent, 'hronaut-protocol-capture-'))
  try {
    // Exclude only top-level VCS/artifact caches. Preserve dependencies and app build.
    const excluded = new Set(['diagnostic-private', 'diagnostic-output', '.git', 'test-results', 'playwright-report', 'ci-artifacts', 'evidence'])
    cpSync(source, root, { recursive: true, dereference: false, filter: path => !excluded.has(relative(source, path).split(sep)[0] ?? '') })
    verifyResolution(root)
    rmSync(join(root, BUNDLE))
    writeFileSync(join(root, BUNDLE), generated, { flag: 'wx', mode: 0o600 })
    assertPlainPath(root, join(root, CASE_FILE))
    writeFileSync(join(root, CASE_FILE), test)
    assertPlainPath(root, join(root, 'tests/integration/fixtures.ts'))
    writeFileSync(join(root, 'tests/integration/fixtures.ts'), fixture)
    assertPlainPath(root, join(root, 'tests/integration/worker-display.ts'))
    writeFileSync(join(root, 'tests/integration/worker-display.ts'), display)
    const manifest = { root, bundleHash: digest(generated), identity: overlayIdentity(generated), caseHash: digest(test), fixtureHash: digest(fixture), displayHash: digest(display), sourceRoot: source, sourceBundleHash: digest(readFileSync(originalBundle)) }
    verifyPrepared(manifest)
    const manifestPath = join(root, 'scripts/diagnostics/capture-manifest.json')
    assertPlainPath(root, dirname(manifestPath))
    if (existsSync(manifestPath)) fail()
    writeFileSync(manifestPath, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 })
    return manifest
  } catch { rmSync(root, { recursive: true, force: true }); return fail() }
}

export function removeCapture(manifest: CaptureManifest, temporaryParent: string): void {
  const parent = realpathSync(temporaryParent)
  if (dirname(manifest.root) !== parent || !manifest.root.startsWith(join(parent, 'hronaut-protocol-capture-'))) fail()
  assertPlainPath(parent, manifest.root)
  rmSync(manifest.root, { recursive: true, force: true })
}

export function prepareCapture(sourceRoot: string, temporaryParent: string): CaptureManifest {
  try { return prepareCaptureInternal(sourceRoot, temporaryParent) }
  catch { return fail() }
}
