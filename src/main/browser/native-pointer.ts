export interface PointerDebugger {
  sendCommand: (method: string, commandParams?: Record<string, unknown>) => Promise<unknown>
}

export interface PointerPoint {
  x: number
  y: number
}

/**
 * Drags with the left button from one viewport point to another: a move, a
 * press, eight interpolated moves and a release. CDP modifier bits, when
 * given, ride on every one of those events; no key events are sent, so no
 * key can stay pressed.
 */
export async function dispatchNativeDrag(
  debuggerApi: PointerDebugger,
  from: PointerPoint,
  to: PointerPoint,
  releaseDebugger: PointerDebugger = debuggerApi,
  modifiers = 0
): Promise<void> {
  const modifierParams = modifiers ? { modifiers } : {}
  await debuggerApi.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: from.x,
    y: from.y,
    ...modifierParams
  })
  await debuggerApi.sendCommand('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1, ...modifierParams
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
        buttons: 1,
        ...modifierParams
      })
    }
  } catch (error) {
    dragFailed = true
    dragFailure = error
  }
  try {
    await releaseDebugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1, ...modifierParams
    })
  } catch (releaseFailure) {
    if (!dragFailed) throw releaseFailure
  }
  if (dragFailed) throw dragFailure
}
