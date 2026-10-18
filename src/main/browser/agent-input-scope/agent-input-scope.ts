import { webContents as electronWebContents, type WebContents } from 'electron'
import { clearRendererAgentInputFlag, NativeInputCleanupError } from '../native-input-cleanup.js'
import type { AgentInputScopeAccess } from './agent-input-scope-access.js'
import { beginAgentFocusIsolation, restoreHumanFocusAfterAgentInput } from './focus-isolation.js'

/**
 * Runs an agent's input to a page. The outermost run isolates window focus,
 * remembers where the person's focus was and marks the page's renderer as
 * receiving agent input (unless deferred); nested runs only count. When the
 * outermost run ends it clears the renderer flag, restores the native input
 * guard of a locked tab, puts the person's focus back and releases focus
 * isolation, reporting cleanup failures through onCleanupFailure.
 */
export async function withAgentInput<Tab, T>(
  access: AgentInputScopeAccess<Tab>,
  webContents: WebContents,
  operation: () => Promise<T>,
  options: { deferRendererFlag?: boolean; onCleanupFailure?: () => void } = {}
): Promise<T> {
  const depth = (access.agentInputWebContents().get(webContents.id) ?? 0) + 1
  if (depth === 1) {
    const mainWindowFocused = access.window().isFocused()
    access.agentInputFocusGuardReleases().set(webContents.id, beginAgentFocusIsolation(access))
    access.agentInputFocusSnapshots().set(webContents.id, {
      mainWindowFocused,
      focusedWebContentsId: electronWebContents.getFocusedWebContents()?.id ?? null
    })
  }
  access.agentInputWebContents().set(webContents.id, depth)
  let nativeCleanupFailure: NativeInputCleanupError | undefined
  try {
    if (depth === 1 && !options.deferRendererFlag && !webContents.isDestroyed()) {
      await webContents.executeJavaScript('window.__hronautAgentInputActive = true', true).catch(() => undefined)
    }
    return await operation()
  } catch (error) {
    if (error instanceof NativeInputCleanupError) nativeCleanupFailure = error
    throw error
  } finally {
    try {
      const remaining = Math.max(0, (access.agentInputWebContents().get(webContents.id) ?? 1) - 1)
      if (remaining > 0) {
        access.agentInputWebContents().set(webContents.id, remaining)
      } else {
        access.agentInputWebContents().delete(webContents.id)
        const focusSnapshot = access.agentInputFocusSnapshots().get(webContents.id)
        access.agentInputFocusSnapshots().delete(webContents.id)
        try {
          if (!webContents.isDestroyed()) {
            await clearRendererAgentInputFlag(webContents, options.onCleanupFailure)
            const tabId = access.tabIdForWebContents(webContents.id)
            const tab = tabId ? access.findTab(tabId) : undefined
            if (!webContents.isDestroyed() && tab && access.isHumanInteractionLocked(tab)) {
              try {
                await access.syncHumanInteractionInputGuard(tab)
              } catch (error) {
                options.onCleanupFailure?.()
                // Preserve acknowledged input uncertainty, but otherwise keep
                // restoration failures visible after focus cleanup runs.
                if (!nativeCleanupFailure) throw error
              }
            }
          }
        } finally {
          try {
            restoreHumanFocusAfterAgentInput(access, webContents, focusSnapshot)
          } finally {
            const releaseFocusGuard = access.agentInputFocusGuardReleases().get(webContents.id)
            access.agentInputFocusGuardReleases().delete(webContents.id)
            releaseFocusGuard?.()
          }
        }
      }
    } catch (error) {
      options.onCleanupFailure?.()
      throw error
    }
  }
}
