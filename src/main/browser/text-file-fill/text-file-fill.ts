import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import type { TextFileFillAccess, TextFileFillTab } from './text-file-fill-access.js'
import { textFileFillScript, type TextFileFillField, type TextFileFillPageResult, type TextFileFillTargetProblem } from './text-file-fill-scripts.js'

const TEXT_FILE_FILL_WORLD_ID = ISOLATED_WORLDS.textFileFill

/** The largest file a fill reads, in bytes. */
export const MAX_FILL_FILE_BYTES = 64 * 1024

/** How long reading the file, or the page's fill, may take before Hronaut gives up on it. */
const RESPONSE_TIMEOUT_MS = 5_000

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
  'too-long': 'The file\'s text is longer than the field\'s length limit (maxlength) allows, so nothing was filled; Hronaut never shortens it.'
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
 * Reads the whole text of a regular file of at most 64 KiB as strict UTF-8,
 * reading no more than one byte past the limit, and refuses a file that is
 * empty, changed while it was read or differs from the given SHA-256. A
 * leading byte order mark is not part of the text. Messages never name the
 * path or repeat the content.
 */
export async function readFillText(path: string, sha256?: string): Promise<string> {
  if (!isAbsolute(path)) throw new FillFileProblem('The file path must be absolute.')
  if (sha256 !== undefined && !/^[a-f0-9]{64}$/u.test(sha256)) throw new FillFileProblem('sha256 must be 64 lowercase hexadecimal characters.')
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
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.size !== length) {
      throw new FillFileProblem('The file changed while it was read, so nothing was filled.')
    }
    if (length === 0) throw new FillFileProblem('The file is empty, so there is nothing to fill.')
    const bytes = buffer.subarray(0, length)
    if (sha256 !== undefined && createHash('sha256').update(bytes).digest('hex') !== sha256) {
      throw new FillFileProblem('The file does not match sha256, so nothing was filled.')
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw new FillFileProblem('The file is not valid UTF-8 text.')
    }
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
 * text goes to the page. The page must be at the expected origin before the
 * file is read and when the text is written, and the call's authority is
 * checked again after the read, with no wait before the write is dispatched;
 * the page script checks the target and writes in one task. Results and
 * errors never carry the text, the field's value or the path. It throws when
 * the file, the target, the page or the call's authority is not as required
 * before the text is written, and afterwards only when the call's authority
 * changed; nothing is retried or submitted.
 */
export async function fillFromFile<Tab extends TextFileFillTab>(
  access: TextFileFillAccess<Tab>,
  target: { tabId?: string; ref?: string; selector?: string },
  source: { path: string; expectedOrigin: string; sha256?: string },
  validateFill?: (validateContext: () => void) => void,
  progress: TextFileFillProgress = { written: false }
): Promise<TextFileFillResult> {
  access.validateTarget(target)
  const expectedOrigin = originOf(source.expectedOrigin, 'expectedOrigin must be an origin such as https://app.example.com.')
  const tab = access.getTab(target.tabId)
  const webContents = tab.webContents
  const authority = access.nativeInputAuthority(tab, validateFill)
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
    return await access.withAgentInput(webContents, async (): Promise<TextFileFillResult> => {
      // The file read may have taken a while; nothing is awaited between this check and the write's dispatch.
      validate()
      progress.written = true
      let page: TextFileFillPageResult
      try {
        page = await withTimeout(
          webContents.executeJavaScriptInIsolatedWorld(TEXT_FILE_FILL_WORLD_ID, [{ code: textFileFillScript(target, text, expectedOrigin) }], false) as Promise<TextFileFillPageResult>,
          'The page did not answer in time'
        )
      } catch {
        return {
          status: 'UNCONFIRMED',
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
      note: 'The field holds exactly the file\'s text. This does not prove that the page accepted or saved it, and its input and change handlers may already have sent it; read the page to check.'
    }
  }
  return {
    status: 'MISMATCH',
    field: page.field,
    characters,
    fieldCharacters: page.fieldCharacters,
    note: 'The field\'s value differs from the file\'s text after the page\'s input and change handlers ran: the page may have rewritten, rejected or shortened it. Read the field before filling it again.'
  }
}

async function withTimeout<T>(operation: Promise<T>, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), RESPONSE_TIMEOUT_MS)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
