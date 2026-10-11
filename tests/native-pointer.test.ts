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
  it('uses only the release channel after authority rejects a move following a successful press', async () => {
    const sendCommand = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('authority changed'))
    const release = vi.fn(async () => undefined)
    await expect(dispatchNativeDrag({ sendCommand }, { x: 10, y: 20 }, { x: 90, y: 60 }, { sendCommand: release }))
      .rejects.toThrow('authority changed')
    expect(sendCommand).toHaveBeenCalledTimes(3)
    expect(release).toHaveBeenCalledExactlyOnceWith('Input.dispatchMouseEvent', expect.objectContaining({ type: 'mouseReleased', button: 'left', buttons: 0 }))
  })

  it('does not dispatch a cleanup release when the initial press is rejected', async () => {
    const sendCommand = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('authority changed'))
    const release = vi.fn()
    await expect(dispatchNativeDrag({ sendCommand }, { x: 10, y: 20 }, { x: 90, y: 60 }, { sendCommand: release }))
      .rejects.toThrow('authority changed')
    expect(release).not.toHaveBeenCalled()
  })

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
