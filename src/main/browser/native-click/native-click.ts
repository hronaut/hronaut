import type { WebContents } from 'electron'
import type { NativeInputDispatchObserver } from '../native-key-hold.js'
import { ownedRightClickPress } from '../owned-right-click.js'
import type { NativeClickAccess } from './native-click-access.js'

/**
 * Moves the mouse to the point and clicks there with authorized native input:
 * a left click, a double click, or an owned right click. The move and every
 * press are validated with validateClick, and sample runs just before each
 * raw press; releases skip validation, so a press that went out is always
 * released.
 */
export async function dispatchNativeClick(
  access: NativeClickAccess,
  webContents: WebContents,
  point: { x: number; y: number },
  doubleClick: boolean,
  validateClick: () => void,
  sample?: (x: number, y: number) => Promise<void>,
  observer?: NativeInputDispatchObserver,
  rightClick = false
): Promise<void> {
  const inputDebugger = { sendCommand: (method: string, params: Record<string, unknown>) =>
    access.sendAuthorizedAgentInputCommand(webContents, method, params, validateClick, observer,
      params.type === 'mousePressed' && sample ? () => sample(point.x, point.y) : undefined) }
  // After a successful press, its matching release must still run if authority
  // changes. Reject subsequent presses without leaving a held mouse button.
  const releaseDebugger = { sendCommand: (method: string, params: Record<string, unknown>) =>
    access.sendAuthorizedAgentInputCommand(webContents, method, params, undefined, observer) }
  await inputDebugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y
  })
  if (rightClick) {
    await ownedRightClickPress(
      tracked => access.sendAuthorizedAgentInputCommand(webContents, 'Input.dispatchMouseEvent', {
        type: 'mousePressed', x: point.x, y: point.y, button: 'right', buttons: 2, clickCount: 1
      }, validateClick, tracked, sample ? () => sample(point.x, point.y) : undefined),
      tracked => access.sendAuthorizedAgentInputCommand(webContents, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: point.x, y: point.y, button: 'right', buttons: 0, clickCount: 1
      }, undefined, tracked),
      observer
    )
    return
  }
  for (const clickCount of doubleClick ? [1, 2] : [1]) {
    await inputDebugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount
    })
    await releaseDebugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount
    })
  }
}
