import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { AgentPageActionsAccess, AgentPageActionsTab, BrowserClickTarget } from '../src/main/browser/agent-page-actions/agent-page-actions-access.js'
import { click } from '../src/main/browser/agent-page-actions/click.js'
import { dispatchNativeClick } from '../src/main/browser/native-click/native-click.js'

const webContents = {} as WebContents

function recordedClick(modifiers?: number, doubleClick = false) {
  const commands: Array<Record<string, unknown>> = []
  const access = {
    sendAuthorizedAgentInputCommand: vi.fn(async (_webContents: WebContents, _method: string, params?: Record<string, unknown>) => {
      commands.push(params ?? {})
    })
  }
  return { commands, run: () => dispatchNativeClick(access, webContents, { x: 10, y: 20 }, doubleClick, () => {}, undefined, undefined, false, modifiers) }
}

describe('native modifier clicks', () => {
  it('puts the modifier bits on the move, press and release of the click', async () => {
    const { commands, run } = recordedClick(8 | 2)
    await run()
    expect(commands.map(command => [command.type, command.modifiers])).toEqual([
      ['mouseMoved', 10], ['mousePressed', 10], ['mouseReleased', 10]
    ])
  })

  it('sends the same events as before when no modifier is held', async () => {
    const { commands, run } = recordedClick()
    await run()
    expect(commands).toEqual([
      { type: 'mouseMoved', x: 10, y: 20 },
      { type: 'mousePressed', x: 10, y: 20, button: 'left', buttons: 1, clickCount: 1 },
      { type: 'mouseReleased', x: 10, y: 20, button: 'left', buttons: 0, clickCount: 1 }
    ])
    const doubled = recordedClick(0, true)
    await doubled.run()
    expect(doubled.commands.some(command => 'modifiers' in command)).toBe(false)
  })

  it.each<[string, Partial<BrowserClickTarget>]>([
    ['no keys', { modifiers: [] }],
    ['a repeated key', { modifiers: ['Shift', 'Shift'] }],
    ['an unknown key', { modifiers: ['Alt' as 'Shift'] }],
    ['a semantic click that is not native', { native: false }],
    ['a double click', { doubleClick: true }],
    ['coordinates', { selector: undefined, x: 5, y: 5 }],
    ['both a ref and a selector', { ref: 'e1' }],
    ['neither a ref nor a selector', { selector: undefined }],
    ['dialog handling', { dialogAction: 'accept' }]
  ])('rejects %s before touching the page', async (_name, change) => {
    const access = {} as AgentPageActionsAccess<AgentPageActionsTab>
    await expect(click(access, { tabId: 'tab-1', selector: '#row', native: true, modifiers: ['Shift'], ...change }))
      .rejects.toThrow('Modifier clicks require one native left click on a ref or selector')
  })

  it('rejects modifiers on a right click before touching the page', async () => {
    const access = { assertRightClickPlatform: vi.fn() } as unknown as AgentPageActionsAccess<AgentPageActionsTab>
    await expect(click(access, { tabId: 'tab-1', selector: '#row', native: true, button: 'right', modifiers: ['Control'] }))
      .rejects.toThrow('Modifier clicks require one native left click on a ref or selector')
  })
})
