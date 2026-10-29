import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { withAgentInput } from '../agent-input-scope/agent-input-scope.js'
import type { Browser } from '../browser.js'
import { getTab } from '../browser-core.js'
import { validateTarget } from '../input-targets/input-targets.js'
import { nativeInputAuthority } from '../native-input-authority/native-input-authority.js'
import {
  textFileFillCheckScript,
  textFileFillScript,
  type TextFileFillCheck,
  type TextFileFillField,
  type TextFileFillPageResult,
  type TextFileFillTargetProblem
} from './text-file-fill-scripts.js'

const TEXT_FILE_FILL_WORLD_ID = ISOLATED_WORLDS.textFileFill

/** The largest file a fill reads, in bytes. */
export const MAX_FILL_FILE_BYTES = 64 * 1024

/** How long reading the file, or the page's check, may take before Hronaut gives up on it. */
const RESPONSE_TIMEOUT_MS = 5_000

/** The page must start the fill this soon after it is sent, or it writes nothing: well before Hronaut stops waiting. */
const FILL_START_DEADLINE_MS = 4_000

/** How long the page's fill, with its settle time, may take before Hronaut stops waiting for its answer. */
const FILL_ANSWER_TIMEOUT_MS = 8_000

/** How many files may be read at once, so reads stuck on an unresponsive mount cannot take up the main process's file I/O. */
const MAX_ACTIVE_READS = 2
let activeReads = 0

/** How a fill from a text file ended. None of them proves that the page accepted or saved the text. */
export type TextFileFillStatus = 'MATCHED' | 'MISMATCH' | 'UNCONFIRMED'

export interface TextFileFillResult {
  status: TextFileFillStatus
  /** The kind of field, when the page answered. */
  field?: TextFileFillField
  /** The file's text length, in UTF-16 code units. */
  characters: number
  /** For MISMATCH: the field's value length afterwards, in UTF-16 code units. */
  fieldCharacters?: number
  note: string
}

/** Whether the text was handed to the page, from main-process bookkeeping only: a failure from then on leaves the outcome unknown. */
export interface TextFileFillProgress {
  written: boolean
}

const TARGET_PROBLEMS: Record<TextFileFillTargetProblem, string> = {
  'wrong-origin': 'The page is not at expectedOrigin, so nothing was filled. Check the tab before filling.',
  'invalid-selector': 'The selector is not valid CSS.',
  'not-found': 'Field not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector; fields inside frames and shadow roots cannot be targeted.',
  ambiguous: 'The selector matches more than one element; use a ref or a selector that matches only the field.',
  'not-fillable': 'The target is not a plain text input or a textarea. Password, email, URL and other inputs, editable regions, frames and shadow roots are not filled from files; use browser_insert_text for editable regions.',
  disabled: 'The field is disabled.',
  readonly: 'The field is read-only.',
  hidden: 'The field is hidden or has no size.',
  'single-line': 'A text input drops line breaks and the file has some, so nothing was filled. Use a textarea, or a file without line breaks.',
  'too-long': 'The file\'s text is longer than the field\'s length limit (maxlength) allows, so nothing was filled; Hronaut never shortens it.',
  late: 'The page was too busy to start the fill in time, so nothing was written. Wait for it to settle and try again.'
}

/** Thrown for a file that cannot be filled from; its message never names the path or repeats the content. */
class FillFileProblem extends Error {}

/** The origin of a URL, or of the expected origin the caller gave; it throws for anything without one. */
function originOf(value: string, problem: string): string {
  let origin: string
  try {
    origin = new URL(value).origin
  } catch {
    throw new Error(problem)
  }
  if (origin === 'null') throw new Error(problem)
  return origin
}

/**
 * Reads the whole text of a regular file of at most 64 KiB (a symbolic link
 * is followed to its file) as strict UTF-8, reading no more than one byte
 * past the limit, and refuses a file that is empty, changed while it was read
 * or differs from the given SHA-256. A leading byte order mark is not part of
 * the text. At most MAX_ACTIVE_READS files are read at once. Messages never
 * name the path or repeat the content.
 */
