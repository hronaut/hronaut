// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { domChangesPageScript, type DomChangesPageAction } from '../src/shared/dom-changes.js'
import type { BrowserDomChangesReport } from '../src/shared/types.js'

const run = (action: DomChangesPageAction): Pick<BrowserDomChangesReport, 'entries'> =>
  window.eval(domChangesPageScript(action)) as Pick<BrowserDomChangesReport, 'entries'>

// MutationObserver callbacks are microtasks; a macrotask boundary separates them.
const callback = () => new Promise(resolve => setTimeout(resolve, 0))

afterEach(() => {
  run('clear')
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

it('times each change from the start on the page\'s monotonic clock, whatever the computer\'s clock does', async () => {
  document.body.innerHTML = '<ul id="list"></ul>'
  const now = vi.spyOn(window.performance, 'now').mockReturnValue(1_000)
  const wallNow = vi.spyOn((window as unknown as { Date: DateConstructor }).Date, 'now').mockReturnValue(1_000)
  run('start')
  now.mockReturnValue(1_250)
  wallNow.mockReturnValue(1_000 + 60 * 60_000)
  document.getElementById('list')!.append(document.createElement('li'))
  await callback()
  now.mockReturnValue(1_500)
  wallNow.mockReturnValue(1_000 - 60 * 60_000)
  document.getElementById('list')!.append(document.createElement('li'))
  await callback()
  expect(run('get').entries.map(entry => entry.elapsedMs)).toEqual([250, 500])
})
