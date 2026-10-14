import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, expect, launchHronaut, closeHronaut, closeFixtureServer } from './fixtures.js'

const empty = { version: 3, activeTabId: null, tabs: [], mcpTabGroups: [], savedTabGroups: [] }
const privateMarker = 'synthetic-private-metadata-marker'
type Scope = typeof globalThis & { metadataFixture: { notice?: { title: string; message: string; detail: string; buttons: string[] }; resolve?: () => void; held?: boolean; releaseRead?: () => void; renames?: number } }
async function launchRejected(profile: string, port: number, late = false, failDialog = false, holdRead = false, failSave?: 'before' | 'after' | 'held'): Promise<ElectronApplication> {
  const hook = join(profile, 'metadata-hook.cjs')
  // This disposable hook observes the native dialog API, not the app's parser.
  // No production test switch, metadata parsing or error classification is mocked.
  await writeFile(hook, `const {dialog,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');const path=require('node:path');
globalThis.metadataFixture={};
process.on('uncaughtExceptionMonitor',e=>require('node:fs').appendFileSync(path.join(process.env.HRONAUT_USER_DATA_DIR,'fixture-errors.log'),String(e.stack)));

dialog.showMessageBox=async (...args)=>{const o=args.at(-1);globalThis.metadataFixture.notice={title:o.title,message:o.message,detail:o.detail,buttons:o.buttons};
await new Promise(resolve=>globalThis.metadataFixture.resolve=resolve);
${failDialog ? "throw new Error('synthetic dialog unavailable');" : 'return {response:0,checkboxChecked:false};'}};
${failSave ? `const rename=fs.rename;fs.rename=async function(from,to){if(String(to)===path.join(process.env.HRONAUT_USER_DATA_DIR,'tabs.json')){globalThis.metadataFixture.renames=(globalThis.metadataFixture.renames||0)+1;${failSave === 'held' ? 'globalThis.metadataFixture.held=true;await new Promise(resolve=>globalThis.metadataFixture.releaseRead=resolve);' : ''}${failSave === 'after' ? 'await rename.call(this,from,to);' : ''}throw new Error('synthetic save failure')}return rename.call(this,from,to)};require('node:module').syncBuiltinESMExports();` : ''}
${holdRead ? `const read=fs.readFile;let count=0;fs.readFile=async function(file,...args){if(String(file)===path.join(process.env.HRONAUT_USER_DATA_DIR,'tabs.json')&&++count===2){globalThis.metadataFixture.held=true;await new Promise(resolve=>globalThis.metadataFixture.releaseRead=resolve)}return read.call(this,file,...args)};require('node:module').syncBuiltinESMExports();` : ''}
${late ? `const load=BrowserWindow.prototype.loadFile;BrowserWindow.prototype.loadFile=async function(...args){const result=await load.apply(this,args);await fs.writeFile(path.join(process.env.HRONAUT_USER_DATA_DIR,'tabs.json'),'{${privateMarker}');return result};` : ''}
`)
  return electron.launch({ args: ['--require', hook, '.'], cwd: process.cwd(), env: {
    ...process.env, HRONAUT_USER_DATA_DIR: profile, HRONAUT_DOWNLOAD_DIR: profile, HRONAUT_MCP_PORT: String(port), HRONAUT_MCP_HOST: '127.0.0.1'
  } })
}
async function quitNotice(app: ElectronApplication, natural = false): Promise<void> {
  const exited = new Promise<{ code: number | null; signal: string | null }>(resolve => app.process().once('exit', (code, signal) => resolve({ code, signal })))
  await app.evaluate(({ app }, natural) => { if (natural) setImmediate(() => app.quit()); else (globalThis as Scope).metadataFixture.resolve!() }, natural)
  expect(await exited).toEqual({ code: 0, signal: null })
}

