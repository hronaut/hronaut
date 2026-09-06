import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir, release } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron, expect } from '@playwright/test'

// Packaged Windows execution plus independent native OS clipboard and pointer input.
if (process.platform !== 'win32') throw new Error('This preflight requires an interactive native Windows desktop')
assert.equal(process.arch, 'x64')
const proof = resolve('test-results/windows-native')
await mkdir(proof, { recursive: true })
const packageInfo = JSON.parse(await readFile('package.json', 'utf8')) as { version: string; devDependencies: { electron: string } }
const executablePath = resolve(process.argv[2] ?? '')
const asarPath = resolve(executablePath, '../resources/app.asar')
await writeFile(join(proof, 'provenance.json'), JSON.stringify({source: process.env.GITHUB_SHA, kernel: release(), executablePath, asarSha256: createHash('sha256').update(await readFile(asarPath)).digest('hex')}, null, 2))
const profile = await mkdtemp(join(tmpdir(), 'hronaut-windows-native-'))
const native = (action: string, label = '', output = ''): string => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-File', resolve('scripts/windows-native-ui.ps1'), '-Action', action, '-Label', label, '-OutputPath', output], {encoding:'utf8', timeout:30_000})
const app = await _electron.launch({ executablePath, args: [], env: {
  ...process.env, HRONAUT_USER_DATA_DIR: profile, HRONAUT_DOWNLOAD_DIR: profile,
  HRONAUT_MCP_HOST: '127.0.0.1', HRONAUT_MCP_PORT: '47991'
} })
const checks: string[] = []
const save = async (): Promise<void> => { await writeFile(join(proof, 'checks.json'), JSON.stringify(checks, null, 2)) }
const screenshot = (name: string): void => { native('screenshot', '', join(proof, `${name}.png`)) }
const nativeMenu = (label: string): void => { native('tray'); native('menu', label) }

try {
  const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), electron: process.versions.electron, arch: process.arch, path: app.getAppPath() }))
  assert.equal(identity.packaged, true)
  assert.equal(identity.version, packageInfo.version)
  assert.equal(identity.electron, packageInfo.devDependencies.electron)
  assert.equal(identity.arch, 'x64')
  assert.equal(resolve(identity.path).toLowerCase(), asarPath.toLowerCase())
  await writeFile(join(proof, 'runtime.json'), JSON.stringify(identity, null, 2))
  checks.push('native packaged runtime identity'); await save()
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  const text = `Hronaut native clipboard ${randomUUID()}`
  await window.evaluate(`window.hronaut.copyText(${JSON.stringify(text)})`)
  assert.equal(native('text'), text)
  checks.push('independent native text clipboard reader'); await save()
  const state = await window.evaluate("window.hronaut.newTab({url:'data:text/html,<title>Native clipboard</title><main style=background:cyan;height:200px>Native PNG fixture</main>',active:true})") as { activeTabId: string }
  await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().some(page => page.getURL().startsWith('data:text/html') && !page.isLoading()))).toBe(true)
  native('clear')
  await window.evaluate(`window.hronaut.capturePage({tabId:${JSON.stringify(state.activeTabId)}})`)
  const image = native('image').trim()
  assert.match(image, /^\d+x\d+$/)
  await writeFile(join(proof, 'native-image.txt'), image)
  checks.push('independent Windows clipboard image reader'); await save()
  screenshot('normal')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.hide())
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(false)
  nativeMenu('Show Hronaut')
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(true)
  checks.push('native tray Show restores programmatically hidden window'); await save()
  nativeMenu('Check for Updates…')
  await expect(window.getByRole('region', { name: 'Software update status' })).toBeVisible()
  screenshot('updates')
  checks.push('native tray Updates opens UI without download/install'); await save()
  const closed = app.waitForEvent('close', { timeout: 15_000 })
  nativeMenu('Quit')
  await closed
  checks.push('native tray Quit exits packaged process'); await save()
} catch (error) {
  await writeFile(join(proof, 'failure.txt'), String(error))
  try { screenshot('failure') } catch { /* Preserve original failure if screen capture is unavailable. */ }
  throw error
} finally {
  await app.close().catch(() => undefined)
}
