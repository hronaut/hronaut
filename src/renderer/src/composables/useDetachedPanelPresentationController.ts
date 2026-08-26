import { DETACHABLE_PANEL_IDS, type DetachablePanelId } from '../../../shared/types.js'

type Translate = (key: string, params?: Record<string, unknown>) => string

interface DetachedPanelPresentationOptions {
  search: string
  translate: Translate
  targetDocument: Document
}

const PANEL_LABEL_KEYS: Record<DetachablePanelId, string> = {
  'site-controls': 'panels.siteControls',
  'site-storage': 'panels.siteStorage',
  'page-tools': 'panels.pageTools',
  'responsive-preview': 'panels.responsivePreview',
  environment: 'panels.environment',
  accessibility: 'panels.accessibility',
  'quality-audit': 'panels.qualityAudit',
  performance: 'panels.performance',
  'design-overview': 'panels.designOverview',
  'page-metadata': 'panels.pageMetadata',
  security: 'panels.security',
  coverage: 'panels.coverage',
  'cpu-profile': 'panels.cpuProfile',
  memory: 'panels.memory',
  console: 'panels.console',
  network: 'panels.network',
  'debug-report': 'panels.debugReport',
  'repro-recorder': 'panels.reproRecorder',
  'dom-changes': 'panels.domChanges',
  'visual-compare': 'panels.visualCompare',
  issues: 'panels.issues',
  bookmarks: 'panels.bookmarks'
}

export function resolveDetachedPanelId(search: string): DetachablePanelId | null {
  const value = new URLSearchParams(search).get('hronautPanel')
  return value !== null && (DETACHABLE_PANEL_IDS as readonly string[]).includes(value)
    ? value as DetachablePanelId
    : null
}

export function useDetachedPanelPresentationController(options: DetachedPanelPresentationOptions) {
  const detachedPanelId = resolveDetachedPanelId(options.search)
  const isDetachedPanelWindow = detachedPanelId !== null

  function panelLabel(panel: DetachablePanelId): string {
    return options.translate(PANEL_LABEL_KEYS[panel])
  }

  function panelTitle(panel: DetachablePanelId): string {
    return options.translate('panels.title', { panel: panelLabel(panel) })
  }

  function setActivePanelTitle(panel: DetachablePanelId): void {
    if (isDetachedPanelWindow) options.targetDocument.title = panelTitle(panel)
  }

  if (detachedPanelId) {
    options.targetDocument.documentElement.dataset.panelWindow = 'true'
    setActivePanelTitle(detachedPanelId)
  }

  return {
    detachedPanelId,
    isDetachedPanelWindow,
    panelLabel,
    panelTitle,
    setActivePanelTitle
  }
}
