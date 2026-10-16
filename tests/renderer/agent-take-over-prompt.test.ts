import { fireEvent, screen } from '@testing-library/vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import AgentTakeOverPrompt from '../../src/renderer/src/components/AgentTakeOverPrompt.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { AgentPresence, AgentPresenceSnapshot, AgentTakeOverOffer, HronautAgentPresenceApi } from '../../src/shared/agent-presence.js'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren() })

function agent(name: string, overrides: Partial<AgentPresence> = {}): AgentPresence {
  return { clientKey: `key-${name}`, name, initial: name.slice(0, 1).toUpperCase(), colorIndex: 2, state: 'working', step: 'click', recentSteps: [], lastTabId: 'tab-1', ...overrides }
}

type Tab = { id: string; agentPaused?: boolean; takenOverAt?: number }

// The prompt measures the toolbar around it, so it is mounted in one: the reload button, the address field and
// the commands, at the start of which it sits.
const Toolbar = defineComponent({
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () => h('div', { class: 'toolbar' }, [
      h('button', { class: 'reload-button' }),
      h('form', { class: 'address-form', style: 'max-width: 520px' }),
      h('div', { class: 'toolbar-commands', style: 'column-gap: 5px' }, [h(AgentTakeOverPrompt, attrs)])
    ])
  }
})

/**
 * A toolbar laid out as in the window: the commands share the address's row or have one of their own, and grow
 * by the prompt's width plus the 5 px gap when it shows.
 */
function layout(options: { wrapped?: boolean; row?: number; address?: number; margins?: number; commands: number; full: number; compact: number }) {
  const address = document.querySelector<HTMLElement>('.address-form')!
  address.style.margin = `0 ${(options.margins ?? 0) / 2}px`
  const toolbar = document.querySelector<HTMLElement>('.toolbar')!
  toolbar.style.padding = '0 12px'
  Object.defineProperty(toolbar, 'clientWidth', { configurable: true, value: (options.row ?? 0) + 24 + 6 })
  document.querySelector<HTMLElement>('.toolbar-commands')!.style.marginLeft = '6px'
  const box = (top: number, width: number, height = 40) => ({ x: 0, y: top, left: 0, top, width, height, right: width, bottom: top + height, toJSON: () => ({}) }) as DOMRect
  const shown = () => {
    const pill = document.querySelector<HTMLElement>('[data-testid="agent-take-over"]')
    return pill ? (pill.dataset.fit === 'full' ? options.full : options.compact) : 0
  }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.matches('.reload-button')) return box(10, 40)
    if (this.matches('.address-form')) return box(10, options.address ?? 520)
    if (this.matches('.toolbar-commands')) return box(options.wrapped ? 60 : 10, options.commands + (shown() ? shown() + 5 : 0))
    if (this.matches('.agent-take-over-measure > .compact')) return box(0, options.compact, 36)
    if (this.matches('.agent-take-over-measure > .agent-take-over')) return box(0, options.full, 36)
    if (this.matches('[data-testid="agent-take-over"]')) return box(0, shown(), 36)
    return box(0, 0, 0)
  })
}

const settle = async () => { for (let turn = 0; turn < 4; turn += 1) await nextTick() }

async function renderPrompt(agents: AgentPresence[], props: { tabs?: readonly Tab[]; activeTabId?: string; agentControlLocked?: boolean } = {}) {
  let offerListener: ((offer: AgentTakeOverOffer) => void) | undefined
  let changeListener: ((snapshot: AgentPresenceSnapshot) => void) | undefined
  const stopOffers = vi.fn(() => { offerListener = undefined })
  const api: HronautAgentPresenceApi = {
    get: vi.fn(async () => ({ revision: 1, workspaces: { 'workspace-a': agents } })),
    onChanged: (listener) => { changeListener = listener; return () => undefined },
    onTakeOverOffer: (listener) => { offerListener = listener; return stopOffers }
  }
  const host = mount(Toolbar, {
    attachTo: document.body,
    global: { plugins: [createHronautI18n('en-US')] },
    props: { workspaceId: 'workspace-a', activeTabId: 'tab-1', tabs: [{ id: 'tab-1' }, { id: 'tab-2' }], api, ...props }
  })
  // Unless a case lays the toolbar out itself, it has room for the prompt with its words.
  layout({ margins: 600, commands: 430, full: 300, compact: 120 })
  await flushPromises()
  await settle()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const inner = () => host.getComponent(AgentTakeOverPrompt)
  const view = {
    emitted: (event: string) => inner().emitted(event),
    get vm() { return inner().vm as unknown as { takeOver: () => boolean; offerText: string; badge?: { clientKey: string; kind: string } } },
    setProps: async (next: Record<string, unknown>) => { await host.setProps(next); await settle() },
    unmount: () => host.unmount()
  }
  return {
    view,
    stopOffers,
    offer: async (offer: AgentTakeOverOffer) => { offerListener?.(offer); await settle() },
    presenceChanged: async (revision: number, next: AgentPresence[]) => { changeListener?.({ revision, workspaces: { 'workspace-a': next } }); await settle() }
  }
}

