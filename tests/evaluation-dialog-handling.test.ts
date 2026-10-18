import { describe, expect, it } from 'vitest'
import { dialogAwareEvaluateScript, releaseEvaluationDialogsScript } from '../src/main/browser/page-scripts.js'

type Page = Record<string | symbol, unknown> & { alert(): unknown; confirm(): unknown; prompt(message?: string, defaultValue?: string): unknown }
type Scope = typeof globalThis & Record<string, unknown>

/** A stand-in main world where alert, confirm and prompt are the page's own properties, as in Chromium. */
function page() {
  const natives = { alert: () => 'native', confirm: () => 'native', prompt: () => 'native' }
  const window = { ...natives } as Page
  const run = (code: string): Promise<unknown> => new Function('window', `return ${code}`)(window) as Promise<unknown>
  return { window, natives, run }
}

function pendingGlobal(name: string): () => void {
  let finish!: () => void
  ;(globalThis as Scope)[name] = new Promise<string>(resolve => { finish = () => resolve(name) })
  return finish
}

describe('evaluation dialog handling', () => {
  it('answers dialogs while its script runs and gives the page its own dialogs back after', async () => {
    const { window, natives, run } = page()
    const finish = pendingGlobal('__hronautDialogA')
    try {
      const running = run(dialogAwareEvaluateScript('globalThis.__hronautDialogA', 'accept', 'a'))
      expect([window.alert(), window.confirm(), window.prompt('Name?', 'Ada')]).toEqual([undefined, true, 'Ada'])
      finish()
      await expect(running).resolves.toBe('__hronautDialogA')
      expect(window).toMatchObject(natives)
      expect(Object.getOwnPropertySymbols(window)).toEqual([])
    } finally {
      delete (globalThis as Scope).__hronautDialogA
    }
  })

  // An evaluation still running after its call stopped waiting can overlap the
  // next one, and the two can finish in either order.
  it('follows the latest overlapping evaluation and restores the page only when the last one ends', async () => {
    const { window, natives, run } = page()
    const finishA = pendingGlobal('__hronautDialogA')
    const finishB = pendingGlobal('__hronautDialogB')
    try {
      const a = run(dialogAwareEvaluateScript('globalThis.__hronautDialogA', 'accept', 'a'))
      const b = run(dialogAwareEvaluateScript('globalThis.__hronautDialogB', 'dismiss', 'b'))
      expect([window.confirm(), window.prompt('Name?')]).toEqual([false, null])
      finishA()
      await a
      expect(window.confirm()).toBe(false)
      expect(window.alert).not.toBe(natives.alert)
      finishB()
      await b
      expect(window).toMatchObject(natives)
    } finally {
      delete (globalThis as Scope).__hronautDialogA
      delete (globalThis as Scope).__hronautDialogB
    }
  })

  it('ends a stopped evaluation\'s handling by its id while it keeps running', async () => {
    const { window, natives, run } = page()
    const finishA = pendingGlobal('__hronautDialogA')
    const finishB = pendingGlobal('__hronautDialogB')
    try {
      const a = run(dialogAwareEvaluateScript('globalThis.__hronautDialogA', 'accept', 'a'))
      const b = run(dialogAwareEvaluateScript('globalThis.__hronautDialogB', 'dismiss', 'b'))
      void run(releaseEvaluationDialogsScript('b'))
      expect(window.confirm()).toBe(true)
      void run(releaseEvaluationDialogsScript('a'))
      expect(window).toMatchObject(natives)
      // Their late endings, and a release that finds nothing, change nothing.
      finishB()
      finishA()
      await Promise.all([a, b])
      void run(releaseEvaluationDialogsScript('a'))
      expect(window).toMatchObject(natives)
    } finally {
      delete (globalThis as Scope).__hronautDialogA
      delete (globalThis as Scope).__hronautDialogB
    }
  })
})
