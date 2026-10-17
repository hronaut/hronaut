// @vitest-environment jsdom
// Redesign QA for #875: Home's busy-port notice. What it says for a port in use, a refused port and no free port, the
// Use port button moving to the offered port, what Home says when that did not work, and an alert that is not
// rewritten on every refresh.
import { describe, expect, it, vi } from 'vitest'
import type { HomeDashboard } from '../src/shared/home.js'
import type { McpPortMoveResult } from '../src/shared/types.js'
import { baseDashboard, byId, deferred, flush, installHomeHooks, mountTestHome, words } from './qa-home-harness.js'

installHomeHooks()

const busy = (overrides: Partial<HomeDashboard> = {}): HomeDashboard => ({
  ...baseDashboard, status: 'error', startedAt: null, error: 'listen EADDRINUSE: address already in use 127.0.0.1:47812',
  errorCode: 'port-in-use', failedPort: 47812, suggestedPort: 47813, ...overrides
})
const notice = () => ({
  shown: !byId('mcp-port-problem').hidden,
  text: words(byId('mcp-port-problem-text')),
  button: byId<HTMLButtonElement>('mcp-port-use').hidden ? null : words(byId('mcp-port-use')),
  status: words(byId('mcp-port-status'))
})
const useButton = () => byId<HTMLButtonElement>('mcp-port-use')

describe('Busy-port notice text (#875)', () => {
  it.each<{ name: string; dashboard: HomeDashboard; text: string; button: string | null }>([
    {
      name: 'a port in use, with a free one',
      dashboard: busy(),
      text: "Another app is using port 47812, so agents can't connect. Hronaut can use a free port instead; then give your coding agent the new address.",
      button: 'Use port 47813'
    },
    {
      name: 'a refused port, with a free one',
      dashboard: busy({ errorCode: 'port-denied', failedPort: 80, suggestedPort: 1024, error: 'listen EACCES' }),
      text: "Your system doesn't let Hronaut use port 80, so agents can't connect. Hronaut can use a free port instead; then give your coding agent the new address.",
      button: 'Use port 1024'
    },
    {
      name: 'a port in use and no free port',
      dashboard: busy({ suggestedPort: undefined }),
      text: "Another app is using port 47812, so agents can't connect. Choose another port in Settings → MCP security.",
      button: null
    },
    {
      name: 'a refused port and no free port',
      dashboard: busy({ errorCode: 'port-denied', failedPort: 80, suggestedPort: undefined }),
      text: "Your system doesn't let Hronaut use port 80, so agents can't connect. Choose another port in Settings → MCP security.",
      button: null
    }
  ])('explains $name in plain words', async ({ dashboard, text, button }) => {
    mountTestHome({ dashboard })
    await flush()
    expect(notice()).toEqual({ shown: true, text, button, status: '' })
    expect(byId('mcp-port-problem').getAttribute('role')).toBe('alert')
    // The raw listen error stays under Details.
    expect(notice().text).not.toContain('EADDRINUSE')
  })

  it.each<{ name: string; dashboard: HomeDashboard }>([
    { name: 'a ready listener', dashboard: baseDashboard },
    { name: 'another startup failure', dashboard: busy({ errorCode: 'other', error: 'something else' }) },
    { name: 'a failure without its port', dashboard: busy({ failedPort: undefined }) },
    { name: 'a busy port reported while starting', dashboard: busy({ status: 'starting' }) }
  ])('stays hidden for $name', async ({ dashboard }) => {
    mountTestHome({ dashboard })
    await flush()
    expect(notice().shown).toBe(false)
  })

  it('goes away once the listener starts on the new port', async () => {
    const home = mountTestHome({ dashboard: busy() })
    await flush()
    expect(notice().shown).toBe(true)
    home.show({ ...baseDashboard, endpoint: 'http://127.0.0.1:47813/mcp' })
    expect(notice().shown).toBe(false)
  })
})

