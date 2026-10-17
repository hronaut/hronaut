import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useWorkspaceGroupAgents } from '../../src/renderer/src/composables/useWorkspaceGroupAgents.js'
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

  it('opens a group each time an agent there starts working or starts waiting for you', async () => {
    const { open, publish, stop } = setup({ shop: [agent('Claude Code', 'idle')] })
    await flushPromises()
    await publish({ shop: [agent('Claude Code', 'working')] })
    expect(open.mock.calls).toEqual([['shop']])
    // Still working: the person's fold since then wins.
    await publish({ shop: [agent('Claude Code', 'working'), agent('Cursor', 'idle')] })
    expect(open).toHaveBeenCalledTimes(1)
    await publish({ shop: [agent('Claude Code', 'needs-you')] })
    expect(open.mock.calls).toEqual([['shop'], ['shop']])
    // Going quiet opens nothing, and the next start opens it again.
    await publish({ shop: [agent('Claude Code', 'idle')] })
    await publish({})
    expect(open).toHaveBeenCalledTimes(2)
    await publish({ shop: [agent('Claude Code', 'working')] })
    expect(open).toHaveBeenCalledTimes(3)
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

  it('opens nothing before presence loads, and stops listening once disposed', async () => {
    const { open, publish, unsubscribe, stop } = setup({})
    await publish({ shop: [agent('Claude Code', 'working')] })
    // That change was the first presence seen, so it is the start.
    expect(open).not.toHaveBeenCalled()
    stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
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
