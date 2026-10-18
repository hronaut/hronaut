import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access as accessFile, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { WebContents } from 'electron'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import type { PointerDebugger } from '../native-pointer.js'
import type { AgentPointerIdentity } from '../page-scripts.js'
import type { FileDropAccess, FileDropTab } from './file-drop-access.js'
import {
  fileDropDisposeScript,
  fileDropLocateScript,
  fileDropObserveScript,
  type FileDropLocation,
  type FileDropObservation,
  type FileDropTargetProblem
} from './file-drop-scripts.js'

const FILE_DROP_WORLD_ID = ISOLATED_WORLDS.fileDrop

/** Copy, link and move: the operations a file manager offers when a person drags files out of it. */
const FILE_MANAGER_DRAG_OPERATIONS = 1 | 2 | 16

/** How many drag updates a drop sends before it treats the target as not accepting the files. */
const MAX_DRAG_UPDATES = 4

/** How long one page script may take before the drop gives up on an unresponsive page. */
const PAGE_SCRIPT_TIMEOUT_MS = 5_000

/** How a file drop ended. Neither status proves that the page read or uploaded the files. */
export type FileDropStatus = 'DROPPED' | 'NOT_ACCEPTED' | 'DROP_UNCONFIRMED'

export interface FileDropResult {
  status: FileDropStatus
  files: number
  /** Whether the page's drop handler called preventDefault(), as drop zones do when they take the files; only when a drop event was seen. */
  pageHandledDrop?: boolean
  note: string
}

const TARGET_PROBLEMS: Record<FileDropTargetProblem, string> = {
  'invalid-selector': 'The selector is not valid CSS.',
  'not-found': 'Drop target not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.',
  ambiguous: 'The selector matches more than one element; use a ref or a selector that matches only the drop target.',
  frame: 'Dropping files into a frame is not supported; target an element of the top-level page.',
  hidden: 'The drop target is hidden or has no size.',
  outside: 'The center of the drop target cannot be scrolled into the viewport.',
  covered: 'Another element covers the center of the drop target, so a drop there would reach that element instead.',
  replaced: 'The drop target changed before the drop; take a fresh browser_snapshot and try again.'
}

/**
 * Drops local files onto one element of the tab's page as if a person dragged
 * them in from the file manager: Chromium's native drag input gives the page
 * trusted dragenter and dragover events carrying the files, and the drop only
 * when the page accepted the dragover. Otherwise, and whenever the drag stops
 * before its drop, the drag is moved off the page and released there, which
 * gives the page a dragleave and drops nothing. Every path must be an absolute
 * path to a readable file, each named once. Results and errors carry the
 * number of files, never their paths or contents. It throws when the page, the
 * tab, its workspace's authority or its observation context changed before
 * the drop, and does not roll back an earlier effect.
 */