export async function readFillText(path: string, sha256?: string): Promise<string> {
  if (!isAbsolute(path)) throw new FillFileProblem('The file path must be absolute.')
  if (sha256 !== undefined && !/^[a-f0-9]{64}$/u.test(sha256)) throw new FillFileProblem('sha256 must be 64 lowercase hexadecimal characters.')
  if (activeReads >= MAX_ACTIVE_READS) throw new FillFileProblem('Other file fills are still reading their files; try again shortly.')
  activeReads += 1
  try {
    return await readBoundedText(path, sha256)
  } finally {
    // Counted until the read itself ends, even after the caller stopped waiting for it.
    activeReads -= 1
  }
}

async function readBoundedText(path: string, sha256: string | undefined): Promise<string> {
  const info = await stat(path).catch(() => undefined)
  if (!info) throw new FillFileProblem('The file cannot be read.')
  if (!info.isFile()) throw new FillFileProblem('The path is not a regular file.')
  if (info.size > MAX_FILL_FILE_BYTES) throw new FillFileProblem('The file is larger than 64 KiB.')
  // Non-blocking where the platform has it, so a path swapped for a pipe cannot hold the read open.
  const handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0)).catch(() => undefined)
  if (!handle) throw new FillFileProblem('The file cannot be read.')
  const buffer = Buffer.alloc(MAX_FILL_FILE_BYTES + 1)
  try {
    const before = await handle.stat()
    if (!before.isFile()) throw new FillFileProblem('The path is not a regular file.')
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > MAX_FILL_FILE_BYTES) throw new FillFileProblem('The file is larger than 64 KiB.')
    const after = await handle.stat()
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.size !== length) {
      throw new FillFileProblem('The file changed while it was read, so nothing was filled.')
    }
    if (length === 0) throw new FillFileProblem('The file is empty, so there is nothing to fill.')
    const bytes = buffer.subarray(0, length)
    if (sha256 !== undefined && createHash('sha256').update(bytes).digest('hex') !== sha256) {
      throw new FillFileProblem('The file does not match sha256, so nothing was filled.')
    }
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new FillFileProblem('The file is not valid UTF-8 text.')
    }
    // A file holding only a byte order mark has no text either.
    if (!text) throw new FillFileProblem('The file is empty, so there is nothing to fill.')
    return text
  } catch (error) {
    // Errors from the filesystem itself may name the path.
    throw error instanceof FillFileProblem ? error : new FillFileProblem('The file cannot be read.')
  } finally {
    buffer.fill(0)
    await handle.close().catch(() => undefined)
  }
}

/**
 * Replaces the value of the plain text input or textarea a ref or selector
 * names with the whole text of a local UTF-8 file, then compares the field
 * with the text. The file is read once, in the main process, and only that
 * text goes to the page, after a check that sees only its length has found
 * the target. The page must be at the expected origin before the file is
 * read and when the text is written. The call's authority is checked again
 * after the read, and the page must have finished loading, so Electron sends
 * the fill at once; a fill the page starts more than FILL_START_DEADLINE_MS
 * later writes nothing. The fill checks the target again and writes in one
 * page task. Results and errors never carry the text, the field's value or
 * the path. It throws when the file, the target, the page or the call's
 * authority is not as required before the text is written, and afterwards
 * only when the call's authority changed; nothing is retried or submitted.
 */
