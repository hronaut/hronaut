import type { InteractionLockAccess, InteractionLockTab } from './interaction-lock-access.js'

// A copy of the tab manager's own check, which its native selections keep using.
function nativeSelectionContextUnavailable(error: unknown): boolean {
  return /context.*destroyed|frame.*removed|navigat/i.test(String(error))
}

/** Page script that adds, or removes, a capturing listener cancelling wheel events in the frame. */
function humanInteractionWheelGuardScript(locked: boolean): string {
  return `(() => {
    const key = '__hronautHumanInteractionWheelGuard';
    const current = globalThis[key];
    if (typeof current === 'function') {
      globalThis.removeEventListener('wheel', current, true);
      delete globalThis[key];
    }
    if (!${JSON.stringify(locked)}) return;
    const guard = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    globalThis.addEventListener('wheel', guard, { capture: true, passive: false });
    globalThis[key] = guard;
  })()`
}

/** A frame of the DevTools frame tree, with its child frames. */
interface CdpFrameTreeNode {
  frame: { id: string }
  childFrames?: CdpFrameTreeNode[]
}

/** The ids of the frame and every frame below it. */
function cdpFrameIds(node: CdpFrameTreeNode): string[] {
  return [node.frame.id, ...(node.childFrames ?? []).flatMap(cdpFrameIds)]
}

/**
 * Makes the page ignore the person's native input while their interaction
 * with it is locked and no trusted native selection runs on it, and adds a
 * wheel guard to every frame as a fallback; otherwise lifts both. A page or
 * manager that went away meanwhile is left alone.
 */
export async function syncHumanInteractionInputGuard<Tab extends InteractionLockTab>(access: InteractionLockAccess<Tab>, tab: Tab): Promise<void> {
  if (access.isDestroyed() || tab.webContents.isDestroyed() || access.findTab(tab.id) !== tab) return
  try {
    await access.withDebugger(tab.webContents, async () => {
      const trustedSelectionActive = access.screenshotAreaSessions().has(tab.webContents.id)
        || access.elementPickerSessions().has(tab.webContents.id)
      const locked = access.isHumanInteractionLocked(tab)
        && !trustedSelectionActive
      // Chromium's compositor can apply physical wheel/trackpad scrolling
      // before DOM or Electron cancellation runs. This is the authoritative
      // native-input barrier; the isolated-world wheel listener below remains
      // a fallback for programmatic paths that bypass compositor input.
      await tab.webContents.debugger.sendCommand('Input.setIgnoreInputEvents', { ignore: locked })
      const result = await tab.webContents.debugger.sendCommand('Page.getFrameTree') as {
        frameTree: CdpFrameTreeNode
      }
      const expression = humanInteractionWheelGuardScript(locked)
      await Promise.all(cdpFrameIds(result.frameTree).map(async (frameId) => {
        const isolatedWorld = await tab.webContents.debugger.sendCommand('Page.createIsolatedWorld', {
          frameId,
          worldName: 'hronaut-human-interaction-guard',
          grantUniveralAccess: false
        }) as { executionContextId: number }
        await tab.webContents.debugger.sendCommand('Runtime.evaluate', {
          expression,
          contextId: isolatedWorld.executionContextId,
          returnByValue: true
        })
      }))
    })
  } catch (error) {
    if (
      access.isDestroyed()
      || tab.webContents.isDestroyed()
      || access.findTab(tab.id) !== tab
      || nativeSelectionContextUnavailable(error)
    ) return
    throw error
  }
}
