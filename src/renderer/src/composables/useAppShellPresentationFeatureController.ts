import type { Ref } from 'vue'
import type { AppSettings, WindowChromeState } from '../../../shared/types.js'
import { useAppearancePresentationController } from './useAppearancePresentationController.js'
import { useDetachedPanelPresentationController } from './useDetachedPanelPresentationController.js'
import { usePanelDockPreferenceController } from './usePanelDockPreferenceController.js'
import { useTitleBarPresentationController } from './useTitleBarPresentationController.js'

type Translate = (key: string, params?: Record<string, unknown>) => string

export interface AppShellPresentationFeatureControllerOptions {
  settings: Ref<AppSettings>
  systemTheme: Ref<'light' | 'dark'>
  search: string
  translate: Translate
  targetDocument: Document
  windowChrome: WindowChromeState
}

export function useAppShellPresentationFeatureController(
  options: AppShellPresentationFeatureControllerOptions
) {
  const detachedPanel = useDetachedPanelPresentationController({
    search: options.search,
    translate: options.translate,
    targetDocument: options.targetDocument
  })
  const titleBar = useTitleBarPresentationController(options.windowChrome)
  const appearance = useAppearancePresentationController({
    settings: options.settings,
    systemTheme: options.systemTheme,
    detachedWindow: detachedPanel.isDetachedPanelWindow
  })
  const panelDock = usePanelDockPreferenceController({
    detachedWindow: detachedPanel.isDetachedPanelWindow
  })

  return {
    ...detachedPanel,
    ...titleBar,
    ...appearance,
    ...panelDock
  }
}

export type AppShellPresentationFeatureController = ReturnType<
  typeof useAppShellPresentationFeatureController
>