export async function fillFromFile(
  browser: Browser,
  target: { tabId?: string; ref?: string; selector?: string },
  source: { path: string; expectedOrigin: string; sha256?: string },
  validateFill?: (validateContext: () => void) => void,
  progress: TextFileFillProgress = { written: false }
): Promise<TextFileFillResult> {
  validateTarget(target)
  const expectedOrigin = originOf(source.expectedOrigin, 'expectedOrigin must be an origin such as https://app.example.com.')
  const tab = getTab(browser, target.tabId)
  const webContents = tab.webContents
  const authority = nativeInputAuthority(browser, tab, validateFill)
  let navigated = false
  const navigationStarted = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
    // Within the document too: a new route may show another field in the same place.
    if (details.isMainFrame) navigated = true
  }
  const validate = (): void => {
    if (navigated) throw new Error('The page navigated before the text was written, so nothing was filled. Inspect it again before filling.')
    authority.validate()
  }
  webContents.on('did-start-navigation', navigationStarted)
  try {
    validate()
    if (originOf(webContents.getURL(), TARGET_PROBLEMS['wrong-origin']) !== expectedOrigin) throw new Error(TARGET_PROBLEMS['wrong-origin'])
    const text = await withTimeout(readFillText(source.path, source.sha256), 'The file could not be read in time, so nothing was filled.')
    if (text.includes('\r')) {
      throw new Error('The file has carriage returns (CRLF or CR line endings), which a field stores as line feeds, so it could not match; nothing was filled. Convert the file to LF line endings.')
    }
    validate()
    // Only the text's shape goes to the page until the target is found.
    const shape = { length: text.length, lineBreaks: text.includes('\n') }
    const checked = await withTimeout(
      webContents.executeJavaScriptInIsolatedWorld(TEXT_FILE_FILL_WORLD_ID, [{ code: textFileFillCheckScript(target, shape, expectedOrigin) }], false) as Promise<TextFileFillCheck>,
      'The page did not respond in time; nothing was filled.'
    )
    if ('problem' in checked) throw new Error(TARGET_PROBLEMS[checked.problem])
    return await withAgentInput(browser, webContents, async (): Promise<TextFileFillResult> => {
      // Nothing is awaited between these checks and the fill's dispatch.
      validate()
      // A script can be held back while the page loads, past every check: refuse instead.
      if (webContents.isLoadingMainFrame()) throw new Error('The page is still loading, so nothing was filled. Wait for it to finish loading and try again.')
      progress.written = true
      let page: TextFileFillPageResult
      try {
        page = await withTimeout(
          webContents.executeJavaScriptInIsolatedWorld(TEXT_FILE_FILL_WORLD_ID, [{
            code: textFileFillScript(target, text, expectedOrigin, Date.now() + FILL_START_DEADLINE_MS)
            // With a user gesture, as for browser_type: the page gets the activation a person's typing gives it.
          }], true) as Promise<TextFileFillPageResult>,
          'The page did not answer in time',
          FILL_ANSWER_TIMEOUT_MS
        )
      } catch {
        return {
          status: 'UNCONFIRMED',
          field: checked.field,
          characters: text.length,
          note: 'The text was sent to the page, but it navigated, stopped answering or did not finish in time, so Hronaut cannot tell whether the field has it. Read the field before trying again; do not fill it again without checking.'
        }
      }
      if ('problem' in page) {
        // The page refused the target before writing anything.
        progress.written = false
        throw new Error(TARGET_PROBLEMS[page.problem])
      }
      // As after any write, the result is published only while the call keeps its authority.
      authority.validate()
      return outcome(page, text.length)
    })
  } finally {
    authority.dispose()
    webContents.removeListener('did-start-navigation', navigationStarted)
  }
}

/** What the field showed once the page's handlers ran. */
function outcome(page: Exclude<TextFileFillPageResult, { problem: TextFileFillTargetProblem }>, characters: number): TextFileFillResult {
  if (!page.connected) {
    return {
      status: 'UNCONFIRMED',
      field: page.field,
      characters,
      note: 'The page removed or replaced the field after the text was written, so Hronaut cannot tell where the text went. Read the page before trying again.'
    }
  }
  if (page.matched) {
    return {
      status: 'MATCHED',
      field: page.field,
      characters,
      note: 'The field held exactly the file\'s text after the page\'s input and change handlers ran and a quarter second later. A page may still change it later, and this does not prove that the page accepted or saved it; its handlers may already have sent it. Read the page to check.'
    }
  }
  return {
    status: 'MISMATCH',
    field: page.field,
    characters,
    fieldCharacters: page.fieldCharacters,
    note: 'The field\'s value differed from the file\'s text after the page\'s input and change handlers ran or a quarter second later: the page may have rewritten, rejected or shortened it. Read the field before filling it again.'
  }
}

async function withTimeout<T>(operation: Promise<T>, message: string, timeoutMs = RESPONSE_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
