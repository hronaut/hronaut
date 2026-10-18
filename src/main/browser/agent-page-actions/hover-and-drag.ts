import { dragPointsScript, targetPointScript, type AgentPointerIdentity } from '../page-scripts.js'
import { dispatchNativeDrag } from '../native-pointer.js'
import type { AgentPageActionsAccess, AgentPageActionsTab } from './agent-page-actions-access.js'

/** Moves the agent's pointer over a control or a point in the tab's page, through native input. */
export async function hover<Tab extends AgentPageActionsTab>(access: AgentPageActionsAccess<Tab>, target: {
  tabId?: string
  ref?: string
  selector?: string
  x?: number
  y?: number
}, validateInput?: (validateContext: () => void) => void, agent?: AgentPointerIdentity): Promise<unknown> {
  const coordinatePoint = access.coordinatePointOrValidateTarget(target, 'hover')
  const tab = access.getTab(target.tabId)
  const webContents = tab.webContents
  const authority = access.nativeInputAuthority(tab, validateInput)
  try {
    const point = coordinatePoint ?? await webContents.executeJavaScript(targetPointScript(target), true) as {
      x: number
      y: number
      tag: string
    }
    if (coordinatePoint) await access.assertPointInsideVisibleViewport(webContents, coordinatePoint, 'hover')
    await access.showAgentPointer(webContents, point, 'move', { agent })
    await access.withAgentInput(webContents, () => access.withDebugger(webContents, () =>
      access.agentInputDebugger(webContents, authority.validate).sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: point.x,
        y: point.y
      })
    ))
    authority.validate()
    return { ok: true, ...point }
  } finally { authority.dispose() }
}

/** Drags from one control or point to another in the tab's page, through native input. */
export async function drag<Tab extends AgentPageActionsTab>(access: AgentPageActionsAccess<Tab>, options: {
  tabId?: string
  sourceRef?: string
  sourceSelector?: string
  targetRef?: string
  targetSelector?: string
  startX?: number
  startY?: number
  endX?: number
  endY?: number
}, validateInput?: (validateContext: () => void) => void, agent?: AgentPointerIdentity): Promise<unknown> {
  const source = { ref: options.sourceRef, selector: options.sourceSelector }
  const target = { ref: options.targetRef, selector: options.targetSelector }
  const coordinatePoints = access.coordinateDragPointsOrValidateTargets(options, source, target)
  const tab = access.getTab(options.tabId)
  const webContents = tab.webContents
  const authority = access.nativeInputAuthority(tab, validateInput)
  try {
    const { from, to } = coordinatePoints
      ?? await webContents.executeJavaScript(dragPointsScript(source, target), true) as {
        from: { x: number; y: number; tag: string }
        to: { x: number; y: number; tag: string }
      }
    if (coordinatePoints) {
      await access.assertPointInsideVisibleViewport(webContents, from, 'drag')
      await access.assertPointInsideVisibleViewport(webContents, to, 'drag')
    }
    await access.showAgentPointer(webContents, from, 'drag-start', { agent })
    await access.withAgentInput(webContents, () => access.withDebugger(
      webContents,
      () => dispatchNativeDrag(access.agentInputDebugger(webContents, authority.validate), from, to, access.agentInputDebugger(webContents))
    ))
    authority.validate()
    await access.showAgentPointer(webContents, to, 'drag-end', { origin: from, agent })
    authority.validate()
    return { ok: true, from, to }
  } finally { authority.dispose() }
}
