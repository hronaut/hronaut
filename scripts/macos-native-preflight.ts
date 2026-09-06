import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir, release } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron, expect } from '@playwright/test'

// Deliberately a native, packaged smoke: no Electron/clipboard/tray implementation mocks.
if (process.platform !== 'darwin') throw new Error('This preflight requires a native macOS GUI session')
const appBundle = resolve(process.argv[2] ?? '')
const architecture = process.argv[3]
assert.ok(['arm64', 'x64'].includes(architecture ?? ''), 'Expected native architecture')
assert.equal(process.arch, architecture, 'Do not substitute cross-packaging for native execution')
const proof = resolve('test-results/macos-native')
await mkdir(proof, { recursive: true })
const packageInfo = JSON.parse(await readFile('package.json', 'utf8')) as { version: string; devDependencies: { electron: string } }
const executablePath = join(appBundle, 'Contents/MacOS/Hronaut')
const asarPath = join(appBundle, 'Contents/Resources/app.asar')
await writeFile(join(proof, 'provenance.json'), JSON.stringify({
  source: process.env.GITHUB_SHA, architecture, kernel: release(),
  macOS: execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
  appBundle, asarSha256: createHash('sha256').update(await readFile(asarPath)).digest('hex'),
  minimumSystemVersion: execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :LSMinimumSystemVersion', join(appBundle, 'Contents/Info.plist')], { encoding: 'utf8' }).trim()
}, null, 2))
assert.equal(execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :LSMinimumSystemVersion', join(appBundle, 'Contents/Info.plist')], { encoding: 'utf8' }).trim(), '13.0')
const profile = await mkdtemp(join(tmpdir(), 'hronaut-macos-native-'))
const app = await _electron.launch({ executablePath, args: [], env: {
  ...process.env, HRONAUT_USER_DATA_DIR: profile, HRONAUT_DOWNLOAD_DIR: profile,
  HRONAUT_MCP_HOST: '127.0.0.1', HRONAUT_MCP_PORT: '47991'
} })
const checks: string[] = []
const save = async (): Promise<void> => { await writeFile(join(proof, 'checks.json'), JSON.stringify(checks, null, 2)) }
const screenshot = (name: string): void => { execFileSync('/usr/sbin/screencapture', ['-x', join(proof, `${name}.png`)], { timeout: 15_000 }) }
const nativeMenu = (label: string): void => {
  // Actual accessibility activation of the OS status menu; no callback invocation.
  // Fail explicitly when the runner lacks GUI automation permission. Never alter TCC.
  execFileSync('/usr/bin/osascript', ['-e', `tell application "System Events"
    tell process "Hronaut"
      click menu bar item 1 of menu bar 2
      delay 0.4
      click menu item ${JSON.stringify(label)} of menu 1 of menu bar item 1 of menu bar 2
    end tell
  end tell`], { timeout: 15_000 })
}
try {
  const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), electron: process.versions.electron, arch: process.arch, path: app.getAppPath() }))
  assert.equal(identity.packaged, true)
  assert.equal(identity.version, packageInfo.version)
  assert.equal(identity.electron, packageInfo.devDependencies.electron)
  assert.equal(identity.arch, architecture)
  assert.equal(identity.path, asarPath)
  await writeFile(join(proof, 'runtime.json'), JSON.stringify(identity, null, 2))
  checks.push('native packaged runtime identity'); await save()
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  const text = `Hronaut native clipboard ${randomUUID()}`
  await window.evaluate(`window.hronaut.copyText(${JSON.stringify(text)})`)
  assert.equal(execFileSync('/usr/bin/pbpaste', [], { encoding: 'utf8' }), text)
  checks.push('independent native text clipboard reader'); await save()
  const state = await window.evaluate("window.hronaut.newTab({url:'data:text/html,<title>Native clipboard</title><main style=background:cyan;height:200px>Native PNG fixture</main>',active:true})") as { activeTabId: string }
  await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().some(page => page.getURL().startsWith('data:text/html') && !page.isLoading()))).toBe(true)
  execFileSync('/usr/bin/swift', ['-e', 'import AppKit; NSPasteboard.general.clearContents()'], { timeout: 90_000 })
  await window.evaluate(`window.hronaut.capturePage({tabId:${JSON.stringify(state.activeTabId)}})`)
  const reader = join(proof, 'read-pasteboard.swift')
  await writeFile(reader, `import AppKit
let board = NSPasteboard.general
 guard let data = board.data(forType: .png), let image = NSBitmapImageRep(data: data), image.pixelsWide > 0, image.pixelsHigh > 0 else { fatalError("Missing valid native PNG clipboard") }
print("\\(image.pixelsWide)x\\(image.pixelsHigh):\\(data.count)")
`)
  const image = execFileSync('/usr/bin/swift', [reader], { encoding: 'utf8', timeout: 90_000 }).trim()
  assert.match(image, /^\d+x\d+:\d+$/)
  await writeFile(join(proof, 'native-png.txt'), image)
  checks.push('independent AppKit PNG clipboard reader'); await save()
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
