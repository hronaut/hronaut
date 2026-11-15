import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({ publishChange: vi.fn() }))
vi.mock('../src/main/browser/website-dialogs/website-dialogs.js', () => ({
  closeWebsiteDialogBox: vi.fn(), dismissWebsiteDialogForTrustedChrome: vi.fn(), ensureDialogMonitoring: vi.fn()
}))
import { attachDebuggerEvents } from '../src/main/browser/tab-events/debugger-events.js'

// An agent's answer named the dialog it read only by its text, so the page's next dialog with the same text took it.
it('gives each showing of a website dialog its own id, also for the same text again', () => {
  const debuggerEvents = new EventEmitter()
  const webContents = Object.assign(new EventEmitter(), { id: 3, debugger: debuggerEvents }) as unknown as WebContents
  const tab: { url: string; dialog?: { id: string; message: string } } = { url: 'https://example.test/' }
  attachDebuggerEvents({ browserContentOccluded: false } as never, tab as never, webContents)
  const opens = () => {
    debuggerEvents.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'Delete it?', url: tab.url })
    return tab.dialog!
  }
  const first = opens()
  debuggerEvents.emit('message', {}, 'Page.javascriptDialogClosed', { result: true })
  expect(tab.dialog).toBeUndefined()
  const second = opens()
  expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(second).toMatchObject({ message: 'Delete it?' })
  expect(second.id).not.toBe(first.id)
})