for (const fault of ['invalid-json', 'unsupported-version', 'invalid-schema', 'legacy-undefined', 'legacy-0', 'legacy-1', 'legacy-2', 'read-error', 'late-rejection', 'natural-quit', 'dialog-failure'] as const) {
  test(`preserves rejected workspace metadata through startup and quit: ${fault}`, async ({ profileDirectory, mcpPort }) => {
    const metadata = join(profileDirectory, 'tabs.json')
    const obsolete = join(profileDirectory, 'Partitions', 'hronaut', 'marker')
    const partition = join(profileDirectory, 'Partitions', 'hronaut-workspace-aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'marker')
    for (const path of [obsolete, partition]) { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, 'synthetic-retained') }
    const bytes = fault === 'invalid-json' || fault === 'natural-quit' || fault === 'dialog-failure' ? `{${privateMarker}` : JSON.stringify({ ...empty,
      version: fault === 'unsupported-version' ? 999 : fault === 'legacy-undefined' ? undefined : fault.startsWith('legacy-') ? Number(fault.slice(7)) : 3,
      ...(fault === 'invalid-schema' ? { tabs: [{ id: 'invalid' }], deletedWorkspaceStorageIds: ['aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'] } : {}), privateMarker })
    if (fault === 'read-error') await mkdir(metadata)
    else await writeFile(metadata, bytes)
    const app = await launchRejected(profileDirectory, mcpPort, fault === 'late-rejection', fault === 'dialog-failure')
    try {
      await expect.poll(() => app.evaluate(() => Boolean((globalThis as Scope).metadataFixture.notice))).toBe(true)
      const notice = await app.evaluate(() => (globalThis as Scope).metadataFixture.notice!)
      expect(notice.buttons).toEqual(['Quit'])
      expect(notice.message).toContain('Startup stopped')
      expect(notice.detail).toContain('tabs.json')
      expect(JSON.stringify(notice)).not.toContain(privateMarker)
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(fault === 'late-rejection' ? 1 : 0)
      if (fault === 'late-rejection') {
        const page = app.windows()[0]!
        const result = await page.evaluate(async () => {
          const api = (window as unknown as { hronaut: { createWorkspace(input: unknown): Promise<unknown>; getState(): Promise<unknown> } }).hronaut
          return Promise.all([api.createWorkspace({ name: 'Must not exist', storage: 'scratch' }), api.getState()].map(p => p.then(() => 'fulfilled', () => 'rejected')))
        })
        expect(result).toEqual(['rejected', 'rejected'])
      }
      await expect(fetch(`http://127.0.0.1:${mcpPort}/mcp`)).rejects.toThrow()
      await quitNotice(app, fault === 'natural-quit')
      if (fault === 'read-error') expect((await lstat(metadata)).isDirectory()).toBe(true)
      if (fault !== 'read-error') expect(await readFile(metadata, 'utf8')).toBe(fault === 'late-rejection' ? `{${privateMarker}` : bytes)
      // Accepted preflight may remove the obsolete shared partition before a
      // later external mutation; isolated storage must still remain untouched.
      if (fault !== 'late-rejection') expect(await readFile(obsolete, 'utf8')).toBe('synthetic-retained')
      expect(await readFile(partition, 'utf8')).toBe('synthetic-retained')
    } finally { await app.close().catch(() => undefined) }
  })
}

for (const mode of ['missing', 'valid-empty'] as const) test(`initializes a clean ${mode} workspace profile`, async ({ profileDirectory, mcpPort }) => {
  const path = join(profileDirectory, 'tabs.json')
  if (mode === 'valid-empty') await writeFile(path, JSON.stringify(empty))
  const instance = await launchHronaut(profileDirectory, mcpPort)
  try { await expect.poll(async () => JSON.parse(await readFile(path, 'utf8').catch(() => '{"tabs":[]}')).tabs.length).toBe(1) }
  finally { await closeHronaut(instance.app) }
})

test('rejects mutations while metadata validation is held, then preserves a rejected read', async ({ profileDirectory, mcpPort }) => {
  const metadata = join(profileDirectory, 'tabs.json')
  const original = JSON.stringify(empty)
  await writeFile(metadata, original)
  const app = await launchRejected(profileDirectory, mcpPort, false, false, true)
  try {
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as Scope).metadataFixture.held))).toBe(true)
    const countBefore = await app.evaluate(({ webContents }) => webContents.getAllWebContents().length)
    await app.evaluate(({ Menu }) => {
      const repository = Menu.getApplicationMenu()!.items.flatMap(item => item.submenu?.items ?? []).find(item => item.label === 'GitHub Repository')!
      repository.click()
    })
    const page = await app.firstWindow()
    const result = await page.evaluate(async () => {
      const api = (window as unknown as { hronaut: { createWorkspace(input: unknown): Promise<unknown>; newTab(input: unknown): Promise<unknown> } }).hronaut
      return Promise.all([api.createWorkspace({ name: 'Must not exist', storage: 'scratch' }), api.newTab({})].map(p => p.then(() => 'fulfilled', () => 'rejected')))
    })
    expect(result).toEqual(['rejected', 'rejected'])
    expect(await app.evaluate(({ webContents }) => webContents.getAllWebContents().length)).toBe(countBefore)
    expect(await readFile(metadata, 'utf8')).toBe(original)
    const rejected = `{${privateMarker}`
    await writeFile(metadata, rejected)
    await app.evaluate(() => (globalThis as Scope).metadataFixture.releaseRead!())
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as Scope).metadataFixture.notice))).toBe(true)
    await quitNotice(app)
    expect(await readFile(metadata, 'utf8')).toBe(rejected)
  } finally { await app.close().catch(() => undefined) }
})