const prompt = () => screen.queryByTestId('agent-take-over')

describe('take over from an agent in the toolbar', () => {
  it('offers to take over after you touch the page the agent is working on, and announces it', async () => {
    const { offer } = await renderPrompt([agent('Claude Code')])
    expect(prompt()).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('')
    await offer({ tabId: 'tab-1', clientKey: 'key-Claude Code' })
    const group = screen.getByRole('group', { name: 'Take over from Claude Code?' })
    expect(group.dataset.state).toBe('offer')
    const button = screen.getByRole('button', { name: 'Take over' })
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+O Meta+Shift+O')
    expect(button.dataset.tooltip).toBe('Pause Claude Code on this tab and carry on yourself')
    expect(screen.getByRole('status').textContent).toBe('Take over from Claude Code?')
  })

  it.each([
    ['another tab', { tabId: 'tab-2', clientKey: 'key-Claude Code' }, [agent('Claude Code', { lastTabId: 'tab-2' })], {}],
    ['an agent that is no longer working', { tabId: 'tab-1', clientKey: 'key-Claude Code' }, [agent('Claude Code', { state: 'idle' })], {}],
    ['an agent working on another tab', { tabId: 'tab-1', clientKey: 'key-Claude Code' }, [agent('Claude Code', { lastTabId: 'tab-2' })], {}],
    ['an agent not in this workspace', { tabId: 'tab-1', clientKey: 'key-Cursor' }, [agent('Claude Code')], {}],
    ['a tab whose agents are paused', { tabId: 'tab-1', clientKey: 'key-Claude Code' }, [agent('Claude Code')], { tabs: [{ id: 'tab-1', agentPaused: true }] }],
    ['locked agent control', { tabId: 'tab-1', clientKey: 'key-Claude Code' }, [agent('Claude Code')], { agentControlLocked: true }]
  ] as const)('offers nothing for %s', async (_case, next, agents, props) => {
    const { offer } = await renderPrompt([...agents], props)
    await offer(next)
    expect(prompt()).toBeNull()
  })

  it('lasts eight seconds from your latest touch, and goes when you dismiss it', async () => {
    const { offer } = await renderPrompt([agent('Claude Code')])
    await offer({ tabId: 'tab-1', clientKey: 'key-Claude Code' })
    vi.advanceTimersByTime(6_000)
    await offer({ tabId: 'tab-1', clientKey: 'key-Claude Code' })
    vi.advanceTimersByTime(7_999)
    await nextTick()
    expect(prompt()).not.toBeNull()
    vi.advanceTimersByTime(1)
    await nextTick()
    expect(prompt()).toBeNull()
    await offer({ tabId: 'tab-1', clientKey: 'key-Claude Code' })
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(prompt()).toBeNull()
  })

  it('keeps a dismissed offer away while that agent goes on working on the tab', async () => {
    const { offer, presenceChanged, view } = await renderPrompt([agent('Claude Code'), agent('Cursor')])
    await offer({ tabId: 'tab-1', clientKey: 'key-Claude Code' })
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    // You keep typing in the page.
    await offer({ tabId: 'tab-1', clientKey: 'key-Claude Code' })
    expect(prompt()).toBeNull()
    // The shortcut still takes over.
    expect(view.vm.takeOver()).toBe(true)
    // Another agent's offer shows.
    await offer({ tabId: 'tab-1', clientKey: 'key-Cursor' })
    expect(screen.getByRole('group', { name: 'Take over from Cursor?' })).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    // Once the agent stops working there, its next turn on the tab offers again.
    await presenceChanged(2, [agent('Claude Code', { state: 'idle' }), agent('Cursor')])
    await presenceChanged(3, [agent('Claude Code'), agent('Cursor')])
    await offer({ tabId: 'tab-1', clientKey: 'key-Claude Code' })
    expect(screen.getByRole('group', { name: 'Take over from Claude Code?' })).toBeTruthy()
  })

  it('takes over from the button, or by shortcut whenever the agent is working on the page', async () => {
    const { view, offer } = await renderPrompt([agent('Claude Code')])
    const exposed = () => view.vm
    await offer({ tabId: 'tab-1', clientKey: 'key-Claude Code' })
    expect(exposed().offerText).toBe('Take over from Claude Code?')
    await fireEvent.click(screen.getByRole('button', { name: 'Take over' }))
    expect(view.emitted('takeOver')).toEqual([['tab-1']])
    expect(prompt()).toBeNull()
    expect(exposed().offerText).toBe('')
    // The shortcut needs no offer while the agent is working on the page in view.
    expect(exposed().takeOver()).toBe(true)
    expect(view.emitted('takeOver')).toEqual([['tab-1'], ['tab-1']])
  })

  it.each([
    ['an idle agent', [agent('Claude Code', { state: 'idle' })], {}],
    ['an agent working on another tab', [agent('Claude Code', { lastTabId: 'tab-2' })], {}],
    ['a paused tab', [agent('Claude Code')], { tabs: [{ id: 'tab-1', agentPaused: true }] }],
    ['locked agent control', [agent('Claude Code')], { agentControlLocked: true }]
  ] as const)('takes nothing over by shortcut from %s', async (_case, agents, props) => {
    const { view } = await renderPrompt([...agents], props)
    expect(view.vm.takeOver()).toBe(false)
    expect(view.emitted('takeOver')).toBeUndefined()
  })

  it('says you have control of a tab you took over and hands it back to its agent', async () => {
    const { view } = await renderPrompt([agent('Claude Code', { state: 'idle' })], { tabs: [{ id: 'tab-1', agentPaused: true, takenOverAt: 1 }] })
    const group = screen.getByRole('group', { name: 'You have control' })
    expect(group.dataset.state).toBe('control')
    expect(screen.getByRole('status').textContent).toBe('You have control')
    const handBack = screen.getByRole('button', { name: 'Hand back to Claude Code' })
    expect(handBack.dataset.tooltip).toBe('Resume the agent on this tab and tell it what changed')
    await fireEvent.click(handBack)
    expect(view.emitted('handBack')).toEqual([['tab-1']])
    await view.setProps({ agentControlLocked: true })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Hand back to Claude Code' }).disabled).toBe(true)
  })

  it('hands back without a name once the agent has left, and shows nothing for a plain pause', async () => {
    const { view } = await renderPrompt([], { tabs: [{ id: 'tab-1', agentPaused: true, takenOverAt: 1 }] })
    expect(screen.getByRole('button', { name: 'Hand back' })).toBeTruthy()
    await view.setProps({ tabs: [{ id: 'tab-1', agentPaused: true }] })
    expect(prompt()).toBeNull()
  })

  it('stops hearing offers when it leaves', async () => {
    const { view, stopOffers } = await renderPrompt([agent('Claude Code')])
    view.unmount()
    expect(stopOffers).toHaveBeenCalledOnce()
  })
})

