interface TrayActivationTarget {
  on(event: 'click' | 'right-click' | 'double-click', listener: () => void): unknown
  popUpContextMenu(): void
}

export function bindTrayActivation(tray: TrayActivationTarget, showWindow: () => void, platform: NodeJS.Platform): void {
  // Linux StatusNotifier hosts may ignore a requested menu during Activate.
  // Restore directly there, while retaining the native right-click menu.
  tray.on('click', platform === 'linux' ? showWindow : () => tray.popUpContextMenu())
  tray.on('right-click', () => tray.popUpContextMenu())
  if (platform !== 'linux') tray.on('double-click', showWindow)
}
