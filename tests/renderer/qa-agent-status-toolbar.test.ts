import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, within } from '@testing-library/vue'
import { nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import McpStatusControls from '../../src/renderer/src/components/McpStatusControls.vue'
import { useMcpStatusController } from '../../src/renderer/src/composables/useMcpStatusController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { HronautMcpApi, McpControlState } from '../../src/shared/types.js'

// Regression coverage for the toolbar side of the agent status redesign (the toolbar label cut and the status
// popover; listed with #872 and #873, introduced in #870), deferred to the redesign QA pass. Cases already in
// mcp-status-controls.test.ts (ready, named, working, needs you, paused, port problems, Copy URL) are not repeated.

const t = createHronautI18n('en-US').global.t as (key: string) => string

function control(overrides: Partial<McpControlState> = {}): McpControlState {
  return { status: 'ready', paused: false, ...overrides }
}

function renderControls(initial: McpControlState) {
  const getState = vi.fn<HronautMcpApi['getState']>(async () => initial)
  const api: HronautMcpApi = {
    getState,
    setPaused: vi.fn(async (paused: boolean) => control({ status: paused ? 'paused' : 'ready', paused })),
    moveToSuggestedPort: vi.fn(async (port: number) => ({ result: { outcome: 'moved' as const, port }, state: control() })),
    onChanged: vi.fn(() => () => undefined)
  }
  const controller = useMcpStatusController({
    api,
    endpoint: ref('http://127.0.0.1:47812/mcp'),
    copyText: vi.fn(async () => true),
    onPauseError: vi.fn()
  })
  controller.accept(initial)
  const view = render(McpStatusControls, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { controller }
  })
  return { controller, getState, view }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('toolbar agent status label', () => {
  it('keeps a long agent name whole in the button\'s name, label text and tooltip, leaving the cut to CSS', () => {
    const name = 'An agent whose self-reported client name is far longer than the toolbar can show'
    const { controller, view } = renderControls(control({ agents: [{ key: 'a', name, state: 'idle' }] }))
    try {
      const button = screen.getByRole('button', { name: `${name} connected` })
      expect(button.querySelector('.mcp-pill-label')).toHaveTextContent(`${name} connected`)
      expect(button).toHaveClass('mcp-pill')
      // Pointer users see the whole status in the tooltip, since the label itself is cut.
      expect(button).toHaveAttribute('data-tooltip', `${name} connected. MCP: http://127.0.0.1:47812/mcp`)
      // Its name already says the status, so a screen reader hears only the address after it.
      expect(button).toHaveAttribute('aria-description', 'MCP: http://127.0.0.1:47812/mcp')
    } finally {
      view.unmount()
      controller.dispose()
    }
  })

  it('cuts the label at 190 px with an ellipsis, and to one line in the rail\'s fixed-width row', () => {
    const shell = readFileSync(join(process.cwd(), 'src/renderer/src/styles/shell.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
    const rule = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
      const body = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'u').exec(shell)?.[1]
      expect(body, selector).toBeDefined()
      return body!
    }
    const toolbar = rule('.mcp-pill-label')
    for (const utility of ['overflow-hidden', 'text-ellipsis', 'whitespace-nowrap', '[max-width:190px]']) expect(toolbar).toContain(utility)

    // 3.0 let the rail's label wrap, so "2 agents working" took two lines beside "Pause agents" in a 250 px rail.
    const rail = rule('.vertical-tabs-shell .mcp-pill-label')
    for (const utility of ['[max-width:none]', 'min-w-0']) expect(rail).toContain(utility)
    for (const utility of ['whitespace-normal', 'line-clamp']) expect(rail).not.toContain(utility)
    expect(rule('.vertical-tabs-shell .topbar-actions')).toContain('[container:rail-footer_/_inline-size]')
    expect(shell).toMatch(/@container rail-footer \(width < 340px\) \{\s*\.mcp-pause-label \{ @apply hidden; \}/u)
  })

  it('says it is getting ready while the server starts, with the address in the tooltip', () => {
    const { controller, view } = renderControls(control({ status: 'starting' }))
    try {
      const button = screen.getByRole('button', { name: 'Getting ready for agents' })
      expect(button).toHaveAttribute('data-tooltip', 'MCP is starting at http://127.0.0.1:47812/mcp')
      expect(screen.getByRole('button', { name: 'Pause agents' })).toBeDisabled()
      expect(view.container.querySelector('.mcp-controls')).toHaveClass('starting')
    } finally {
      view.unmount()
      controller.dispose()
    }
  })

  it('names the count when several agents are connected and none is working', () => {
    const { controller, view } = renderControls(control({ agents: [
      { key: 'a', name: 'Claude Code', state: 'idle' },
      { key: 'b', name: 'Codex', state: 'idle' },
      // The same client seen in a second workspace counts once.
      { key: 'b', name: 'Codex', state: 'idle' }
    ] }))
    try {
      expect(screen.getByRole('button', { name: '2 agents connected' })).toBeVisible()
    } finally {
      view.unmount()
      controller.dispose()
    }
  })
})

describe('toolbar agent status popover', () => {
  it('reads the status again every 2 s while open and stops when it closes', async () => {
    vi.useFakeTimers()
    const { controller, getState, view } = renderControls(control())
    try {
      controller.summaryOpen.value = true
      await vi.advanceTimersByTimeAsync(0)
      expect(getState).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(getState).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(getState).toHaveBeenCalledTimes(3)

      controller.summaryOpen.value = false
      await vi.advanceTimersByTimeAsync(10_000)
      expect(getState).toHaveBeenCalledTimes(3)
    } finally {
      view.unmount()
      controller.dispose()
    }
  })

  it('does not start reading again when a read that was in flight finishes after it closed', async () => {
    vi.useFakeTimers()
    const { controller, getState, view } = renderControls(control())
    let finish!: (state: McpControlState) => void
    getState.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    try {
      controller.summaryOpen.value = true
      await vi.advanceTimersByTimeAsync(0)
      expect(getState).toHaveBeenCalledTimes(1)

      controller.summaryOpen.value = false
      await nextTick()
      finish(control())
      await vi.advanceTimersByTimeAsync(10_000)
      expect(getState).toHaveBeenCalledTimes(1)
    } finally {
      view.unmount()
      controller.dispose()
    }
  })

  it('stops reading when the toolbar goes away while open', async () => {
    vi.useFakeTimers()
    const { controller, getState, view } = renderControls(control())
    controller.summaryOpen.value = true
    await vi.advanceTimersByTimeAsync(0)
    expect(getState).toHaveBeenCalledTimes(1)

    view.unmount()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(getState).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it.each([
    ['no client yet', undefined, '—', 'home.readiness.nextAction.run_read_only_probe', 'home.readiness.nextAction.connect_client'],
    ['a verified probe', { initializedClientCount: 2, probe: 'probe_verified' as const }, '2', 'home.activity.done', 'home.readiness.nextAction.none'],
    ['a failed probe', { initializedClientCount: 1, probe: 'probe_failed' as const }, '1', 'home.activity.failed', 'home.readiness.nextAction.retry_read_only_probe'],
    ['a probe not run yet', { initializedClientCount: 1, probe: 'unknown' as const }, '1', 'home.readiness.nextAction.run_read_only_probe', 'home.readiness.nextAction.run_read_only_probe']
  ])('shows the readiness facts and the next step for %s', async (_name, readiness, clients, probeKey, nextKey) => {
    const { controller, view } = renderControls(control({ ...(readiness ? { readiness } : {}) }))
    try {
      controller.summaryOpen.value = true
      const summary = await screen.findByRole('region', { name: 'MCP readiness' })
      const fact = (label: string): string | null => within(summary).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent ?? null
      expect(fact('Local endpoint')).toBe(t('runtime.mcp.ready'))
      expect(fact('Client initialization')).toBe(clients)
      expect(fact('Read-only probe')).toBe(t(probeKey))
      expect(summary).toHaveTextContent(t(nextKey))
      expect(within(summary).getByText('http://127.0.0.1:47812/mcp', { selector: 'code' })).toBeInTheDocument()
    } finally {
      view.unmount()
      controller.dispose()
    }
  })

  it('says the status is unavailable and drops stale client facts when a read fails', async () => {
    const { controller, getState, view } = renderControls(control({ readiness: { initializedClientCount: 3, probe: 'probe_verified' } }))
    getState.mockRejectedValue(new Error('main unavailable'))
    try {
      controller.summaryOpen.value = true
      const summary = await screen.findByRole('region', { name: 'MCP readiness' })
      await vi.waitFor(() => expect(within(summary).getByRole('status')).toHaveTextContent('Status is unavailable. Last known activity is shown below.'))
      expect(within(summary).getByText('Client initialization', { selector: 'dt' }).nextElementSibling).toHaveTextContent('—')
    } finally {
      view.unmount()
      controller.dispose()
    }
  })

  it('tells a paused person what pausing does in the popover', async () => {
    const { controller, view } = renderControls(control({ status: 'paused', paused: true }))
    try {
      controller.summaryOpen.value = true
      const summary = await screen.findByRole('region', { name: 'MCP readiness' })
      expect(within(summary).getByText('Local endpoint', { selector: 'dt' }).nextElementSibling).toHaveTextContent(t('runtime.mcp.paused'))
      expect(summary).toHaveTextContent(t('runtime.mcp.pauseGuidance'))
    } finally {
      view.unmount()
      controller.dispose()
    }
  })
})
