/** Observed topology only. Names and renderer metadata are untrusted page claims. */
export const REACT_INSPECTION_ACTIONS = ['enable', 'status', 'tree', 'disable'] as const
export type ReactInspectionAction = typeof REACT_INSPECTION_ACTIONS[number]
export type ReactInspectionStatus =
  | 'disabled' | 'reload-required' | 'installed-readiness-unchecked' | 'disabled-reload-required'
  | 'ready' | 'renderer-not-observed' | 'unsupported-renderer' | 'hook-conflict' | 'root-limit'
  | 'unavailable' | 'interrupted' | 'timed-out' | 'stale-observation'
export type ReactInspectionLimit = 'nodes' | 'depth' | 'visits' | 'bytes' | 'cycle' | 'time'
export interface ReactInspectionCommand { action: ReactInspectionAction; subtreeId?: string }
export interface ReactInspectionNode { id: string; parent: string | null; name: string }
export interface ReactInspectionResult {
  status: ReactInspectionStatus
  enabled: boolean
  reloadRequired: boolean
  navigationGeneration: number
  installationId?: string
  nodes: ReactInspectionNode[]
  partial: boolean
  limit?: ReactInspectionLimit
  visited: number
  coverage: 'observed-topology-only'
}
export interface ReactInspectionBootstrap { enabled: boolean; installationId?: string }
