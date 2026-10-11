/** Raw input was acknowledged, but restoring the native input barrier failed. */
export class NativeInputCleanupError extends Error {
  constructor(cause: unknown) {
    super('Native input was dispatched but input-lock cleanup failed. Effects are not rolled back.', { cause })
    this.name = 'NativeInputCleanupError'
  }
}

/** Only a matching release; never replay text, movement or a fresh down event. */
export function matchingNativeInputRelease(
  method: string,
  params: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed') {
    return {
      type: 'mouseReleased', x: params.x, y: params.y, button: params.button,
      buttons: 0, clickCount: params.clickCount ?? 1,
      ...(params.modifiers === undefined ? {} : { modifiers: params.modifiers })
    }
  }
  if (method === 'Input.dispatchKeyEvent' && (params.type === 'keyDown' || params.type === 'rawKeyDown')) {
    const release: Record<string, unknown> = { type: 'keyUp' }
    for (const key of ['key', 'code', 'modifiers', 'windowsVirtualKeyCode', 'nativeVirtualKeyCode', 'location', 'isKeypad']) {
      if (params[key] !== undefined) release[key] = params[key]
    }
    return release
  }
  return undefined
}
