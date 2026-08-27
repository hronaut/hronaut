export interface PointerDebugger {
  sendCommand: (method: string, commandParams?: Record<string, unknown>) => Promise<unknown>
}

export interface PointerPoint {
  x: number
  y: number
}

export async function dispatchNativeDrag(
  debuggerApi: PointerDebugger,
  from: PointerPoint,
  to: PointerPoint
): Promise<void> {
  await debuggerApi.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: from.x,
    y: from.y
  })
  await debuggerApi.sendCommand('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1
  })
  let dragFailed = false
  let dragFailure: unknown
  try {
    for (let step = 1; step <= 8; step += 1) {
      await debuggerApi.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: from.x + ((to.x - from.x) * step) / 8,
        y: from.y + ((to.y - from.y) * step) / 8,
        button: 'left',
        buttons: 1
      })
    }
  } catch (error) {
    dragFailed = true
    dragFailure = error
  }
  try {
    await debuggerApi.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1
    })
  } catch (releaseFailure) {
    if (!dragFailed) throw releaseFailure
  }
  if (dragFailed) throw dragFailure
}
