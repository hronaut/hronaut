export interface CompactHomeGeometry {
  width: number
  leftInset: number
  rightInset: number
}

// Runs in the renderer via page.evaluate. A resized viewport alone does not mean
// WindowControlsOverlay geometry has caught up. Preserve the native controls'
// measured insets across this same-display resize before capturing the baseline.
export function compactHomeControlPositions(expected: CompactHomeGeometry): Record<string, { x: number; y: number }> | undefined {
  const style = document.documentElement.style
  const read = (name: string): number => Number.parseFloat(style.getPropertyValue(name))
  if (
    window.innerWidth !== expected.width
    || read('--titlebar-controls-left-runtime') !== expected.leftInset
    || read('--titlebar-controls-right-runtime') !== expected.rightInset
    || read('--titlebar-area-width-runtime') !== expected.width - expected.leftInset - expected.rightInset
  ) return undefined

  const labels = ['Search tabs', 'Downloads', 'Browsing history', 'Settings']
  return Object.fromEntries(labels.map((label) => {
    const element = document.querySelector('.topbar-actions button[aria-label="' + label + '"]')
    if (!element) throw new Error('Missing global control: ' + label)
    const bounds = element.getBoundingClientRect()
    return [label, { x: Math.round(bounds.x), y: Math.round(bounds.y) }]
  }))
}
