import { boundedScreenshotSize } from '../../../shared/screenshot.js'
import type { AgentStepThumbnailImage } from '../../mcp/agent-presence.js'
import type { AgentStepThumbnailAccess, AgentStepThumbnailTab } from './agent-step-thumbnail-access.js'

/** The largest agent step thumbnail, in pixels and as JPEG bytes. */
const MAX_AGENT_STEP_THUMBNAIL_WIDTH = 320
const MAX_AGENT_STEP_THUMBNAIL_HEIGHT = 200
const MAX_AGENT_STEP_THUMBNAIL_BYTES = 48 * 1024

/**
 * A small picture of a tab after an agent's step, for the shell's "All steps". Only a tab already on screen in a
 * visible window is pictured, from the frame it shows, so this never shows, wakes or moves a page; 'later' while the
 * page loads or another capture of it runs. Memory only: never sent to agents, saved or reported.
 */
export async function captureAgentStepThumbnail<Tab extends AgentStepThumbnailTab>(access: AgentStepThumbnailAccess<Tab>, tabId: string, workspaceId: string): Promise<AgentStepThumbnailImage | 'later' | undefined> {
  const tab = access.findTab(tabId)
  // Only a tab of the step's own workspace, before and after the capture: another workspace's page never shows in it.
  const eligible = (): boolean => Boolean(tab)
    && access.tabBelongsToMcpGroup(workspaceId, tabId)
    && !access.isDestroyed()
    && !access.window().isDestroyed()
    && access.window().isVisible()
    && !access.window().isMinimized()
    && access.findTab(tabId) === tab
    && !tab!.webContents.isDestroyed()
    && !tab!.sleeping
    && !access.browserContentOccluded()
    && tab!.view.getVisible()
    && (tabId === access.activeTabId() || access.splitViewContains(tabId))
  if (!tab || !eligible()) return undefined
  if (tab.loading || access.nativePreviewCapture().isPending(tab.webContents)) return 'later'
  const navigationGeneration = tab.navigationGeneration
  let captured: Electron.NativeImage | undefined
  try {
    captured = await access.nativePreviewCapture().run(tab.webContents, () => tab.webContents.capturePage(), () => undefined, () => undefined)
  } catch {
    return undefined
  }
  if (!captured || captured.isEmpty() || !eligible() || tab.navigationGeneration !== navigationGeneration) return undefined
  const original = captured.getSize()
  const bounded = boundedScreenshotSize(original.width, original.height, MAX_AGENT_STEP_THUMBNAIL_WIDTH, MAX_AGENT_STEP_THUMBNAIL_HEIGHT)
  const image = bounded.width === original.width && bounded.height === original.height
    ? captured
    : captured.resize({ width: bounded.width, height: bounded.height, quality: 'good' })
  // A busy page compresses poorly; a lower quality keeps it within the cap, or it goes without.
  let jpeg = image.toJPEG(60)
  if (jpeg.length > MAX_AGENT_STEP_THUMBNAIL_BYTES) jpeg = image.toJPEG(40)
  if (jpeg.length > MAX_AGENT_STEP_THUMBNAIL_BYTES) return undefined
  const size = image.getSize()
  return { jpeg, width: size.width, height: size.height }
}
