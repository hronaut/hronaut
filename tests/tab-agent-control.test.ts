import { describe, expect, it } from 'vitest'
import type { BrowserState } from '../src/shared/types.js'
import { requireTabAgentControl } from '../src/main/mcp/tab-agent-control.js'

function fixture(global = true) {
  const paused = new Set(['blocked'])
  const state = { activeTabId: 'allowed', tabs: [{ id: 'allowed' }, { id: 'blocked' }] } as BrowserState
  const manager = {
    getState: () => state,
    getMcpGroupState: (id: string) => {
      if (id !== 'workspace') throw new Error('Unknown workspace')
      return state
    },
    isTabAgentPaused: (id: string) => paused.has(id)
  }
  return { paused, state, check: (name: string, input: Record<string, unknown>, targeted = false, resolved?: string) =>
    requireTabAgentControl(manager, global, name, input, targeted, resolved) }
}

describe('per-tab agent authorization', () => {
  it('allows only the resumed tab, resolving omitted targets and rechecking live state', () => {
    const { check, paused, state } = fixture()
    expect(() => check('browser_snapshot', { workspaceId: 'workspace' }, true)).not.toThrow()
    expect(() => check('browser_click', { workspaceId: 'workspace', tabId: 'blocked' }, true)).toThrow(/paused/)
    expect(() => check('browser_click', { workspaceId: 'workspace', tabId: 'missing' }, true)).toThrow(/paused/)
    state.activeTabId = 'blocked'
    expect(() => check('browser_snapshot', { workspaceId: 'workspace' }, true)).toThrow(/paused/)
    expect(() => check('browser_snapshot', { workspaceId: 'workspace' }, true, 'allowed')).not.toThrow()
    paused.add('allowed')
    expect(() => check('browser_snapshot', { workspaceId: 'workspace' }, true, 'allowed')).toThrow(/paused/)
  })

  it.each(['browser_new_tab', 'browser_site_data', 'browser_task_runs', 'browser_saved_workspaces'])('does not lend a tab exception to %s', name => {
    expect(() => fixture().check(name, { workspaceId: 'workspace', tabId: 'allowed' })).toThrow(/paused/)
  })

  it('allows ownership recovery and discovery without allowing workspace creation', () => {
    const { check } = fixture()
    expect(() => check('browser_workspaces', { action: 'resume', workspaceId: 'workspace' })).not.toThrow()
    expect(() => check('browser_workspaces', { action: 'claim-ownership', workspaceId: 'workspace' })).not.toThrow()
    expect(() => check('browser_tabs', { workspaceId: 'workspace' })).not.toThrow()
    expect(() => check('browser_workspaces', { action: 'create' })).toThrow(/paused/)
  })

  it('keeps per-tab pause effective after global resume without blocking an unrelated new workspace', () => {
    const { check } = fixture(false)
    expect(() => check('browser_snapshot', { workspaceId: 'workspace', tabId: 'blocked' }, true)).toThrow(/paused/)
    expect(() => check('browser_snapshot', { workspaceId: 'workspace', tabId: 'allowed' }, true)).not.toThrow()
    expect(() => check('browser_site_data', { workspaceId: 'workspace' })).toThrow(/paused/)
    expect(() => check('browser_workspaces', { action: 'create' })).not.toThrow()
  })
})

describe('a tab the person took over', () => {
  function takenOver(global: boolean) {
    const paused = new Set(['taken'])
    const state = { activeTabId: 'taken', tabs: [{ id: 'free' }, { id: 'taken' }] } as BrowserState
    const manager = {
      getState: () => state,
      getMcpGroupState: () => state,
      isTabAgentPaused: (id: string) => paused.has(id),
      isTabTakenOver: (id: string) => id === 'taken'
    }
    return (input: Record<string, unknown>) => requireTabAgentControl(manager, global, 'browser_click', input, true)
  }

  it('tells the agent the person has control and how it hears of the hand back', () => {
    const check = takenOver(false)
    expect(() => check({ workspaceId: 'workspace', tabId: 'taken' })).toThrow(/^Agents are paused for this tab: the person took it over in the Hronaut window and has control\..*handedBack/)
    expect(() => check({ workspaceId: 'workspace' })).toThrow(/took it over/)
    expect(() => check({ workspaceId: 'workspace', tabId: 'free' })).not.toThrow()
  })

  it('gives the general pause message while all agents are paused', () => {
    expect(() => takenOver(true)({ workspaceId: 'workspace', tabId: 'taken' })).toThrow(/^Agents are paused for this target\./)
  })
})
