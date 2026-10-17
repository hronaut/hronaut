import { describe, expect, it } from 'vitest'
import {
  AGENT_ANSWERABLE_REQUESTS_LIMIT,
  AGENT_PRESENCE_WINDOW_MS,
  AgentPresenceRegistry,
  agentAnswerForDecision,
  type AgentPresenceContext
} from '../src/main/mcp/agent-presence.js'
import { parseAgentCardModel } from '../src/shared/agent-card.js'

const workspace = 'workspace-a'
const otherWorkspace = 'workspace-b'
const claude = { id: 'session-claude', name: 'Claude Code' }
const cursor = { id: 'session-cursor', name: 'Cursor' }

function context(overrides: Partial<AgentPresenceContext> = {}): AgentPresenceContext {
  return { workspaceOpen: () => true, currentAttentionId: null, tabInWorkspace: () => true, ...overrides }
}

/** A finished tool call, so the agent is seen working in the workspace. */
function call(registry: AgentPresenceRegistry, client = claude, at = 1_000, workspaceId = workspace) {
  registry.track(client, workspaceId, { activityId: `start-${at}`, toolName: 'browser_click', tabId: 'tab-1', phase: 'started', occurredAt: at, source: 'call' })
  registry.track(client, workspaceId, { activityId: `start-${at}`, toolName: 'browser_click', tabId: 'tab-1', phase: 'finished', occurredAt: at + 10, source: 'call' })
}

function answers(registry: AgentPresenceRegistry, now: number, client = claude, workspaceId = workspace) {
  const key = registry.clientKey(client.id)
  const agent = registry.derive(now, context())[workspaceId]?.find((candidate) => candidate.clientKey === key)
  return agent?.recentSteps.filter((step) => step.answer).map((step) => step.answer) ?? []
}

