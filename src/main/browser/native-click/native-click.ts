import type { WebContents } from 'electron'
import { sendAuthorizedAgentInputCommand } from '../agent-input-authorization/agent-input-authorization.js'
import type { Browser } from '../browser.js'
import type { NativeInputDispatchObserver } from '../native-key-hold.js'
import { ownedRightClickPress } from '../owned-right-click.js'

/**
 * Moves the mouse to the point and clicks there with authorized native input:
 * a left click, a double click, or an owned right click. The move and every
 * press are validated with validateClick, and sample runs just before each
 * raw press; releases skip validation, so a press that went out is always
 * released. Modifier bits, when given, ride on the left click's move, press
 * and release; no key events are sent, so nothing stays held afterwards.
 */
export async function dispatchNativeClick(
  browser: Browser,
  webContents: WebContents,
  point: { x: number; y: number },
  doubleClick: boolean,
  validateClick: () => void,
  sample?: (x: number, y: number) => Promise<void>,
  observer?: NativeInputDispatchObserver,
  rightClick = false,
  modifiers = 0
): Promise<void> {
  const inputDebugger = { sendCommand: (method: string, params: Record<string, unknown>) =>
    sendAuthorizedAgentInputCommand(browser, webContents, method, params, validateClick, observer,
      params.type === 'mousePressed' && sample ? () => sample(point.x, point.y) : undefined) }
  // After a successful press, its matching release must still run if authority
  // changes. Reject subsequent presses without leaving a held mouse button.
  const releaseDebugger = { sendCommand: (method: string, params: Record<string, unknown>) =>
    sendAuthorizedAgentInputCommand(browser, webContents, method, params, undefined, observer) }
  const modifierParams = modifiers ? { modifiers } : {}
  await inputDebugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
    ...modifierParams
  })
  if (rightClick) {
    await ownedRightClickPress(
      tracked => sendAuthorizedAgentInputCommand(browser, webContents, 'Input.dispatchMouseEvent', {
        type: 'mousePressed', x: point.x, y: point.y, button: 'right', buttons: 2, clickCount: 1
      }, validateClick, tracked, sample ? () => sample(point.x, point.y) : undefined),
      tracked => sendAuthorizedAgentInputCommand(browser, webContents, 'Input.dispatchMouseEvent', {
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
      clickCount,
      ...modifierParams
    })
    await releaseDebugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount,
      ...modifierParams
    })
  }
}
