/** Requires exactly one of an element reference or a selector. */
export function validateTarget(target: { ref?: string; selector?: string }): void {
  if (!target.ref && !target.selector) throw new Error('Provide ref or selector')
  if (target.ref && target.selector) throw new Error('Provide either ref or selector, not both')
}

/**
 * The viewport point of a coordinate click or hover, or undefined after
 * checking the element target when no coordinate was given. Coordinates must
 * come as a finite, non-negative pair, without an element target.
 */
export function coordinatePointOrValidateTarget(
  target: { ref?: string; selector?: string; x?: number; y?: number },
  action: 'click' | 'hover'
): { x: number; y: number } | undefined {
  const hasCoordinates = target.x !== undefined || target.y !== undefined
  if (!hasCoordinates) {
    validateTarget(target)
    return undefined
  }
  if (target.x === undefined || target.y === undefined) {
    throw new TypeError(`Provide both x and y for a coordinate ${action}`)
  }
  if (target.ref || target.selector) throw new TypeError('Provide a target or coordinates, not both')
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || target.x < 0 || target.y < 0) {
    throw new TypeError(`${action === 'click' ? 'Click' : 'Hover'} coordinates must be finite non-negative numbers`)
  }
  return { x: target.x, y: target.y }
}

/**
 * The start and end viewport points of a coordinate drag, or undefined after
 * checking both element targets when no coordinate was given. All four
 * coordinates must be given, finite and non-negative, without element
 * targets.
 */
export function coordinateDragPointsOrValidateTargets(
  options: {
    sourceRef?: string
    sourceSelector?: string
    targetRef?: string
    targetSelector?: string
    startX?: number
    startY?: number
    endX?: number
    endY?: number
  },
  source: { ref?: string; selector?: string },
  target: { ref?: string; selector?: string }
): { from: { x: number; y: number }; to: { x: number; y: number } } | undefined {
  const coordinates = [options.startX, options.startY, options.endX, options.endY]
  const hasCoordinates = coordinates.some((value) => value !== undefined)
  if (!hasCoordinates) {
    validateTarget(source)
    validateTarget(target)
    return undefined
  }
  if (source.ref || source.selector || target.ref || target.selector) {
    throw new TypeError('Provide element targets or drag coordinates, not both')
  }
  if (coordinates.some((value) => value === undefined)) {
    throw new TypeError('Provide all four drag coordinates: startX, startY, endX, and endY')
  }
  if (coordinates.some((value) => !Number.isFinite(value) || value! < 0)) {
    throw new TypeError('Drag coordinates must be finite non-negative numbers')
  }
  return {
    from: { x: options.startX!, y: options.startY! },
    to: { x: options.endX!, y: options.endY! }
  }
}