test('restoring a known-good metadata backup reconnects the same isolated storage', async ({ profileDirectory, mcpPort }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end("<script>window.initiallyPresent = localStorage.getItem('preservation-fixture') === 'synthetic-only'</script><title>Preservation fixture</title>")
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  const url = `http://127.0.0.1:${address.port}/source`
  let instance = await launchHronaut(profileDirectory, mcpPort)
  const inspect = () => instance.app.evaluate(async ({ webContents }, url) => {
    const page = webContents.getAllWebContents().find(w => w.getURL() === url)
    return page ? { present: await page.executeJavaScript('window.initiallyPresent'), path: page.session.storagePath } : null
  }, url)
  try {
    await instance.window.evaluate(async url => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const state = await api.createWorkspace({ name: 'Preserved fixture', storage: 'scratch' })
      await api.navigate({ tabId: state.activeTabId!, url })
    }, url)
    await expect.poll(async () => (await inspect())?.present).toBe(false)
    await instance.app.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(w => w.getURL() === url)!.executeJavaScript("localStorage.setItem('preservation-fixture','synthetic-only')"), url)
    const originalPartition = (await inspect())!.path
    await closeHronaut(instance.app)
    const path = join(profileDirectory, 'tabs.json')
    const backup = await readFile(path, 'utf8')
    const rejected = `{${privateMarker}`
    await writeFile(path, rejected)
    const failed = await launchRejected(profileDirectory, mcpPort)
    try {
      await expect.poll(() => failed.evaluate(() => Boolean((globalThis as Scope).metadataFixture.notice))).toBe(true)
      await quitNotice(failed)
    } finally { await failed.close().catch(() => undefined) }
    expect(await readFile(path, 'utf8')).toBe(rejected)
    // Only this disposable fixture: restore its own backup while closed.
    await writeFile(path, backup)
    instance = await launchHronaut(profileDirectory, mcpPort)
    await expect.poll(async () => (await inspect())?.present).toBe(true)
    expect((await inspect())!.path).toBe(originalPartition)
  } finally { await closeHronaut(instance.app); await closeFixtureServer(server) }
})

for (const phase of ['before', 'after'] as const) test(`initial save failure ${phase} replacement quits without another write`, async ({ profileDirectory, mcpPort }) => {
  const metadata = join(profileDirectory, 'tabs.json')
  const original = JSON.stringify(empty)
  await writeFile(metadata, original)
  const app = await launchRejected(profileDirectory, mcpPort, false, false, false, phase)
  try {
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as Scope).metadataFixture.notice))).toBe(true)
    const retained = await readFile(metadata, 'utf8')
    if (phase === 'before') expect(retained).toBe(original)
    else expect(JSON.parse(retained).tabs).toHaveLength(1)
    expect(await app.evaluate(() => (globalThis as Scope).metadataFixture.renames)).toBe(1)
    await quitNotice(app)
    expect(await readFile(metadata, 'utf8')).toBe(retained)
  } finally { await app.close().catch(() => undefined) }
})

test('blocks delegated browser operations while the final startup save is held', async ({ profileDirectory, mcpPort }) => {
  const seeded = await launchHronaut(profileDirectory, mcpPort)
  let workspaceId: string
  try {
    workspaceId = await seeded.window.evaluate(async () => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const state = await api.createWorkspace({ name: 'Preserved fixture', storage: 'scratch' })
      return state.mcpTabGroups.find(group => group.name === 'Preserved fixture')!.id
    })
  } finally { await closeHronaut(seeded.app) }
  const metadata = join(profileDirectory, 'tabs.json')
  const original = await readFile(metadata, 'utf8')
  const app = await launchRejected(profileDirectory, mcpPort, false, false, false, 'held')
  try {
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as Scope).metadataFixture.held))).toBe(true)
    const page = await app.firstWindow()
    const results = await page.evaluate(async id => {
      const settings = (window as unknown as { hronautSettings: { setMcpPort(port: number): Promise<unknown>; resetMcp(): Promise<unknown> }; }).hronautSettings
      const credentials = (window as unknown as { hronautCredentials: { fill(tab: string, credential: string): Promise<unknown> } }).hronautCredentials
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      return Promise.all([
        api.browserImport.list(id), api.browserImport.preview(id, 'synthetic-profile'),
        api.browserImport.commit('synthetic-preview', []), api.browserImport.cancel(),
        api.setDiagnosticLogPreservation('synthetic-tab', true), api.discardIncident(),
        settings.setMcpPort(39876), settings.resetMcp(), credentials.fill('synthetic-tab', 'synthetic-credential')
      ].map(p => p.then(() => 'fulfilled', () => 'rejected')))
    }, workspaceId)
    expect(results).toEqual(Array(9).fill('rejected'))
    expect(await readFile(metadata, 'utf8')).toBe(original)
    await app.evaluate(() => (globalThis as Scope).metadataFixture.releaseRead!())
    await expect.poll(() => app.evaluate(() => Boolean((globalThis as Scope).metadataFixture.notice))).toBe(true)
    await quitNotice(app)
    expect(await readFile(metadata, 'utf8')).toBe(original)
  } finally { await app.close().catch(() => undefined) }
})
