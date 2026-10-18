export const PANEL_DOCKS = ['right', 'left', 'bottom', 'top', 'window'] as const
export type PanelDock = (typeof PANEL_DOCKS)[number]

export const DETACHABLE_PANEL_IDS = [
  'site-controls',
  'site-storage',
  'page-tools',
  'responsive-preview',
  'environment',
  'accessibility',
  'quality-audit',
  'performance',
  'design-overview',
  'page-metadata',
  'security',
  'coverage',
  'cpu-profile',
  'memory',
  'console',
  'network',
  'debug-report',
  'repro-recorder',
  'dom-changes',
  'visual-compare',
  'issues',
  'bookmarks'
] as const
export type DetachablePanelId = (typeof DETACHABLE_PANEL_IDS)[number]

export interface PanelRedockRequest {
  panel: DetachablePanelId
  dock: Exclude<PanelDock, 'window'>
}
