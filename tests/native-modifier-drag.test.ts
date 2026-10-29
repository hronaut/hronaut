import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { shouldBlockHumanMouseInput, type AuthorizedAgentMouseInput } from '../src/main/browser/agent-input-authorization/agent-input-authorization.js'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import type { AgentPageActionsAccess, AgentPageActionsTab } from '../src/main/browser/agent-page-actions/agent-page-actions-access.js'
import { type BrowserDragModifier, drag } from '../src/main/browser/agent-page-actions/hover-and-drag.js'
import { coordinateDragPointsOrValidateTargets } from '../src/main/browser/input-targets/input-targets.js'
import { dispatchNativeDrag } from '../src/main/browser/native-pointer.js'
import { browserActionPayloadFingerprint } from '../src/main/mcp/browser-action-authority.js'
import { humanWaitingArtifactHash } from '../src/main/mcp/human-waiting-store.js'
import { browserDragInputShape, browserDragSchema } from '../src/main/mcp/tools/browser-drag/input.js'

function recordingDebugger(failAt?: number) {
  const commands: Array<Record<string, unknown>> = []
  return {
    commands,
    debuggerApi: {
      sendCommand: vi.fn(async (_method: string, params?: Record<string, unknown>) => {
        commands.push(params ?? {})
        if (commands.length === failAt) throw new Error(`pointer event ${failAt} failed`)
      })
    }
  }
}

function dragAccess() {
  const { commands, debuggerApi } = recordingDebugger()
  const access = {
    coordinateDragPointsOrValidateTargets,
    getTab: () => ({ webContents: {} as WebContents }),
    nativeInputAuthority: () => ({ validate: () => {}, dispose: () => {} }),
    assertPointInsideVisibleViewport: async () => {},
    showAgentPointer: async () => {},
    withAgentInput: async <T>(_webContents: WebContents, operation: () => Promise<T>) => operation(),
    withDebugger: async <T>(_webContents: WebContents, operation: () => Promise<T>) => operation(),
    agentInputDebugger: () => debuggerApi
  } as unknown as AgentPageActionsAccess<AgentPageActionsTab>
  return { access, commands }
}

const coordinates = { tabId: 'tab-1', startX: 10, startY: 20, endX: 90, endY: 60 }

describe('native modifier drags', () => {
  it('puts the modifier bits on every event of the drag', async () => {
    const { commands, debuggerApi } = recordingDebugger()
    await dispatchNativeDrag(debuggerApi, { x: 10, y: 20 }, { x: 90, y: 60 }, debuggerApi, 8 | 1)
    expect(commands).toHaveLength(11)
    expect(commands.map(command => command.modifiers)).toEqual(Array(11).fill(9))
  })

  it('keeps the bits on the cleanup release after a failed move', async () => {
    const pressed = recordingDebugger(4)
    const release = recordingDebugger()
    await expect(dispatchNativeDrag(pressed.debuggerApi, { x: 10, y: 20 }, { x: 90, y: 60 }, release.debuggerApi, 8))
      .rejects.toThrow('pointer event 4 failed')
    expect(release.commands).toEqual([{ type: 'mouseReleased', x: 90, y: 60, button: 'left', buttons: 0, clickCount: 1, modifiers: 8 }])
  })

  it('sends the same events as before when no key is given', async () => {
    const { commands, debuggerApi } = recordingDebugger()
    await dispatchNativeDrag(debuggerApi, { x: 10, y: 20 }, { x: 90, y: 60 })
    expect(commands.some(command => 'modifiers' in command)).toBe(false)
    expect(commands[0]).toEqual({ type: 'mouseMoved', x: 10, y: 20 })
    expect(commands[1]).toEqual({ type: 'mousePressed', x: 10, y: 20, button: 'left', buttons: 1, clickCount: 1 })
    expect(commands[2]).toEqual({ type: 'mouseMoved', x: 20, y: 25, button: 'left', buttons: 1 })
  })

  it.each<[readonly BrowserDragModifier[], NodeJS.Platform, number]>([
    [['Shift'], 'linux', 8],
    [['Alt'], 'linux', 1],
    [['Shift', 'Alt'], 'linux', 9],
    [['ControlOrMeta'], 'linux', 2],
    [['ControlOrMeta'], 'win32', 2],
    [['ControlOrMeta'], 'darwin', 4]
  ])('sends %j on %s as bits %i and echoes the keys', async (modifiers, platform, bits) => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: platform })
    try {
      const { access, commands } = dragAccess()
      await expect(drag(access, { ...coordinates, modifiers })).resolves.toEqual({
        ok: true, from: { x: 10, y: 20 }, to: { x: 90, y: 60 }, modifiers: [...modifiers]
      })
      expect(commands.map(command => command.modifiers)).toEqual(Array(11).fill(bits))
    } finally {
      Object.defineProperty(process, 'platform', original)
    }
  })

  it('leaves a drag without keys unchanged', async () => {
    const { access, commands } = dragAccess()
    await expect(drag(access, coordinates)).resolves.toEqual({ ok: true, from: { x: 10, y: 20 }, to: { x: 90, y: 60 } })
    expect(commands.some(command => 'modifiers' in command)).toBe(false)
  })

  it.each<[string, readonly string[]]>([
    ['no keys', []],
    ['a repeated key', ['Shift', 'Shift']],
    ['an unsupported key', ['Control']]
  ])('rejects %s before touching the page', async (_name, modifiers) => {
    const access = {} as AgentPageActionsAccess<AgentPageActionsTab>
    await expect(drag(access, { ...coordinates, modifiers: modifiers as BrowserDragModifier[] }))
      .rejects.toThrow('Drag modifiers must name one to three of Shift, Alt or ControlOrMeta, each once.')
  })
})

