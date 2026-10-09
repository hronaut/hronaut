import { describe, expect, it, vi } from 'vitest'
import { createPanelRequestBuffer } from '../src/preload/panel-requests.js'

describe('preload panel requests', () => {
  it('retains only the latest request until the renderer subscribes', () => {
    const requests = createPanelRequestBuffer()
    requests.receive('console')
    requests.receive('network')
    const listener = vi.fn()
    requests.subscribe(listener)
    expect(listener).toHaveBeenCalledExactlyOnceWith('network')
    const later = vi.fn()
    requests.subscribe(later)
    expect(later).not.toHaveBeenCalled()
  })

  it('delivers live requests in order to active subscriptions', () => {
    const requests = createPanelRequestBuffer()
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribe = requests.subscribe(first)
    requests.subscribe(second)
    requests.receive('console')
    unsubscribe()
    requests.receive('network')
    expect(first.mock.calls).toEqual([['console']])
    expect(second.mock.calls).toEqual([['console'], ['network']])
  })

  it('retains one newer request after all subscriptions are removed', () => {
    const requests = createPanelRequestBuffer()
    const listener = vi.fn()
    const unsubscribe = requests.subscribe(listener)
    unsubscribe()
    unsubscribe()
    requests.receive('console')
    requests.receive('network')
    expect(listener).not.toHaveBeenCalled()
    requests.subscribe(listener)
    expect(listener).toHaveBeenCalledExactlyOnceWith('network')
  })

  it('unsubscribes repeated registrations of the same callback independently', () => {
    const requests = createPanelRequestBuffer()
    const listener = vi.fn()
    const unsubscribe = requests.subscribe(listener)
    requests.subscribe(listener)
    requests.receive('console')
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    requests.receive('network')
    expect(listener.mock.calls).toEqual([['console'], ['console'], ['network']])
  })

  it('does not overwrite a request received during pending delivery', () => {
    const requests = createPanelRequestBuffer()
    requests.receive('console')
    const seen: string[] = []
    requests.subscribe(panel => {
      seen.push(panel)
      if (panel === 'console') requests.receive('network')
    })
    expect(seen).toEqual(['console', 'network'])
  })

  it('removes a subscription whose initial callback throws', () => {
    const requests = createPanelRequestBuffer()
    requests.receive('console')
    const failed = vi.fn(() => { throw new Error('Mount failed') })
    expect(() => requests.subscribe(failed)).toThrow('Mount failed')
    requests.receive('network')
    expect(failed).toHaveBeenCalledTimes(1)
    const recovered = vi.fn()
    requests.subscribe(recovered)
    expect(recovered).toHaveBeenCalledExactlyOnceWith('network')
  })
})
