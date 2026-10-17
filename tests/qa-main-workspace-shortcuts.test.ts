import { describe, expect, it } from 'vitest'
import { pageShortcut } from '../src/main/browser/take-over.js'
import { browserShortcutAction, type BrowserShortcutInput } from '../src/shared/browser-shortcuts.js'
import { keyedPinnedWorkspaces, pinnedWorkspaceAt, recentWorkspaces } from '../src/shared/workspace-shortcuts.js'

function input(overrides: Partial<BrowserShortcutInput> = {}): BrowserShortcutInput {
  return { key: '', control: false, meta: false, alt: false, shift: false, ...overrides }
}

const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

describe('workspace keys on Windows and Linux', () => {
  it('maps Alt with a number-row digit to the pinned workspaces and Alt+0 to the previous workspace', () => {
    for (const digit of digits) {
      expect(browserShortcutAction(input({ key: digit, code: `Digit${digit}`, alt: true }))).toBe(`select-workspace-${digit}`)
    }
    expect(browserShortcutAction(input({ key: '0', code: 'Digit0', alt: true }))).toBe('previous-workspace')
  })

  it('goes by the physical key, so other keyboard layouts get the same workspace', () => {
    // French AZERTY types & and à on the first and last number-row keys; Russian and German keep the digits.
    expect(browserShortcutAction(input({ key: '&', code: 'Digit1', alt: true }))).toBe('select-workspace-1')
    expect(browserShortcutAction(input({ key: 'é', code: 'Digit2', alt: true }))).toBe('select-workspace-2')
    expect(browserShortcutAction(input({ key: 'à', code: 'Digit0', alt: true }))).toBe('previous-workspace')
    // A layout that puts a digit on another physical key does not reach a workspace.
    expect(browserShortcutAction(input({ key: '1', code: 'KeyQ', alt: true }))).toBeNull()
    // Without the physical key, as from an older caller, nothing is matched by the character alone.
    expect(browserShortcutAction(input({ key: '1', alt: true }))).toBeNull()
  })

  it('leaves AltGr (Ctrl+Alt) to type characters, and ignores Alt with Shift or Meta', () => {
    expect(browserShortcutAction(input({ key: '{', code: 'Digit7', control: true, alt: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: '}', code: 'Digit0', control: true, alt: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: '!', code: 'Digit1', alt: true, shift: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: '1', code: 'Digit1', alt: true, meta: true }))).toBeNull()
  })

  it('leaves the numeric keypad alone, where Alt with digits types a character code', () => {
    expect(browserShortcutAction(input({ key: '1', code: 'Numpad1', alt: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: '0', code: 'Numpad0', alt: true }))).toBeNull()
  })

  it('keeps Ctrl with a digit for the tabs and Ctrl+0 for zoom reset', () => {
    expect(browserShortcutAction(input({ key: '1', code: 'Digit1', control: true }))).toBe('select-tab-1')
    expect(browserShortcutAction(input({ key: '9', code: 'Digit9', control: true }))).toBe('select-last-tab')
    expect(browserShortcutAction(input({ key: '0', code: 'Digit0', control: true }))).toBe('zoom-reset')
  })

  it('ignores held and composing keys', () => {
    expect(browserShortcutAction(input({ key: '1', code: 'Digit1', alt: true, repeat: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: '0', code: 'Digit0', alt: true, composing: true }))).toBeNull()
  })
})

describe('workspace keys on macOS', () => {
  it('maps Control with a number-row digit to the workspaces', () => {
    for (const digit of digits) {
      expect(browserShortcutAction(input({ key: digit, code: `Digit${digit}`, control: true, mac: true }))).toBe(`select-workspace-${digit}`)
    }
    expect(browserShortcutAction(input({ key: '0', code: 'Digit0', control: true, mac: true }))).toBe('previous-workspace')
  })

  it('leaves Option with a digit to type its character', () => {
    expect(browserShortcutAction(input({ key: '¡', code: 'Digit1', alt: true, mac: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: 'º', code: 'Digit0', alt: true, mac: true }))).toBeNull()
    expect(browserShortcutAction(input({ key: '1', code: 'Digit1', control: true, alt: true, mac: true }))).toBeNull()
  })

  it('keeps Cmd with a digit for the tabs and zoom reset, and Control with Shift does nothing', () => {
    expect(browserShortcutAction(input({ key: '1', code: 'Digit1', meta: true, mac: true }))).toBe('select-tab-1')
    expect(browserShortcutAction(input({ key: '9', code: 'Digit9', meta: true, mac: true }))).toBe('select-last-tab')
    expect(browserShortcutAction(input({ key: '0', code: 'Digit0', meta: true, mac: true }))).toBe('zoom-reset')
    expect(browserShortcutAction(input({ key: '!', code: 'Digit1', control: true, shift: true, mac: true }))).toBeNull()
  })

  it('leaves Control on the keypad alone', () => {
    expect(browserShortcutAction(input({ key: '1', code: 'Numpad1', control: true, mac: true }))).not.toMatch(/workspace/)
  })
})