describe('browser_drag modifier input', () => {
  const schema = browserDragSchema(browserDragInputShape)
  const shifted = { ...coordinates, tabId: undefined, modifiers: ['Shift'] }

  it.each([
    { modifiers: [] }, { modifiers: ['Shift', 'Shift'] }, { modifiers: ['Control'] }, { modifiers: ['Meta'] },
    { modifiers: ['Shift', 'Alt', 'ControlOrMeta', 'Shift'] }, { modifiers: 'Shift' }
  ])('rejects %j', change => {
    expect(schema.safeParse({ ...shifted, ...change }).success).toBe(false)
  })

  it('accepts keys on element and coordinate drags and parses a plain drag as before', () => {
    expect(schema.safeParse({ sourceRef: 'e1', targetRef: 'e2', modifiers: ['Alt'] }).success).toBe(true)
    const plain = { sourceSelector: '#a', targetSelector: '#b' }
    expect(schema.parse({ ...plain, oldIgnoredField: true })).toEqual(plain)
  })

  it('sorts the keys so the same keys bind the same review and capability, and keeps them distinct from a plain drag', () => {
    const source = { ...shifted, modifiers: ['ControlOrMeta', 'Alt', 'Shift'] }
    const reordered = schema.parse(source)
    const ordered = schema.parse({ ...shifted, modifiers: ['Shift', 'Alt', 'ControlOrMeta'] })
    expect(reordered.modifiers).toEqual(['Shift', 'Alt', 'ControlOrMeta'])
    expect(source.modifiers).toEqual(['ControlOrMeta', 'Alt', 'Shift'])
    expect(browserActionPayloadFingerprint(reordered)).toBe(browserActionPayloadFingerprint(ordered))
    expect(humanWaitingArtifactHash('browser_drag', reordered)).toBe(humanWaitingArtifactHash('browser_drag', ordered))
    const calls = [{ ...shifted, modifiers: undefined }, shifted, { ...shifted, modifiers: ['Alt'] }].map(input => schema.parse(input))
    expect(new Set(calls.map(browserActionPayloadFingerprint)).size).toBe(3)
    expect(new Set(calls.map(input => humanWaitingArtifactHash('browser_drag', input))).size).toBe(3)
  })
})

describe('locked tab input guard for drags', () => {
  const tab = { webContents: { id: 7 } } as unknown as BrowserTab
  // A pressed drag move as the CDP command records it: the left button held, Shift on the event.
  const pressedMove: AuthorizedAgentMouseInput = { type: 'mouseMove', x: 30, y: 40, button: 'left', buttons: 1, clickCount: 0, modifiers: 8 }
  /** A browser whose locked tab's input guard expects this one mouse event from an agent. */
  function browser(expected: AuthorizedAgentMouseInput): Browser {
    return {
      tabs: new Map([['tab-1', tab]]),
      webContentsToTab: new Map([[7, 'tab-1']]),
      isHumanInteractionLocked: () => true,
      authorizedAgentMouseInput: new Map([[7, expected]]),
      authorizedAgentKeyboardInput: new Map()
    } as unknown as Browser
  }
  const move = (change: Partial<Electron.MouseInputEvent> = {}): Electron.MouseInputEvent =>
    ({ type: 'mouseMove', x: 30, y: 40, button: 'left', clickCount: 0, ...change }) as Electron.MouseInputEvent

  it('admits the agent pressed move once although Electron reports neither held buttons nor keys', () => {
    const guard = browser(pressedMove)
    expect(shouldBlockHumanMouseInput(guard, tab, move())).toBe(false)
    expect(shouldBlockHumanMouseInput(guard, tab, move())).toBe(true)
  })

  it('still compares held buttons and keys when Electron reports them', () => {
    expect(shouldBlockHumanMouseInput(browser(pressedMove), tab, move({ modifiers: ['leftbuttondown', 'shift'] }))).toBe(false)
    expect(shouldBlockHumanMouseInput(browser(pressedMove), tab, move({ modifiers: ['shift'] }))).toBe(true)
    expect(shouldBlockHumanMouseInput(browser(pressedMove), tab, move({ modifiers: ['leftbuttondown'] }))).toBe(true)
  })

  it('blocks a move that is not the recorded one', () => {
    expect(shouldBlockHumanMouseInput(browser(pressedMove), tab, move({ y: 90 }))).toBe(true)
    expect(shouldBlockHumanMouseInput(browser(pressedMove), tab, move({ type: 'mouseDown' }))).toBe(true)
    // A hover is what Electron reports for a move with no button held.
    expect(shouldBlockHumanMouseInput(browser(pressedMove), tab, move({ button: 'none' as 'left' }))).toBe(true)
  })

  it('admits the agent hover, which Electron reports with button none', () => {
    const hover: AuthorizedAgentMouseInput = { type: 'mouseMove', x: 30, y: 40, button: undefined, buttons: 0, clickCount: 0, modifiers: 0 }
    const guard = browser(hover)
    expect(shouldBlockHumanMouseInput(guard, tab, move({ button: 'left' }))).toBe(true)
    expect(shouldBlockHumanMouseInput(guard, tab, move({ button: 'none' as 'left' }))).toBe(false)
    expect(shouldBlockHumanMouseInput(guard, tab, move({ button: 'none' as 'left' }))).toBe(true)
  })
})
