import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { attachDebuggerEvents } from '../src/main/browser/tab-events/debugger-events.js'

it('hands debugger pauses and style sheets to profiling, which resumes pauses while coverage records', () => {
  const handleDebuggerMessage = vi.fn()
  const browser = { profiling: { handleDebuggerMessage, handleDebuggerDetached: vi.fn() } }
  const debuggerEvents = new EventEmitter()
  const webContents = Object.assign(new EventEmitter(), { debugger: debuggerEvents }) as unknown as WebContents
  const tab = {}
  attachDebuggerEvents(browser as never, tab as never, webContents)
  debuggerEvents.emit('message', {}, 'Debugger.paused', { reason: 'other' })
  debuggerEvents.emit('message', {}, 'CSS.styleSheetAdded', { header: { styleSheetId: '1' } })
  expect(handleDebuggerMessage.mock.calls).toEqual([
    [tab, 'Debugger.paused', { reason: 'other' }],
    [tab, 'CSS.styleSheetAdded', { header: { styleSheetId: '1' } }]
  ])
})
