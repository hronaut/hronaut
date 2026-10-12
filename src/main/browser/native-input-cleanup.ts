interface RendererInputCleanupTarget {
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): unknown
  removeListener(event: 'destroyed', listener: () => void): unknown
  executeJavaScript(script: string, userGesture: boolean): Promise<unknown>
}

/** A destroyed document no longer owns a renderer input flag. Electron may
 * leave its executeJavaScript promise pending when destruction races delivery.
 * This applies only to best-effort flag removal, never native input commands. */
export async function clearRendererAgentInputFlag(
  page: RendererInputCleanupTarget,
  onFailure?: () => void
): Promise<void> {
  if (page.isDestroyed()) return
  let onDestroyed!: () => void
  const destroyed = new Promise<void>(resolve => { onDestroyed = resolve })
  page.once('destroyed', onDestroyed)
  try {
    if (page.isDestroyed()) return
    await Promise.race([
      page.executeJavaScript('delete window.__hronautAgentInputActive', true).then(value => { if (value === false) onFailure?.() }, () => { onFailure?.() }),
      destroyed
    ])
  } catch {
    onFailure?.()
    // Flag removal was already best-effort, including synchronous destruction.
  } finally {
    page.removeListener('destroyed', onDestroyed)
  }
}

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
