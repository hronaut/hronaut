import { expect, test } from './fixtures.js'
import type { HronautApi, HronautSettingsApi } from '../../src/shared/types.js'

type TestWindow = Window & { hronaut: HronautApi; hronautSettings: HronautSettingsApi; forkOutcome?: Promise<string> }
type ProbeGlobal = typeof globalThis & { forkPublicationProbe?: { started: boolean; release(): void; restore(): void } }

for (const position of ['top', 'left'] as const) {
  for (const fails of [false, true]) {
    test(`publishes a pending workspace fork to Home and ${position} tabs before ${fails ? 'rollback' : 'completion'}`, async ({ appWindow, electronApp }) => {
      const sourceId = await appWindow.evaluate(async position => {
        const api = window as unknown as TestWindow
        await api.hronautSettings.setTabPosition(position)
        const state = await api.hronaut.createWorkspace({ name: 'Fork source', storage: 'scratch' })
        await api.hronaut.openHome()
        return state.mcpTabGroups.find(group => group.name === 'Fork source')!.id
      }, position)
      const homeHasFork = () => electronApp.evaluate(async ({ webContents }) => {
        const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))!
        return home.executeJavaScript("[...document.querySelectorAll('.home-workspace-card h2')].some(node => node.textContent === 'Pending fork')") as Promise<boolean>
      })
      await expect.poll(() => appWindow.evaluate(async () => (
        (await (window as unknown as TestWindow).hronaut.getState()).tabs.every(tab => !tab.loading)
      ))).toBe(true)
      await expect(appWindow.getByRole('group', { name: 'Fork source', exact: true })).toBeVisible()
      await electronApp.evaluate(({ webContents }, fails) => {
        const source = webContents.getAllWebContents().find(contents => contents.getURL() === 'about:blank')!
        const cookies = source.session.cookies
        const original = cookies.get
        let release!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })
        const probe = { started: false, release, restore: () => { cookies.get = original; release() } }
        ;(globalThis as ProbeGlobal).forkPublicationProbe = probe
        cookies.get = async (...args: Parameters<Electron.Cookies['get']>) => {
          cookies.get = original
          probe.started = true
          await gate
          if (fails) throw new Error('Controlled fork copy failure')
          return original.apply(cookies, args)
        }
      }, fails)
      try {
        await appWindow.evaluate(sourceWorkspaceId => {
          const api = window as unknown as TestWindow
          api.forkOutcome = api.hronaut.createWorkspace({ name: 'Pending fork', storage: 'fork-workspace', sourceWorkspaceId })
            .then(() => 'created', () => 'failed')
        }, sourceId)
        await expect.poll(() => electronApp.evaluate(() => (globalThis as ProbeGlobal).forkPublicationProbe?.started)).toBe(true)
        await expect.poll(homeHasFork).toBe(true)
        // The copy is still held. An unrelated later state change must not be
        // needed to make the same authoritative workspace visible in chrome.
        const section = appWindow.getByRole('group', { name: 'Pending fork', exact: true })
        await expect(section).toBeVisible()
        await expect(section.getByRole('tab')).toHaveCount(0)
        await electronApp.evaluate(() => (globalThis as ProbeGlobal).forkPublicationProbe!.release())
        expect(await appWindow.evaluate(() => (window as unknown as TestWindow).forkOutcome)).toBe(fails ? 'failed' : 'created')
        if (fails) {
          await expect(section).toHaveCount(0)
          await expect.poll(homeHasFork).toBe(false)
        } else {
          await expect(section.getByRole('tab')).toHaveCount(1)
        }
      } finally {
        await electronApp.evaluate(() => {
          ;(globalThis as ProbeGlobal).forkPublicationProbe?.restore()
          delete (globalThis as ProbeGlobal).forkPublicationProbe
        })
        await appWindow.evaluate(async () => {
          await (window as unknown as TestWindow).forkOutcome
          delete (window as unknown as TestWindow).forkOutcome
        })
      }
    })
  }
}