describe('room for the take-over prompt', () => {

  it('asks in words beside the commands when the address field leaves room', async () => {
    const { offer, view } = await renderPrompt([agent('Claude Code')])
    layout({ margins: 320, commands: 430, full: 300, compact: 120 })
    await offer({ tabId: 'tab-1', clientKey: 'key-Claude Code' })
    expect(prompt()?.dataset.fit).toBe('full')
    expect(prompt()?.textContent).toContain('Take over from Claude Code?')
    expect(view.vm.badge).toBeUndefined()
  })

  it('keeps only its buttons in less room, and in none leaves a badge on the avatar', async () => {
    const { offer, view } = await renderPrompt([agent('Claude Code'), agent('Cursor')])
    layout({ margins: 150, commands: 430, full: 300, compact: 120 })
    await offer({ tabId: 'tab-1', clientKey: 'key-Claude Code' })
    expect(prompt()?.dataset.fit).toBe('compact')
    expect(prompt()?.textContent).not.toContain('Take over from')
    // The group still says what it is for, and the button keeps its shortcut.
    expect(screen.getByRole('group', { name: 'Take over from Claude Code?' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Take over' }).getAttribute('aria-keyshortcuts')).toBe('Control+Shift+O Meta+Shift+O')
    expect(view.vm.badge).toBeUndefined()

    // A field already narrower than its widest leaves no room: nothing may narrow it further.
    layout({ address: 400, margins: 0, commands: 430, full: 300, compact: 120 })
    await offer({ tabId: 'tab-1', clientKey: 'key-Cursor' })
    expect(prompt()).toBeNull()
    expect(view.vm.badge).toEqual({ clientKey: 'key-Cursor', kind: 'offer' })
  })

  it('takes the room before the commands when they have a row of their own, and keeps its size once shown', async () => {
    const { offer, view } = await renderPrompt([agent('Claude Code'), agent('Cursor')])
    // 290 px of the commands' row is free.
    layout({ wrapped: true, row: 720, commands: 430, full: 300, compact: 120 })
    await offer({ tabId: 'tab-1', clientKey: 'key-Claude Code' })
    expect(prompt()?.dataset.fit).toBe('compact')
    // Measured again while it shows, it counts its own width as free.
    await offer({ tabId: 'tab-1', clientKey: 'key-Cursor' })
    expect(screen.getByRole('group', { name: 'Take over from Cursor?' }).dataset.fit).toBe('compact')
    expect(view.vm.badge).toBeUndefined()
  })

  it('marks the avatar of the agent whose tab you have when there is no room to say so', async () => {
    const { view } = await renderPrompt([agent('Claude Code', { state: 'idle' })], { tabs: [{ id: 'tab-1', agentPaused: true, takenOverAt: 1 }] })
    layout({ wrapped: true, row: 500, commands: 430, full: 260, compact: 100 })
    await view.setProps({ tabs: [{ id: 'tab-1', agentPaused: true, takenOverAt: 2 }], agentControlLocked: true })
    expect(prompt()).toBeNull()
    expect(view.vm.badge).toEqual({ clientKey: 'key-Claude Code', kind: 'control' })
    // The status still says you have control.
    expect(screen.getByRole('status').textContent).toBe('You have control')
  })
})

