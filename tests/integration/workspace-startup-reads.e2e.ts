import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HronautApi, HronautBookmarksApi, HronautDownloadsApi, HronautHistoryApi } from '../../src/shared/types.js'
import { test, expect, closeHronaut } from './fixtures.js'
import { launchRejected, quitNotice, type Scope } from './workspace-metadata-fixtures.js'

type Probe = typeof globalThis & { startupReadProbe: { channel: string; status: string; message?: string }[]; replayStartupRead?: () => Promise<unknown>; prestartedReadAdmitted?: boolean }
const original = JSON.stringify({ version: 3, activeTabId: null, tabs: [], mcpTabGroups: [], savedTabGroups: [] })
const collections = ['downloads:list', 'bookmarks:list', 'visit-history:list']

for (const outcome of ['success', 'rejected-metadata', 'save-failure', 'reload', 'prestarted-reload', 'destroy', 'replacement-window', 'native-failure'] as const) {
  test(`startup reads wait for the native initialization outcome: ${outcome}`, async ({ profileDirectory, mcpPort }, info) => {
    const metadata = join(profileDirectory, 'tabs.json')
    await writeFile(metadata, original)
    const app = await launchRejected(profileDirectory, mcpPort, false, false, true, outcome === 'save-failure' ? 'before' : undefined, true)
    const probe = () => app.evaluate(() => (globalThis as Probe).startupReadProbe)
    try {
      await expect.poll(() => app.evaluate(() => Boolean((globalThis as Scope).metadataFixture.held))).toBe(true)
      const page = await app.firstWindow()
      await expect.poll(async () => { const records = await probe(); return collections.every(channel => records.some(r => r.channel === channel)) }).toBe(true)
      // Real shell bootstrap requests reach ipcMain while the filesystem read is held.
      // On the pre-fix application these records are rejected, producing the toast.
      const initial = await probe()
      await info.attach('held-startup-reads', { body: JSON.stringify(initial), contentType: 'application/json' })
      expect(initial.every(r => r.status === 'pending'), JSON.stringify(initial)).toBe(true)
      await page.evaluate(() => {
        const w = window as unknown as {
          hronautBookmarks: HronautBookmarksApi; hronautHistory: HronautHistoryApi; hronautDownloads: HronautDownloadsApi
        }
        for (let i = 0; i < 3; i++) {
          void Promise.allSettled([w.hronautBookmarks.list(), w.hronautBookmarks.collections!.list(), w.hronautHistory.list(), w.hronautDownloads.list()])
        }
      })
      await expect.poll(async () => (await probe()).length).toBeGreaterThanOrEqual(16)
      expect((await probe()).every(r => r.status === 'pending')).toBe(true)
      const mutation = await page.evaluate(async () => {
        const api = (window as unknown as { hronaut: HronautApi }).hronaut
        return api.createWorkspace({ name: 'Must remain blocked', storage: 'scratch' }).then(() => 'fulfilled', () => 'rejected')
      })
      expect(mutation).toBe('rejected')
      expect(await readFile(metadata, 'utf8')).toBe(original)
      let previous = 0
      if (outcome === 'reload' || outcome === 'prestarted-reload' || outcome === 'destroy' || outcome === 'replacement-window') {
        previous = (await probe()).length
        await app.evaluate(async ({ BrowserWindow }, { outcome, preload }) => {
          const window = BrowserWindow.getAllWindows()[0]!
          if (outcome === 'reload' || outcome === 'prestarted-reload') {
            if (outcome === 'prestarted-reload') window.webContents.once('did-start-navigation', () => {
              const before = window.webContents.listenerCount('did-navigate')
              void (globalThis as Probe).replayStartupRead!().catch(() => undefined)
              ;(globalThis as Probe).prestartedReadAdmitted = window.webContents.listenerCount('did-navigate') > before
            })
            window.webContents.reload(); return
          }
          const url = window.webContents.getURL()
          window.destroy()
          if (outcome === 'replacement-window') {
            const replacement = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, additionalArguments: ['--hronaut-window-kind=main'] } })
            await replacement.loadURL(url)
            await replacement.webContents.executeJavaScript(`window.hronautBookmarks.list().then(() => 'fulfilled', () => 'rejected')`)
          }
        }, { outcome, preload: join(process.cwd(), 'out/preload/index.cjs') })
        if (outcome === 'prestarted-reload') {
          await expect.poll(() => app.evaluate(() => (globalThis as Probe).prestartedReadAdmitted)).toBe(true)
          previous += 1
        }
        await expect.poll(async () => (await probe()).slice(0, previous).every(r => r.status === 'rejected')).toBe(true)
        if (outcome === 'reload' || outcome === 'prestarted-reload') {
          await expect.poll(async () => (await probe()).length).toBeGreaterThan(previous)
          expect((await probe()).slice(previous).every(r => r.status === 'pending')).toBe(true)
        }
      }
      if (outcome === 'replacement-window') {
        await expect.poll(async () => (await probe()).length).toBeGreaterThan(previous)
        expect((await probe()).every(r => r.status === 'rejected')).toBe(true)
      }
      if (outcome === 'native-failure') await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]!.contentView.addChildView = () => { throw new Error('synthetic native view failure') }
      })
      const rejected = '{synthetic-rejected-startup'
      if (outcome === 'rejected-metadata') await writeFile(metadata, rejected)
      await app.evaluate(() => (globalThis as Scope).metadataFixture.releaseRead!())
      if (outcome === 'rejected-metadata' || outcome === 'save-failure') {
        await expect.poll(() => app.evaluate(() => Boolean((globalThis as Scope).metadataFixture.notice))).toBe(true)
        await expect.poll(async () => (await probe()).every(r => r.status === 'rejected')).toBe(true)
        await quitNotice(app)
        expect(await readFile(metadata, 'utf8')).toBe(outcome === 'rejected-metadata' ? rejected : original)
      } else if (outcome === 'native-failure') {
        await expect.poll(async () => (await probe()).every(r => r.status === 'rejected')).toBe(true)
        expect(await readFile(metadata, 'utf8')).toBe(original)
        const results = await page.evaluate(async () => {
          const api = (window as unknown as { hronaut: HronautApi }).hronaut
          return Promise.all([api.getState(), api.createWorkspace({ name: 'Blocked after failure', storage: 'scratch' })].map(p => p.then(() => 'fulfilled', () => 'rejected')))
        })
        expect(results).toEqual(['rejected', 'rejected'])
      } else if (outcome !== 'destroy' && outcome !== 'replacement-window') {
        await expect.poll(async () => (await probe()).slice(previous).every(r => r.status === 'fulfilled')).toBe(true)
        await expect(page.getByRole('alert', { name: 'Startup incomplete', exact: true })).toHaveCount(0)
        const saved = JSON.parse(await readFile(metadata, 'utf8'))
        expect(saved.tabs).toHaveLength(1)
        expect(saved.tabs[0].url).toBe('hronaut://home/')
        expect(saved.mcpTabGroups).toEqual([])
      }
    } finally {
      await app.evaluate(() => (globalThis as Scope).metadataFixture.releaseRead?.()).catch(() => undefined)
      await closeHronaut(app)
    }
  })
}
