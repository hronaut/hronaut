import { computed, getCurrentScope, onScopeDispose, watch, type Ref } from 'vue'
import { isHronautHomeUrl } from '../../../shared/home-url.js'
import { BROWSER_TAB_GROUP_COLOR_HEX, defaultTabGroupColor } from '../../../shared/tab-groups.js'
import type { BrowserState } from '../../../shared/types.js'

export const WORKSPACE_TINT_PROPERTY = '--workspace-tint'

interface WorkspaceShellTintOptions {
  state: Readonly<Ref<BrowserState>>
  settingsOpen: Readonly<Ref<boolean>>
  tabOrientation: Readonly<Ref<'vertical' | 'horizontal'>>
  detachedWindow: boolean
  root?: HTMLElement
}

/**
 * With the tab rail, the shell's surface takes a soft wash of the color of the
 * workspace whose page is in view. Home, Settings, a page outside any workspace
 * and the tab strip above the page leave it neutral. The stylesheet registers
 * the property, so a change crossfades.
 */
export function useWorkspaceShellTint(options: WorkspaceShellTintOptions) {
  const root = options.root ?? document.documentElement
  const tint = computed((): string | null => {
    if (options.detachedWindow || options.settingsOpen.value || options.tabOrientation.value !== 'vertical') return null
    const state = options.state.value
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId)
    const workspaceId = activeTab && !isHronautHomeUrl(activeTab.url) ? activeTab.mcpGroupId : undefined
    if (!workspaceId) return null
    const color = state.mcpTabGroups.find((workspace) => workspace.id === workspaceId)?.color ?? defaultTabGroupColor(workspaceId)
    return BROWSER_TAB_GROUP_COLOR_HEX[color]
  })
  const stop = watch(tint, (color) => {
    if (color) root.style.setProperty(WORKSPACE_TINT_PROPERTY, color)
    else root.style.removeProperty(WORKSPACE_TINT_PROPERTY)
  }, { immediate: true })

  function dispose(): void {
    stop()
    root.style.removeProperty(WORKSPACE_TINT_PROPERTY)
  }
  if (getCurrentScope()) onScopeDispose(dispose)

  return { tint, dispose }
}