describe('Use port (#875)', () => {
  it('moves to the offered port once, and waits while the move is pending', async () => {
    const moved = deferred<McpPortMoveResult>()
    const useMcpPort = vi.fn().mockReturnValue(moved.promise)
    mountTestHome({ dashboard: busy(), api: { useMcpPort } })
    await flush()
    useButton().click()
    expect(useMcpPort).toHaveBeenCalledTimes(1)
    expect(useMcpPort).toHaveBeenCalledWith(47813)
    expect(useButton().disabled).toBe(true)
    useButton().click()
    expect(useMcpPort).toHaveBeenCalledTimes(1)
    moved.resolve({ outcome: 'moved', port: 47813 })
    await flush()
    expect(useButton().disabled).toBe(false)
    expect(notice().status).toBe('')
  })

  it('offers the port of the latest read', async () => {
    const useMcpPort = vi.fn().mockResolvedValue({ outcome: 'moved', port: 47815 })
    const home = mountTestHome({ dashboard: busy(), api: { useMcpPort } })
    await flush()
    home.show(busy({ suggestedPort: 47815 }))
    expect(notice().button).toBe('Use port 47815')
    useButton().click()
    expect(useMcpPort).toHaveBeenCalledWith(47815)
  })

  it.each<{ name: string; answer: McpPortMoveResult | Error; status: string }>([
    { name: 'taken in the meantime', answer: { outcome: 'taken', port: 47813 }, status: 'Port 47813 was taken in the meantime.' },
    { name: 'a failed move', answer: { outcome: 'failed', port: 47813 }, status: "Hronaut couldn't switch to port 47813. Choose another port in Settings → MCP security." },
    { name: 'a bridge error', answer: new Error('IPC failed'), status: "Hronaut couldn't switch to port 47813. Choose another port in Settings → MCP security." },
    { name: 'a port that is no longer the offer', answer: { outcome: 'not-offered' }, status: '' },
    { name: 'a move that worked', answer: { outcome: 'moved', port: 47813 }, status: '' }
  ])('says what happened after $name', async ({ answer, status }) => {
    const useMcpPort = answer instanceof Error ? vi.fn().mockRejectedValue(answer) : vi.fn().mockResolvedValue(answer)
    mountTestHome({ dashboard: busy(), api: { useMcpPort } })
    await flush()
    useButton().click()
    await flush()
    expect(notice().status).toBe(status)
    expect(useButton().disabled).toBe(false)
  })

  it('keeps saying the port was taken beside the next offer until the next try', async () => {
    const useMcpPort = vi.fn().mockResolvedValueOnce({ outcome: 'taken', port: 47813 }).mockReturnValueOnce(new Promise(() => {}))
    const home = mountTestHome({ dashboard: busy(), api: { useMcpPort } })
    await flush()
    useButton().click()
    await flush()
    home.show(busy({ suggestedPort: 47814 }))
    await vi.advanceTimersByTimeAsync(2000)
    expect(notice()).toMatchObject({ button: 'Use port 47814', status: 'Port 47813 was taken in the meantime.' })
    useButton().click()
    expect(useMcpPort).toHaveBeenLastCalledWith(47814)
    expect(notice().status).toBe('')
  })

  it('forgets a failed move once the problem is gone', async () => {
    const useMcpPort = vi.fn().mockResolvedValue({ outcome: 'failed', port: 47813 })
    const home = mountTestHome({ dashboard: busy(), api: { useMcpPort } })
    await flush()
    useButton().click()
    await flush()
    expect(notice().status).not.toBe('')
    home.show(baseDashboard)
    home.show(busy())
    expect(notice().status).toBe('')
  })

  it('does nothing without the bridge method', async () => {
    mountTestHome({ dashboard: busy() })
    await flush()
    expect(() => useButton().click()).not.toThrow()
    expect(useButton().disabled).toBe(false)
    expect(notice().status).toBe('')
  })
})

describe('Busy-port alert across refreshes (#875)', () => {
  it('does not rewrite unchanged text when Home reads its status again', async () => {
    const home = mountTestHome({ dashboard: busy() })
    await flush()
    const observer = new MutationObserver(() => {})
    for (const id of ['mcp-port-problem-text', 'mcp-port-use', 'mcp-port-status']) observer.observe(byId(id), { childList: true, characterData: true, subtree: true })
    home.show(busy())
    home.show(busy({ totalRequests: 3, error: 'listen EADDRINUSE again' }))
    await vi.advanceTimersByTimeAsync(4000)
    expect(observer.takeRecords()).toEqual([])
    home.show(busy({ suggestedPort: 47814 }))
    const changed = observer.takeRecords().map(record => (record.target as Element).id || (record.target.parentElement?.id ?? ''))
    observer.disconnect()
    expect(changed).toEqual(['mcp-port-use'])
  })

  it('does not rewrite an unchanged status line after a failed move', async () => {
    const home = mountTestHome({ dashboard: busy(), api: { useMcpPort: vi.fn().mockResolvedValue({ outcome: 'taken', port: 47813 }) } })
    await flush()
    useButton().click()
    await flush()
    const observer = new MutationObserver(() => {})
    observer.observe(byId('mcp-port-problem'), { childList: true, characterData: true, subtree: true })
    home.show(busy())
    await vi.advanceTimersByTimeAsync(2000)
    expect(observer.takeRecords()).toEqual([])
    observer.disconnect()
  })
})
