import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { AgentPageActionsAccess, AgentPageActionsTab, BrowserClickTarget } from '../src/main/browser/agent-page-actions/agent-page-actions-access.js'
import { click } from '../src/main/browser/agent-page-actions/click.js'
import { shouldBlockHumanMouseInput, type AuthorizedAgentMouseInput } from '../src/main/browser/agent-input-authorization/agent-input-authorization.js'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import { dispatchNativeClick } from '../src/main/browser/native-click/native-click.js'

// The commands a native click sends, recorded on the fake browser it sends them through.
vi.mock('../src/main/browser/agent-input-authorization/agent-input-authorization.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/agent-input-authorization/agent-input-authorization.js')>(),
  sendAuthorizedAgentInputCommand: (browser: { sendAuthorizedAgentInputCommand(...args: unknown[]): Promise<unknown> }, ...args: unknown[]) =>
    browser.sendAuthorizedAgentInputCommand(...args)
}))

const webContents = {} as WebContents

function recordedClick(modifiers?: number, doubleClick = false) {
  const commands: Array<Record<string, unknown>> = []
  const browser = {
    sendAuthorizedAgentInputCommand: vi.fn(async (_webContents: WebContents, _method: string, params?: Record<string, unknown>) => {
      commands.push(params ?? {})
    })
  } as unknown as Browser
  return { commands, run: () => dispatchNativeClick(browser, webContents, { x: 10, y: 20 }, doubleClick, () => {}, undefined, undefined, false, modifiers) }
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

  it('rejects Control on macOS, where a Control click opens a context menu', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    try {
      const access = {} as AgentPageActionsAccess<AgentPageActionsTab>
      await expect(click(access, { tabId: 'tab-1', selector: '#row', native: true, modifiers: ['Shift', 'Control'] }))
        .rejects.toThrow('On macOS a Control click opens a context menu instead of clicking; use Meta or ControlOrMeta.')
    } finally {
      Object.defineProperty(process, 'platform', platform)
    }
  })

  it.each<[string, BrowserClickTarget['modifiers']]>([
    ['ControlOrMeta with Control', ['ControlOrMeta', 'Control']],
    ['ControlOrMeta with Meta', ['Meta', 'ControlOrMeta']]
  ])('rejects %s before touching the page', async (_name, modifiers) => {
    const access = {} as AgentPageActionsAccess<AgentPageActionsTab>
    await expect(click(access, { tabId: 'tab-1', selector: '#row', native: true, modifiers }))
      .rejects.toThrow('ControlOrMeta not combined with Control or Meta')
  })
})

describe('locked tab input guard for modifier clicks', () => {
  const tab = { webContents: { id: 7 } } as unknown as BrowserTab
  const press: AuthorizedAgentMouseInput = { type: 'mouseDown', x: 10, y: 20, button: 'left', buttons: 0, clickCount: 1, modifiers: 8 }
  function guard(expected: AuthorizedAgentMouseInput | undefined) {
    const mouse = new Map<number, AuthorizedAgentMouseInput>(expected ? [[7, expected]] : [])
    const browser = {
      tabs: new Map([['tab-1', tab]]),
      webContentsToTab: new Map([[7, 'tab-1']]),
      isHumanInteractionLocked: () => true,
      authorizedAgentMouseInput: mouse,
      authorizedAgentKeyboardInput: new Map()
    } as never
    return { browser, mouse }
  }
  const event = (change: Partial<Electron.MouseInputEvent> = {}): Electron.MouseInputEvent =>
    ({ type: 'mouseDown', x: 10, y: 20, button: 'left', clickCount: 1, ...change }) as Electron.MouseInputEvent

  it('admits the agent Shift press once although Electron reports no modifiers', () => {
    const { browser, mouse } = guard(press)
    expect(shouldBlockHumanMouseInput(browser, tab, event())).toBe(false)
    expect(mouse.size).toBe(0)
    expect(shouldBlockHumanMouseInput(browser, tab, event())).toBe(true)
  })

  it('still compares modifiers when Electron reports them', () => {
    const { browser } = guard(press)
    expect(shouldBlockHumanMouseInput(browser, tab, event({ modifiers: ['control'] }))).toBe(true)
    expect(shouldBlockHumanMouseInput(browser, tab, event({ modifiers: ['shift'] }))).toBe(false)
  })

  it('blocks a press that is not the recorded one', () => {
    expect(shouldBlockHumanMouseInput(guard(press).browser, tab, event({ x: 40 }))).toBe(true)
    expect(shouldBlockHumanMouseInput(guard(press).browser, tab, event({ button: 'right' }))).toBe(true)
    expect(shouldBlockHumanMouseInput(guard(undefined).browser, tab, event())).toBe(true)
  })
})