describe('recording your answer to an agent', () => {
  it('adds your answer to the agent\'s steps with the time, the tab and how you answered', () => {
    const registry = new AgentPresenceRegistry()
    call(registry)
    registry.recordAttention(claude, workspace, 'attention-1', 'tab-1', 2_000)
    expect(registry.recordAnswer('attention-1', 'handedBack', 3_000)).toBe(true)
    const agent = registry.derive(3_000, context())[workspace]?.[0]
    expect(agent?.recentSteps[0]).toEqual({ step: 'askYou', answer: 'handedBack', outcome: 'done', at: 3_000 })
    // All steps lists the answer too, on the tab it was about.
    const history = registry.history(registry.clientKey(claude.id), workspace, context(), new Set())
    expect(history?.[0]).toEqual({ id: expect.any(String), step: 'askYou', answer: 'handedBack', outcome: 'done', at: 3_000, tabId: 'tab-1' })
    expect(history?.[1]).toMatchObject({ step: 'click', outcome: 'done' })
  })

  it('keeps a dismissed request open, so a later answer of another kind adds a second entry', () => {
    const registry = new AgentPresenceRegistry()
    call(registry)
    registry.recordAttention(claude, workspace, 'attention-1', undefined, 2_000)
    expect(registry.recordAnswer('attention-1', 'dismissed', 3_000)).toBe(true)
    expect(registry.recordAnswer('attention-1', 'handedBack', 4_000)).toBe(true)
    expect(answers(registry, 4_000)).toEqual(['handedBack', 'dismissed'])
    // Answered another way, the request is forgotten.
    expect(registry.recordAnswer('attention-1', 'handedBack', 5_000)).toBe(false)
    expect(registry.recordAnswer('attention-1', 'dismissed', 5_000)).toBe(false)
    expect(answers(registry, 5_000)).toEqual(['handedBack', 'dismissed'])
  })

  it('records a repeated dismissal once', () => {
    const registry = new AgentPresenceRegistry()
    call(registry)
    registry.recordAttention(claude, workspace, 'attention-1', undefined, 2_000)
    expect(registry.recordAnswer('attention-1', 'dismissed', 3_000)).toBe(true)
    expect(registry.recordAnswer('attention-1', 'dismissed', 3_500)).toBe(false)
    expect(answers(registry, 3_500)).toEqual(['dismissed'])
  })

  it('records nothing for a request it never saw', () => {
    const registry = new AgentPresenceRegistry()
    call(registry)
    expect(registry.recordAnswer('unknown', 'handedBack', 2_000)).toBe(false)
    expect(answers(registry, 2_000)).toEqual([])
  })

  it('records nothing once the agent\'s session closed', () => {
    const registry = new AgentPresenceRegistry()
    call(registry)
    registry.recordAttention(claude, workspace, 'attention-1', undefined, 2_000)
    registry.removeClient(claude.id)
    expect(registry.recordAnswer('attention-1', 'handedBack', 3_000)).toBe(false)
    expect(registry.history(registry.clientKey(claude.id), workspace, context(), new Set())).toBeNull()
  })

  it('records nothing once the request\'s workspace is no longer open', () => {
    const registry = new AgentPresenceRegistry()
    call(registry)
    registry.recordAttention(claude, workspace, 'attention-1', undefined, 2_000)
    expect(registry.recordAnswer('attention-1', 'handedBack', 3_000, (workspaceId) => workspaceId !== workspace)).toBe(false)
    expect(answers(registry, 3_000)).toEqual([])
  })

  it('still records the answer to a request that another request replaced meanwhile', () => {
    const registry = new AgentPresenceRegistry()
    call(registry)
    call(registry, cursor)
    registry.recordAttention(claude, workspace, 'attention-1', undefined, 2_000)
    registry.recordAttention(cursor, workspace, 'attention-2', undefined, 2_500)
    // Only the newer request is current, so the older one no longer shows as needs you.
    const shown = registry.derive(2_600, context({ currentAttentionId: 'attention-2' }))[workspace]
    expect(shown?.map((agent) => agent.name)).toEqual(['Cursor', 'Claude Code'])
    expect(shown?.map((agent) => agent.state)[1]).not.toBe('needs-you')
    expect(registry.recordAnswer('attention-1', 'approved', 3_000)).toBe(true)
    expect(answers(registry, 3_000)).toEqual(['approved'])
    expect(answers(registry, 3_000, cursor)).toEqual([])
  })

  it('counts your answer as activity, so the idle avatar stays for the presence window after it', () => {
    const registry = new AgentPresenceRegistry()
    call(registry, claude, 0)
    registry.recordAttention(claude, workspace, 'attention-1', undefined, 1_000)
    const answeredAt = AGENT_PRESENCE_WINDOW_MS - 1_000
    expect(registry.recordAnswer('attention-1', 'handedBack', answeredAt)).toBe(true)
    expect(registry.derive(answeredAt + AGENT_PRESENCE_WINDOW_MS - 1, context())[workspace]?.[0]?.state).toBe('idle')
    expect(registry.derive(answeredAt + AGENT_PRESENCE_WINDOW_MS, context())[workspace]).toBeUndefined()
  })

  it('remembers at most the latest requests, so the oldest can no longer be answered into the steps', () => {
    const registry = new AgentPresenceRegistry()
    call(registry)
    for (let index = 0; index <= AGENT_ANSWERABLE_REQUESTS_LIMIT; index += 1) {
      registry.recordAttention(claude, workspace, `attention-${index}`, undefined, 2_000 + index)
    }
    expect(registry.recordAnswer('attention-0', 'handedBack', 5_000)).toBe(false)
    expect(registry.recordAnswer('attention-1', 'handedBack', 5_000)).toBe(true)
  })

  it('never puts your answers in Home\'s feed', () => {
    const registry = new AgentPresenceRegistry()
    call(registry)
    expect(registry.latestFeedStep(claude.id, workspace)).toMatchObject({ step: 'click', outcome: 'done' })
    registry.recordAttention(claude, workspace, 'attention-1', undefined, 2_000)
    registry.recordAnswer('attention-1', 'handedBack', 3_000)
    expect(registry.latestFeedStep(claude.id, workspace)).toBeUndefined()
  })
})

