import type { MenuItemConstructorOptions } from 'electron'
import type { ReactInspectionResult } from '../../shared/react-inspection.js'

export interface ReactInspectionMenuLabels {
  title: string; enable: string; disabled: string; reloadRequired: string; installed: string; residue: string
}
export function reactInspectionMenu(
  state: ReactInspectionResult, labels: ReactInspectionMenuLabels,
  activate: (enabled: boolean) => void, available: boolean
): MenuItemConstructorOptions {
  return {
    id: 'react-inspection', label: labels.title, enabled: available,
    submenu: [
      { id: 'react-inspection-enabled', label: labels.enable, type: 'checkbox', checked: state.enabled, click: () => activate(!state.enabled) },
      { id: 'react-inspection-status', enabled: false, label: state.status === 'disabled-reload-required'
        ? labels.residue : !state.enabled ? labels.disabled : state.reloadRequired ? labels.reloadRequired : labels.installed }
    ]
  }
}
