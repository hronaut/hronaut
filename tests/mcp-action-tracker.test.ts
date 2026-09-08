import { describe, expect, it, vi } from 'vitest'
import { McpActionTracker } from '../src/main/mcp/action-tracker.js'

describe('MCP action progress', () => {
  it('publishes every concurrent start and settlement, including rejected work', async () => {
    const counts: number[] = []
    const tracker = new McpActionTracker(count => counts.push(count))
    let finish!: () => void
    const first = tracker.run(() => new Promise<void>(resolve => { finish = resolve }))
    await expect(tracker.run(() => { throw new Error('synthetic failure') })).rejects.toThrow('synthetic failure')
    expect(counts).toEqual([1, 2, 1])
    expect(tracker.activeCount).toBe(1)
    finish()
    await first
    expect(counts).toEqual([1, 2, 1, 0])
  })

  it('does not let a failed progress observer prevent work or corrupt the count', async () => {
    const warning = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const tracker = new McpActionTracker(() => { throw new Error('private observer details') })
      await expect(tracker.run(() => 'done')).resolves.toBe('done')
      expect(tracker.activeCount).toBe(0)
      expect(warning).toHaveBeenCalledTimes(2)
      expect(JSON.stringify(warning.mock.calls)).not.toContain('private observer details')
    } finally { warning.mockRestore() }
  })
})
