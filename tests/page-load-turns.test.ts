import { describe, expect, it } from 'vitest'
import { nextPageLoadTurn } from '../src/main/browser/new-tabs/page-load-turns.js'

describe('nextPageLoadTurn', () => {
  it('gives each caller its own turn of the event loop, in the order they asked', async () => {
    // Tabs opened together get their cookies back at once; what waits for the loop, as IPC does, runs between starts.
    const events: string[] = []
    const starts = [1, 2, 3].map((tab) => nextPageLoadTurn().then(() => {
      events.push(`start ${tab}`)
      setImmediate(() => events.push(`loop after ${tab}`))
    }))
    await Promise.all(starts)
    await new Promise((resolve) => setImmediate(resolve))
    expect(events).toEqual(['start 1', 'loop after 1', 'start 2', 'loop after 2', 'start 3', 'loop after 3'])
  })

  it('starts even a lone load only after what already waits for the loop', async () => {
    const events: string[] = []
    setImmediate(() => events.push('loop'))
    await nextPageLoadTurn()
    events.push('start')
    expect(events).toEqual(['loop', 'start'])
  })
})