describe('finding the request a decision came from', () => {
  it('finds the newest request for a decision in its workspace only', () => {
    const registry = new AgentPresenceRegistry()
    call(registry)
    registry.recordAttention(claude, workspace, 'attention-1', undefined, 2_000, 'decision-1')
    registry.recordAttention(claude, workspace, 'attention-2', undefined, 2_100, 'decision-2')
    // The decision's reminder makes a new request for the same decision.
    registry.recordAttention(claude, workspace, 'attention-3', undefined, 2_200, 'decision-1')
    expect(registry.decisionRequest(workspace, 'decision-1')).toBe('attention-3')
    expect(registry.decisionRequest(workspace, 'decision-2')).toBe('attention-2')
    expect(registry.decisionRequest(otherWorkspace, 'decision-1')).toBeUndefined()
    expect(registry.decisionRequest(workspace, 'missing')).toBeUndefined()
  })

  it('records the decision\'s answer after another request took its place, then forgets the request', () => {
    const registry = new AgentPresenceRegistry()
    call(registry)
    call(registry, cursor)
    registry.recordAttention(claude, workspace, 'attention-1', undefined, 2_000, 'decision-1')
    registry.recordAttention(cursor, workspace, 'attention-2', undefined, 2_500)
    const attentionId = registry.decisionRequest(workspace, 'decision-1')
    expect(attentionId).toBe('attention-1')
    expect(registry.recordAnswer(attentionId!, agentAnswerForDecision('approve-action', 'resolve'), 3_000)).toBe(true)
    expect(answers(registry, 3_000)).toEqual(['approved'])
    expect(registry.decisionRequest(workspace, 'decision-1')).toBeUndefined()
  })

  it('does not take a plain request for a decision', () => {
    const registry = new AgentPresenceRegistry()
    call(registry)
    registry.recordAttention(claude, workspace, 'attention-1', undefined, 2_000)
    expect(registry.decisionRequest(workspace, 'attention-1')).toBeUndefined()
  })
})

describe('how an answered decision reads', () => {
  it.each([
    ['review-page', 'resolve', 'handedBack'],
    ['review-page', 'reject', 'sentBack'],
    ['approve-action', 'resolve', 'approved'],
    ['approve-action', 'reject', 'rejected'],
    ['provide-input', 'resolve', 'answered'],
    ['provide-input', 'reject', 'rejected'],
    ['resolve-unknown', 'resolve', 'resolved'],
    ['resolve-unknown', 'reject', 'rejected'],
    ['review-page', 'cancel', 'cancelled'],
    ['approve-action', 'cancel', 'cancelled']
  ] as const)('%s answered with %s reads as %s', (decision, action, expected) => {
    expect(agentAnswerForDecision(decision, action)).toBe(expected)
  })
})

describe('the agent card\'s answer entries', () => {
  const card = (step: Record<string, unknown>) => ({
    label: 'Claude Code', name: 'Claude Code', initial: 'C', color: '#123456', state: 'idle', stateLabel: 'Idle',
    subtitle: 'Connected over MCP · Checkout', now: { heading: 'Now', text: 'Waiting' },
    recent: { heading: 'Recent steps', empty: 'No steps yet', steps: [step] },
    follow: { label: 'Follow', checked: false }, cursor: { label: 'Cursor', checked: true }, pin: { label: 'Pin', checked: false },
    buttons: [], closeLabel: 'Close'
  })

  it('keeps the mark that a step is your answer, and refuses any other value for it', () => {
    expect(parseAgentCardModel(card({ text: 'You handed it back · 02:15', you: true })).recent.steps)
      .toEqual([{ text: 'You handed it back · 02:15', you: true }])
    expect(parseAgentCardModel(card({ text: 'Clicked Pay' })).recent.steps).toEqual([{ text: 'Clicked Pay' }])
    expect(() => parseAgentCardModel(card({ text: 'You handed it back', you: false }))).toThrow('Invalid agent card step')
    expect(() => parseAgentCardModel(card({ text: 'You handed it back', you: 'yes' }))).toThrow('Invalid agent card step')
  })
})
