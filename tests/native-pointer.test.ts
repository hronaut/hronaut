import { describe, expect, it, vi } from 'vitest'
import { dispatchNativeDrag, type PointerDebugger } from '../src/main/browser/native-pointer.js'

function debuggerHarness(failAt?: number, releaseFailure?: Error) {
  let call = 0
  const sendCommand = vi.fn(async (_method: string, params?: Record<string, unknown>) => {
    call += 1
    if (call === failAt) throw new Error(`pointer event ${call} failed`)
    if (params?.type === 'mouseReleased' && releaseFailure) throw releaseFailure
  })
  return { sendCommand, debuggerApi: { sendCommand } as PointerDebugger }
}

describe('native pointer drag', () => {
  it('dispatches a pressed drag sequence and a final release', async () => {
    const { sendCommand, debuggerApi } = debuggerHarness()

    await dispatchNativeDrag(debuggerApi, { x: 10, y: 20 }, { x: 90, y: 60 })

    expect(sendCommand).toHaveBeenCalledTimes(11)
    expect(sendCommand.mock.calls.map(([, params]) => params?.type)).toEqual([
      'mouseMoved',
      'mousePressed',
      'mouseMoved',
      'mouseMoved',
      'mouseMoved',
      'mouseMoved',
      'mouseMoved',
      'mouseMoved',
      'mouseMoved',
      'mouseMoved',
      'mouseReleased'
    ])
  })

  it('releases the pressed mouse button when an intermediate move fails', async () => {
    const { sendCommand, debuggerApi } = debuggerHarness(5)

    await expect(dispatchNativeDrag(debuggerApi, { x: 10, y: 20 }, { x: 90, y: 60 }))
      .rejects.toThrow('pointer event 5 failed')

    expect(sendCommand.mock.calls.at(-1)?.[1]).toMatchObject({
      type: 'mouseReleased',
      x: 90,
      y: 60,
      button: 'left',
      buttons: 0
    })
  })

  it('preserves the original drag failure if the defensive release also fails', async () => {
    const { debuggerApi } = debuggerHarness(5, new Error('release failed'))

    await expect(dispatchNativeDrag(debuggerApi, { x: 10, y: 20 }, { x: 90, y: 60 }))
      .rejects.toThrow('pointer event 5 failed')
  })

  it('reports a final release failure after an otherwise successful drag', async () => {
    const { debuggerApi } = debuggerHarness(undefined, new Error('release failed'))

    await expect(dispatchNativeDrag(debuggerApi, { x: 10, y: 20 }, { x: 90, y: 60 }))
      .rejects.toThrow('release failed')
  })
})
