import { ref } from 'vue'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import McpStatusControls from '../../src/renderer/src/components/McpStatusControls.vue'
import { useMcpStatusController } from '../../src/renderer/src/composables/useMcpStatusController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { HronautMcpApi, McpControlState } from '../../src/shared/types.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}

function control(overrides: Partial<McpControlState> = {}): McpControlState {
  return { status: 'ready', paused: false, ...overrides }
}

function renderControls(initial = control(), moveToSuggestedPort: HronautMcpApi['moveToSuggestedPort'] = vi.fn(async (port: number) => ({ result: { outcome: 'moved' as const, port }, state: control() }))) {
  const setPaused = vi.fn(async (paused: boolean) => control({ status: paused ? 'paused' : 'ready', paused }))
  const api: HronautMcpApi = {
    getState: vi.fn(async () => initial),
    setPaused,
    moveToSuggestedPort,
    onChanged: vi.fn(() => () => undefined)
  }
  const copyText = vi.fn(async () => true)
  const controller = useMcpStatusController({
    api,
    endpoint: ref('http://127.0.0.1:47812/mcp'),
    copyText,
    onPauseError: vi.fn()
  })
  controller.accept(initial)
  render(McpStatusControls, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { controller }
  })
  return { controller, copyText, setPaused, moveToSuggestedPort }
}

