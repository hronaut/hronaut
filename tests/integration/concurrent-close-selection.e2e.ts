import type { EventEmitter } from 'node:events'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('keeps a live page attached when another close purges the destroyed active tab before its close completes', async ({ appWindow, electronApp }) => {
  const urls = {
    survivor: 'data:text/html,<title>Concurrent close survivor</title><h1>Survivor</h1>',
    other: 'data:text/html,<title>Concurrent other close</title>',
    active: 'data:text/html,<title>Concurrent active close</title>'
  }
  const ids = await appWindow.evaluate(async (urls) => {
    const api = (window as typeof window & { hronaut: HronautApi }).hronaut
    const survivor = (await api.newTab({ url: urls.survivor, active: true })).activeTabId!
    const other = (await api.newTab({ url: urls.other, active: true })).activeTabId!
    const active = (await api.newTab({ url: urls.active, active: true })).activeTabId!
    return { survivor, other, active }
  }, urls)
  await expect.poll(() => appWindow.evaluate(async (ids) => (
    await (window as typeof window & { hronaut: HronautApi }).hronaut.getState()
  ).tabs.filter(tab => Object.values(ids).includes(tab.id)).every(tab => !tab.loading), ids)).toBe(true)
  await electronApp.evaluate(({ webContents }, url) => {
    const contents = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    if (!contents) throw new Error('Concurrent close fixture not found')
    const emitter = contents as unknown as EventEmitter
    const originalOnce = emitter.once
    const gate = { destroyed: false, release: undefined as (() => void) | undefined, restore: () => { emitter.once = originalOnce } }
    ;(globalThis as typeof globalThis & { __concurrentCloseGate?: typeof gate }).__concurrentCloseGate = gate
    emitter.once = function (event, listener) {
      if (event !== 'destroyed') return originalOnce.call(this, event, listener)
      emitter.once = originalOnce
      return originalOnce.call(this, event, (...args: unknown[]) => {
        gate.destroyed = contents.isDestroyed()
        gate.release = () => listener.apply(contents, args)
      })
    }
  }, urls.active)
  const closing = appWindow.evaluate(id => (window as typeof window & { hronaut: HronautApi }).hronaut.closeTab(id), ids.active)
  try {
    await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & {
      __concurrentCloseGate?: { destroyed: boolean }
    }).__concurrentCloseGate?.destroyed)).toBe(true)
    const state = await appWindow.evaluate(id => (window as typeof window & { hronaut: HronautApi }).hronaut.closeTab(id), ids.other)
    expect(state.activeTabId).not.toBeNull()
    expect(state.tabs.some(tab => tab.id === state.activeTabId)).toBe(true)
    expect(state.tabs.some(tab => tab.id === ids.active || tab.id === ids.other)).toBe(false)
    const selectedUrl = state.tabs.find(tab => tab.id === state.activeTabId)!.url
    expect(await electronApp.evaluate(({ BrowserWindow, WebContentsView }, selectedUrl) => (
      BrowserWindow.getAllWindows().some(window => window.contentView.children.some(view => (
        view instanceof WebContentsView && !view.webContents.isDestroyed() && view.getVisible()
        && view.webContents.getURL() === selectedUrl
      )))
    ), selectedUrl)).toBe(true)
  } finally {
    await electronApp.evaluate(() => {
      const mainGlobal = globalThis as typeof globalThis & {
        __concurrentCloseGate?: { release?: () => void; restore: () => void }
      }
      mainGlobal.__concurrentCloseGate?.restore()
      mainGlobal.__concurrentCloseGate?.release?.()
      Reflect.deleteProperty(mainGlobal, '__concurrentCloseGate')
    })
    await closing
    const state = await appWindow.evaluate(() => (window as typeof window & { hronaut: HronautApi }).hronaut.getState())
    for (const id of Object.values(ids)) {
      if (state.tabs.some(tab => tab.id === id)) {
        await appWindow.evaluate(id => (window as typeof window & { hronaut: HronautApi }).hronaut.closeTab(id), id)
      }
    }
  }
})