describe('keys pressed in a page', () => {
  const workspaceActions = [...digits.map((digit) => `select-workspace-${digit}` as const), 'previous-workspace' as const]

  it('runs a workspace key a person presses when it has a target, and leaves it to the page without one', () => {
    for (const action of workspaceActions) {
      expect(pageShortcut(action, { available: true, expectedAgentInput: false })).toBe(action)
      expect(pageShortcut(action, { available: false, expectedAgentInput: false })).toBeNull()
    }
  })

  it('leaves a workspace key an agent sends to the page, so an agent cannot switch the person\'s workspace', () => {
    for (const action of workspaceActions) expect(pageShortcut(action, { available: true, expectedAgentInput: true })).toBeNull()
    // Tab keys an agent sends still work as before.
    expect(pageShortcut('select-tab-1', { available: true, expectedAgentInput: true })).toBe('select-tab-1')
  })
})

describe('pinned workspace targets', () => {
  const workspace = (id: string, pinnedAt?: string, hiddenFromSidebar?: boolean) => ({
    id,
    ...(pinnedAt ? { pinnedAt } : {}),
    ...(hiddenFromSidebar ? { hiddenFromSidebar } : {})
  })

  it('numbers pinned workspaces in the rail\'s order, earliest pinned first, skipping unpinned ones', () => {
    const workspaces = [
      workspace('plain'),
      workspace('later', '2026-10-02T00:00:00.000Z'),
      workspace('earlier', '2026-10-01T00:00:00.000Z'),
      workspace('other')
    ]
    expect(keyedPinnedWorkspaces(workspaces).map((entry) => entry.id)).toEqual(['earlier', 'later'])
    expect(pinnedWorkspaceAt(workspaces, 1)?.id).toBe('earlier')
    expect(pinnedWorkspaceAt(workspaces, 2)?.id).toBe('later')
  })

  it('has no target past the last pinned workspace or outside 1 to 9', () => {
    const workspaces = [workspace('a', '2026-10-01T00:00:00.000Z'), workspace('b', '2026-10-02T00:00:00.000Z'), workspace('plain')]
    expect(pinnedWorkspaceAt(workspaces, 3)).toBeUndefined()
    expect(pinnedWorkspaceAt(workspaces, 0)).toBeUndefined()
    expect(pinnedWorkspaceAt(workspaces, -1)).toBeUndefined()
    expect(pinnedWorkspaceAt([workspace('plain')], 1)).toBeUndefined()
  })

  it('gives a pinned workspace hidden from the rail no key, and the next one takes its number', () => {
    const workspaces = [
      workspace('first', '2026-10-01T00:00:00.000Z'),
      workspace('hidden', '2026-10-02T00:00:00.000Z', true),
      workspace('third', '2026-10-03T00:00:00.000Z')
    ]
    expect(keyedPinnedWorkspaces(workspaces).map((entry) => entry.id)).toEqual(['first', 'third'])
    expect(pinnedWorkspaceAt(workspaces, 2)?.id).toBe('third')
    expect(pinnedWorkspaceAt(workspaces, 3)).toBeUndefined()
  })

  it('keys only the first nine pinned workspaces', () => {
    const workspaces = Array.from({ length: 12 }, (_, index) => workspace(`w${index + 1}`, new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString()))
    expect(keyedPinnedWorkspaces(workspaces).map((entry) => entry.id)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w9'])
    expect(pinnedWorkspaceAt(workspaces, 9)?.id).toBe('w9')
    expect(pinnedWorkspaceAt(workspaces, 10)).toBeUndefined()
  })
})

describe('recent workspaces for the previous-workspace key', () => {
  const workspace = (id: string, lastUsedAt: string) => ({ id, lastUsedAt })

  it('lists the other workspaces the person viewed, the latest first, then the rest by last use', () => {
    const workspaces = [
      workspace('current', '2026-10-17T10:05:00.000Z'),
      workspace('agent-busy', '2026-10-17T10:04:00.000Z'),
      workspace('viewed-earlier', '2026-10-17T09:00:00.000Z'),
      workspace('viewed-latest', '2026-10-17T08:00:00.000Z'),
      workspace('idle', '2026-10-17T07:00:00.000Z')
    ]
    const ordered = recentWorkspaces(workspaces, 'current', ['current', 'viewed-latest', 'viewed-earlier'])
    // An agent bumping a workspace's last use does not put it before the ones the person viewed.
    expect(ordered.map((entry) => entry.id)).toEqual(['viewed-latest', 'viewed-earlier', 'agent-busy', 'idle'])
  })

  it('orders by last use alone without a viewing record, treating an unreadable time as oldest', () => {
    const workspaces = [
      workspace('broken', 'not a time'),
      workspace('older', '2026-10-17T08:00:00.000Z'),
      workspace('newer', '2026-10-17T09:00:00.000Z')
    ]
    expect(recentWorkspaces(workspaces, undefined).map((entry) => entry.id)).toEqual(['newer', 'older', 'broken'])
    expect(recentWorkspaces(workspaces, 'newer', ['gone']).map((entry) => entry.id)).toEqual(['older', 'broken'])
  })
})