describe('McpStatusControls', () => {
  it('says another app has the port and moves to the free one it offers, or says it was taken', async () => {
    const failed = control({ status: 'error', error: 'listen EADDRINUSE: address already in use 127.0.0.1:47812', errorCode: 'port-in-use', failedPort: 47812, suggestedPort: 47813 })
    // Main found 47813 taken meanwhile and offers 47814 in the state it returns.
    const move = vi.fn(async (port: number) => ({ result: { outcome: 'taken' as const, port }, state: { ...failed, suggestedPort: 47814 } }))
    const { controller } = renderControls(failed, move)
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', { name: 'Agents can’t connect' })
    expect(trigger).toHaveAttribute('data-tooltip', 'Another app is using port 47812, so agents can\'t connect.')
    await user.click(trigger)
    expect(screen.getByRole('alert')).toHaveTextContent('Another app is using port 47812')
    await user.click(screen.getByRole('button', { name: 'Use port 47813' }))
    expect(move).toHaveBeenCalledWith(47813)
    await vi.waitFor(() => expect(screen.getByText('Port 47813 was taken in the meantime.')).toBeVisible())
    expect(screen.getByRole('button', { name: 'Use port 47814' })).toBeVisible()
    controller.accept({ ...failed, suggestedPort: undefined })
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: /Use port/ })).toBeNull())
    expect(screen.getByRole('alert')).toHaveTextContent('Choose another port in Settings → MCP security.')
    controller.accept(control({ status: 'error', error: 'boom', errorCode: 'other', failedPort: 47812 }))
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    controller.dispose()
  })

  it('moves to the offered port and puts focus on copying the new address', async () => {
    const failed = control({ status: 'error', errorCode: 'port-in-use', failedPort: 47812, suggestedPort: 47813 })
    const move = vi.fn(async (port: number) => ({ result: { outcome: 'moved' as const, port }, state: control() }))
    const { controller } = renderControls(failed, move)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Agents can’t connect' }))
    await user.click(screen.getByRole('button', { name: 'Use port 47813' }))
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByRole('button', { name: 'Copy URL' })).toHaveFocus()
    controller.dispose()
  })

  it('says a move that failed for another reason, without calling the port taken', async () => {
    const failed = control({ status: 'error', errorCode: 'port-in-use', failedPort: 47812, suggestedPort: 47813 })
    const move = vi.fn(async (port: number) => ({ result: { outcome: 'failed' as const, port }, state: failed }))
    const { controller } = renderControls(failed, move)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Agents can’t connect' }))
    await user.click(screen.getByRole('button', { name: 'Use port 47813' }))
    await vi.waitFor(() => expect(screen.getByText('Hronaut couldn\'t switch to port 47813. Choose another port in Settings → MCP security.')).toBeVisible())
    expect(screen.queryByText(/was taken/u)).toBeNull()
    controller.dispose()
  })

  it('distinguishes blocked admission from commands still settling and updates on completion', async () => {
    const { controller } = renderControls(control({ status: 'paused', paused: true, activeCommands: 2 }))
    expect(screen.getByRole('button', { name: 'Agents paused · 2 settling' })).toHaveAttribute('data-tooltip', expect.stringContaining('Pause does not undo'))
    const resume = screen.getByRole('button', { name: 'Resume agents' })
    expect(resume).toHaveAttribute('data-tooltip', expect.stringContaining('2 settling'))
    expect(resume).toHaveAttribute('aria-description', expect.stringContaining('2 settling'))
    controller.accept(control({ status: 'paused', paused: true, activeCommands: 0 }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Agents paused' })).toBeVisible())
    expect(screen.getByRole('button', { name: 'Resume agents' })).toHaveAttribute('data-tooltip', expect.stringContaining('fresh snapshot'))
    controller.dispose()
  })

  it('renders ready state and pauses agents through an accessible control', async () => {
    const { controller, setPaused } = renderControls()
    const user = userEvent.setup()

    expect(screen.getByRole('button', { name: /Ready for agents/ })).toHaveAttribute('data-tooltip', 'MCP: http://127.0.0.1:47812/mcp')
    const pause = screen.getByRole('button', { name: 'Pause agents' })
    await user.click(pause)

    expect(setPaused).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: 'Resume agents' })).toHaveAttribute('aria-pressed', 'true')
    controller.dispose()
  })

  it('names a connected agent, then says when it is working or needs you, in the same words as Home', async () => {
    const { controller } = renderControls(control({ agents: [{ key: 'a', name: 'Claude Code', state: 'idle' }] }))
    expect(screen.getByRole('button', { name: 'Claude Code connected' })).toBeVisible()
    controller.accept(control({ agents: [{ key: 'a', name: 'Claude Code', state: 'working' }, { key: 'b', name: 'Codex', state: 'working' }] }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: '2 agents working' })).toBeVisible())
    controller.accept(control({ agents: [{ key: 'a', name: 'Claude Code', state: 'needs-you' }] }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Needs you' })).toBeVisible())
    expect(screen.getByRole('button', { name: 'Needs you' }).closest('.mcp-controls')).toHaveClass('needs-you')
    controller.dispose()
  })

  it('disables pause controls while a mutation is pending', async () => {
    const pausing = deferred<McpControlState>()
    const { controller, setPaused } = renderControls()
    setPaused.mockImplementationOnce(() => pausing.promise)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Pause agents' }))

    const waiting = screen.getByRole('button', { name: 'Waiting…: Pause agents' })
    expect(waiting).toBeDisabled()
    expect(waiting).toHaveAttribute('aria-busy', 'true')
    expect(waiting.querySelector('.state-spinner')).not.toBeNull()
    pausing.resolve(control({ status: 'paused', paused: true }))
    await vi.waitFor(() => expect(controller.pauseBusy.value).toBe(false))
    expect(screen.getByRole('button', { name: 'Resume agents' })).toHaveAttribute('aria-busy', 'false')
    expect(waiting.querySelector('.state-spinner')).toBeNull()
    controller.dispose()
  })

  it('shows the error reason and keeps pause unavailable when the listener failed', () => {
    const { controller } = renderControls(control({ status: 'error', error: 'port in use' }))

    expect(screen.getByRole('button', { name: 'Agents can’t connect' })).toHaveAttribute('data-tooltip', 'MCP failed: port in use')
    expect(screen.getByRole('button', { name: 'Pause agents' })).toBeDisabled()
    controller.dispose()
  })

  it('opens readiness without copying and exposes Copy URL as an explicit secondary action', async () => {
    const { controller, copyText } = renderControls()

    await userEvent.setup().click(screen.getByRole('button', { name: /Ready for agents/ }))
    expect(copyText).not.toHaveBeenCalled()
    expect(screen.getByText('Client initialization')).toBeVisible()
    expect(screen.getByText('Read-only probe')).toBeVisible()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy URL' }))
    expect(copyText).toHaveBeenCalledWith('http://127.0.0.1:47812/mcp', expect.any(Function))
    expect(screen.getAllByRole('button', { name: /MCP URL copied/ })).toHaveLength(1)
    await userEvent.setup().keyboard('{Escape}')
    expect(screen.getByRole('button', { name: /Ready for agents/ })).toHaveFocus()
    controller.dispose()
  })
})