export async function dropFiles<Tab extends FileDropTab>(
  access: FileDropAccess<Tab>,
  target: { tabId?: string; ref?: string; selector?: string },
  paths: string[],
  validateDrop?: (validateContext: () => void) => void,
  agent?: AgentPointerIdentity
): Promise<FileDropResult> {
  access.validateTarget(target)
  await assertDroppableFiles(paths)
  const tab = access.getTab(target.tabId)
  const webContents = tab.webContents
  const authority = access.nativeInputAuthority(tab, validateDrop)
  const token = randomUUID()
  const files = paths.length
  try {
    authority.validate()
    const prepared = droppablePoint(await runPageScript<FileDropLocation>(webContents, fileDropLocateScript(target, token, true)))
    await access.showAgentPointer(webContents, prepared, 'move', { agent })
    return await access.withAgentInput(webContents, () => access.withDebugger(webContents, async (): Promise<FileDropResult> => {
      const input = access.agentInputDebugger(webContents, authority.validate)
      // Measure again inside the debugger turn: the page may have moved or replaced the target meanwhile.
      const point = droppablePoint(await runPageScript<FileDropLocation>(webContents, fileDropLocateScript(target, token, false)))
      const data = { items: [], files: [...paths], dragOperationsMask: FILE_MANAGER_DRAG_OPERATIONS }
      let entered = false
      let dropAcknowledged = false
      try {
        authority.validate()
        // Counted from the attempt: a rejected command may still have reached the page.
        entered = true
        await input.sendCommand('Input.dispatchDragEvent', { type: 'dragEnter', ...point, data })
        let over = await observe(webContents, token, 'enter')
        // A person's drag sends updates while the pointer rests; keep updating while
        // each one only moved the drag onto a new element, such as an overlay.
        for (let update = 0; over.current && update < MAX_DRAG_UPDATES; update += 1) {
          await input.sendCommand('Input.dispatchDragEvent', { type: 'dragOver', ...point, data })
          over = await observe(webContents, token, 'over')
          if (over.dragOverArrived) break
        }
        if (!over.current) {
          authority.validate()
          throw new Error('The page stopped answering during the drag, so nothing was dropped')
        }
        if (!over.dragOverArrived || !over.dragOverAccepted) {
          return {
            status: 'NOT_ACCEPTED',
            files,
            note: 'The target did not accept the files: no dragover handler called preventDefault() where Hronaut could see it, so the drag left the page and nothing was dropped. For a file input, use browser_file_upload.'
          }
        }
        await input.sendCommand('Input.dispatchDragEvent', { type: 'drop', ...point, data })
        dropAcknowledged = true
        const dropped = await observe(webContents, token, 'drop')
        if (dropped.dropSeen) {
          return {
            status: 'DROPPED',
            files,
            pageHandledDrop: dropped.dropHandled,
            note: 'The page received the drop. This does not prove that it read or uploaded the files; check the page state, for example with browser_snapshot or browser_network_wait.'
          }
        }
        if (dropped.leftWithoutDrop) {
          return {
            status: 'NOT_ACCEPTED',
            files,
            note: 'The page accepted the files while they were dragged over it but refused the drop, for example by setting dropEffect to "none", so Chromium ended the drag without dropping anything.'
          }
        }
        return {
          status: 'DROP_UNCONFIRMED',
          files,
          note: 'The drop was sent, but neither a drop nor a dragleave was seen on the page: it may have navigated or stopped the events first. Check the page state before trying again; the files may have reached it.'
        }
      } finally {
        if (entered && !dropAcknowledged) await leavePage(access.agentInputDebugger(webContents))
      }
    }))
  } finally {
    authority.dispose()
    void runPageScript(webContents, fileDropDisposeScript(token)).catch(() => undefined)
  }
}

/**
 * Ends a drag that was not dropped, as a person does by dragging the files
 * back out of the window and letting go: Chromium gives the page a dragleave
 * and, with no element under the point, drops nothing. Chromium's own drag
 * cancel does not end a drag the page is a target of. It runs after the
 * drag's authority may have ended, so it carries no files.
 */
async function leavePage(debuggerApi: PointerDebugger): Promise<void> {
  const outside = { x: -100, y: -100, data: { items: [], dragOperationsMask: FILE_MANAGER_DRAG_OPERATIONS } }
  await debuggerApi.sendCommand('Input.dispatchDragEvent', { type: 'dragOver', ...outside }).catch(() => undefined)
  await debuggerApi.sendCommand('Input.dispatchDragEvent', { type: 'drop', ...outside }).catch(() => undefined)
}

/** Throws before anything reaches the page unless there are 1 to 20 distinct absolute paths to readable files; messages name a path by its position only. */
async function assertDroppableFiles(paths: string[]): Promise<void> {
  if (!paths.length || paths.length > 20) throw new Error('Provide between 1 and 20 file paths')
  if (new Set(paths).size !== paths.length) throw new Error('Name each file path only once')
  for (const [index, path] of paths.entries()) {
    const position = `File path ${index + 1}`
    if (!isAbsolute(path)) throw new Error(`${position} must be absolute`)
    const isFile = await stat(path).then(file => file.isFile(), () => undefined)
    if (isFile === false) throw new Error(`${position} is not a file`)
    if (!isFile || !await accessFile(path, constants.R_OK).then(() => true, () => false)) throw new Error(`${position} cannot be read`)
  }
}

function droppablePoint(location: FileDropLocation): { x: number; y: number } {
  if ('problem' in location) throw new Error(TARGET_PROBLEMS[location.problem])
  return location
}

async function observe(webContents: WebContents, token: string, phase: 'enter' | 'over' | 'drop'): Promise<FileDropObservation> {
  try {
    return await runPageScript<FileDropObservation>(webContents, fileDropObserveScript(token, phase))
  } catch {
    // A page that navigated or stopped answering shows nothing.
    return { current: false, dragOverArrived: false, dragOverAccepted: false, dropSeen: false, dropHandled: false, leftWithoutDrop: false }
  }
}

async function runPageScript<T>(webContents: WebContents, code: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      webContents.executeJavaScriptInIsolatedWorld(FILE_DROP_WORLD_ID, [{ code }], false) as Promise<T>,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('The page did not respond in time; nothing more was sent to it')), PAGE_SCRIPT_TIMEOUT_MS)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
