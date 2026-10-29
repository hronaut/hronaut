import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useWorkspaceGroupAgents } from '../../src/renderer/src/features/workspaces/useWorkspaceGroupAgents.js'
import type { AgentPresence, AgentPresenceSnapshot, HronautAgentPresenceApi } from '../../src/shared/agent-presence.js'

function agent(name: string, state: AgentPresence['state']): AgentPresence {
  return { clientKey: `key-${name}`, name, initial: name.slice(0, 1).toUpperCase(), colorIndex: 2, state, step: 'click', recentSteps: [] }
}

function setup(initial: AgentPresenceSnapshot['workspaces'], workspaceIds = ['shop', 'blog']) {
  let listener!: (snapshot: AgentPresenceSnapshot) => void
  let revision = 1
  const unsubscribe = vi.fn()
  const api: HronautAgentPresenceApi = {
    get: () => Promise.resolve({ revision, workspaces: initial }),
    onChanged: (next) => { listener = next; return unsubscribe }
  }
  const ids = ref(workspaceIds)
  const attention = ref<string | null>(null)
  const open = vi.fn()
  const scope = effectScope()
  const groups = scope.run(() => useWorkspaceGroupAgents({ api, workspaceIds: () => ids.value, needsYou: (id) => attention.value === id, open }))!
  return {
    groups,
    ids,
    attention,
    open,
    unsubscribe,
    publish: async (workspaces: AgentPresenceSnapshot['workspaces']) => { listener({ revision: ++revision, workspaces }); await nextTick() },
    stop: () => { groups.dispose(); scope.stop() }
  }
}

describe('useWorkspaceGroupAgents', () => {
  it('starts from the activity presence first shows, so a reload opens nothing', async () => {
    const { groups, open, stop } = setup({ shop: [agent('Claude Code', 'working')], blog: [agent('Cursor', 'needs-you')] })
    await flushPromises()
    expect(groups.agents('shop').map((entry) => entry.name)).toEqual(['Claude Code'])
    expect(groups.activity('shop')).toBe('working')
    expect(groups.activity('blog')).toBe('needs-you')
    expect(groups.activity('other')).toBe('quiet')
    expect(open).not.toHaveBeenCalled()
    stop()
  })

  it('opens a group when an agent that was not there starts working, not when one resumes after a pause', async () => {
    const { open, publish, stop } = setup({ shop: [agent('Claude Code', 'idle')] })
    await flushPromises()
    // The same agent between its own steps: idle after a pause, then working again. The person's fold wins.
    await publish({ shop: [agent('Claude Code', 'working')] })
    await publish({ shop: [agent('Claude Code', 'idle')] })
    await publish({ shop: [agent('Claude Code', 'working')] })
    expect(open).not.toHaveBeenCalled()
    // Another agent arrives and starts working.
    await publish({ shop: [agent('Claude Code', 'working'), agent('Cursor', 'working')] })
    expect(open.mock.calls).toEqual([['shop']])
    // An agent that arrives idle opens nothing until it works, and then it was already there.
    await publish({ shop: [agent('Claude Code', 'working'), agent('Cursor', 'working'), agent('Codex', 'idle')] })
    await publish({ shop: [agent('Claude Code', 'working'), agent('Cursor', 'working'), agent('Codex', 'working')] })
    expect(open).toHaveBeenCalledTimes(1)
    // Once every agent has gone, the next one to work is a start again.
    await publish({})
    await publish({ shop: [agent('Claude Code', 'working')] })
    expect(open.mock.calls).toEqual([['shop'], ['shop']])
    stop()
  })

  it('opens a group when it starts waiting for you, and not when the request ends while the agent carries on', async () => {
    const { open, publish, stop } = setup({ shop: [agent('Claude Code', 'working')] })
    await flushPromises()
    await publish({ shop: [agent('Claude Code', 'needs-you')] })
    expect(open.mock.calls).toEqual([['shop']])
    await publish({ shop: [agent('Claude Code', 'needs-you'), agent('Cursor', 'idle')] })
    await publish({ shop: [agent('Claude Code', 'working')] })
    expect(open).toHaveBeenCalledTimes(1)
    await publish({ shop: [agent('Claude Code', 'needs-you')] })
    expect(open).toHaveBeenCalledTimes(2)
    stop()
  })

  it('counts an attention request on the workspace as waiting for you', async () => {
    const { groups, attention, open, stop } = setup({ blog: [agent('Cursor', 'working')] })
    await flushPromises()
    attention.value = 'blog'
    await nextTick()
    expect(groups.activity('blog')).toBe('needs-you')
    expect(open.mock.calls).toEqual([['blog']])
    stop()
  })

  it('starts a workspace that appears later from its own first activity', async () => {
    const { ids, open, publish, stop } = setup({ shop: [agent('Claude Code', 'working')], docs: [agent('Cursor', 'working')] })
    await flushPromises()
    ids.value = ['shop', 'blog', 'docs']
    await nextTick()
    expect(open).not.toHaveBeenCalled()
    await publish({ shop: [agent('Claude Code', 'working')], docs: [agent('Cursor', 'needs-you')] })
    expect(open.mock.calls).toEqual([['docs']])
    stop()
  })

  it('takes the first presence it hears as the start, even a change before its first read returns', async () => {
    const { attention, open, publish, stop } = setup({})
    // An attention request before presence loads is part of where it starts too. Neither waits, so the change arrives
    // before the first read returns.
    attention.value = 'blog'
    await publish({ shop: [agent('Claude Code', 'working')] })
    await flushPromises()
    expect(open).not.toHaveBeenCalled()
    stop()
  })

  it('stops listening and opens nothing once disposed', async () => {
    const { groups, attention, open, publish, unsubscribe, stop } = setup({ shop: [agent('Claude Code', 'idle')] })
    await flushPromises()
    groups.dispose()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    attention.value = 'shop'
    await publish({ shop: [agent('Claude Code', 'needs-you'), agent('Cursor', 'working')] })
    expect(open).not.toHaveBeenCalled()
    stop()
  })

  it('shows no agents without a presence channel', () => {
    const open = vi.fn()
    const scope = effectScope()
    const groups = scope.run(() => useWorkspaceGroupAgents({ api: undefined, workspaceIds: () => ['shop'], needsYou: () => false, open }))!
    expect(groups.agents('shop')).toEqual([])
    expect(groups.activity('shop')).toBe('quiet')
    groups.dispose()
    scope.stop()
    expect(open).not.toHaveBeenCalled()
  })
})
