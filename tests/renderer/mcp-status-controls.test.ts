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

function renderControls(initial = control()) {
  const setPaused = vi.fn(async (paused: boolean) => control({ status: paused ? 'paused' : 'ready', paused }))
  const api: HronautMcpApi = {
    getState: vi.fn(async () => initial),
    setPaused,
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
  return { controller, copyText, setPaused }
}

describe('McpStatusControls', () => {
  it('renders ready state and pauses agents through an accessible control', async () => {
    const { controller, setPaused } = renderControls()
    const user = userEvent.setup()

    expect(screen.getByRole('button', { name: /MCP ready/ })).toHaveAttribute('title', 'MCP: http://127.0.0.1:47812/mcp')
    const pause = screen.getByRole('button', { name: 'Pause agents' })
    await user.click(pause)

    expect(setPaused).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: 'Resume agents' })).toHaveAttribute('aria-pressed', 'true')
    controller.dispose()
  })

  it('disables pause controls while a mutation is pending', async () => {
    const pausing = deferred<McpControlState>()
    const { controller, setPaused } = renderControls()
    setPaused.mockImplementationOnce(() => pausing.promise)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Pause agents' }))

    expect(screen.getByRole('button', { name: 'Pause agents' })).toBeDisabled()
    pausing.resolve(control({ status: 'paused', paused: true }))
    await vi.waitFor(() => expect(controller.pauseBusy.value).toBe(false))
    controller.dispose()
  })

  it('shows the error reason and keeps pause unavailable when the listener failed', () => {
    const { controller } = renderControls(control({ status: 'error', error: 'port in use' }))

    expect(screen.getByRole('button', { name: 'MCP error' })).toHaveAttribute('title', 'MCP failed: port in use')
    expect(screen.getByRole('button', { name: 'Pause agents' })).toBeDisabled()
    controller.dispose()
  })

  it('reports successful endpoint copying in the pill', async () => {
    const { controller, copyText } = renderControls()

    await userEvent.setup().click(screen.getByRole('button', { name: /MCP ready/ }))

    expect(copyText).toHaveBeenCalledWith('http://127.0.0.1:47812/mcp')
    expect(screen.getByRole('button', { name: /MCP URL copied/ })).toBeVisible()
    controller.dispose()
  })
})
