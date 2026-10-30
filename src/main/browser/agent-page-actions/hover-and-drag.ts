import { dragPointsScript, targetPointScript, type AgentPointerIdentity } from '../page-scripts.js'
import { dispatchNativeDrag } from '../native-pointer.js'
import type { Browser } from '../browser.js'
import { agentInputDebugger } from '../agent-input-authorization/agent-input-authorization.js'
import { showAgentPointer } from '../agent-pointer/agent-pointer.js'
import { coordinateDragPointsOrValidateTargets, coordinatePointOrValidateTarget } from '../input-targets/input-targets.js'
import { assertPointInsideVisibleViewport } from '../input-targets/target-checks.js'
import { getTab } from '../browser-core.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { withAgentInput } from '../agent-input-scope/agent-input-scope.js'
import { nativeInputAuthority } from '../native-input-authority/native-input-authority.js'

/** Moves the agent's pointer over a control or a point in the tab's page, through native input. */
export async function hover(browser: Browser, target: {
  tabId?: string
  ref?: string
  selector?: string
  x?: number
  y?: number
}, validateInput?: (validateContext: () => void) => void, agent?: AgentPointerIdentity): Promise<unknown> {
  const coordinatePoint = coordinatePointOrValidateTarget(target, 'hover')
  const tab = getTab(browser, target.tabId)
  const webContents = tab.webContents
  const authority = nativeInputAuthority(browser, tab, validateInput)
  try {
    const point = coordinatePoint ?? await webContents.executeJavaScript(targetPointScript(target), false) as {
      x: number
      y: number
      tag: string
    }
    if (coordinatePoint) await assertPointInsideVisibleViewport(webContents, coordinatePoint, 'hover')
    await showAgentPointer(browser, webContents, point, 'move', { agent })
    await withAgentInput(browser, webContents, () => withDebugger(browser, webContents, () =>
      agentInputDebugger(browser, webContents, authority.validate).sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y
      })
    ))
    authority.validate()
    return { ok: true, ...point }
  } finally { authority.dispose() }
}

/** A key a drag can carry on its mouse events. ControlOrMeta is Meta on macOS and Control elsewhere. */
export type BrowserDragModifier = 'Shift' | 'Alt' | 'ControlOrMeta'

/** Drags from one control or point to another in the tab's page, through native input. */
export async function drag(browser: Browser, options: {
  tabId?: string
  sourceRef?: string
  sourceSelector?: string
  targetRef?: string
  targetSelector?: string
  startX?: number
  startY?: number
  endX?: number
  endY?: number
  modifiers?: readonly BrowserDragModifier[]
}, validateInput?: (validateContext: () => void) => void, agent?: AgentPointerIdentity): Promise<unknown> {
  const modifierBits = options.modifiers === undefined ? 0 : dragModifierBits(options.modifiers, process.platform)
  const source = { ref: options.sourceRef, selector: options.sourceSelector }
  const target = { ref: options.targetRef, selector: options.targetSelector }
  const coordinatePoints = coordinateDragPointsOrValidateTargets(options, source, target)
  const tab = getTab(browser, options.tabId)
  const webContents = tab.webContents
  const authority = nativeInputAuthority(browser, tab, validateInput)
  try {
    const { from, to } = coordinatePoints
      ?? await webContents.executeJavaScript(dragPointsScript(source, target), false) as {
        from: { x: number; y: number; tag: string }
        to: { x: number; y: number; tag: string }
      }
    if (coordinatePoints) {
      await assertPointInsideVisibleViewport(webContents, from, 'drag')
      await assertPointInsideVisibleViewport(webContents, to, 'drag')
    }
    await showAgentPointer(browser, webContents, from, 'drag-start', { agent })
    await withAgentInput(browser, webContents, () => withDebugger(
      browser,
      webContents,
      () => dispatchNativeDrag(agentInputDebugger(browser, webContents, authority.validate), from, to, agentInputDebugger(browser, webContents), modifierBits)
    ))
    authority.validate()
    await showAgentPointer(browser, webContents, to, 'drag-end', { origin: from, agent })
    authority.validate()
    return { ok: true, from, to, ...(options.modifiers ? { modifiers: [...options.modifiers] } : {}) }
  } finally { authority.dispose() }
}

const DRAG_MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 } as const

/** The CDP mouse event modifier bits for a drag's keys, each named once. */
function dragModifierBits(modifiers: readonly BrowserDragModifier[], platform: NodeJS.Platform): number {
  if (!modifiers.length || new Set(modifiers).size !== modifiers.length
    || modifiers.some(modifier => modifier !== 'Shift' && modifier !== 'Alt' && modifier !== 'ControlOrMeta')) {
    throw new TypeError('Drag modifiers must name one to three of Shift, Alt or ControlOrMeta, each once.')
  }
  return modifiers.reduce((bits, modifier) => bits
    | (modifier === 'ControlOrMeta' ? DRAG_MODIFIER_BITS[platform === 'darwin' ? 'Meta' : 'Control'] : DRAG_MODIFIER_BITS[modifier]), 0)
}
