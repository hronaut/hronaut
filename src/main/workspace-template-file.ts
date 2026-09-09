import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { parseWorkspaceTemplate, WORKSPACE_TEMPLATE_MAX_BYTES } from '../shared/workspace-template.js'
import { writeTextFileAtomically } from './atomic-file.js'

/** Paths come from a trusted native file dialog, never from manifest fields. */
export async function readWorkspaceTemplateFile(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    if (!stat.isFile()) throw new TypeError('Select a regular workspace template file.')
    if (stat.size > WORKSPACE_TEMPLATE_MAX_BYTES) throw new TypeError('Workspace template exceeds the size limit.')
    // Bound actual reads too: the file may grow after stat. Nonblocking open
    // avoids hanging on a named pipe before we can reject its file type.
    const buffer = Buffer.alloc(WORKSPACE_TEMPLATE_MAX_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > WORKSPACE_TEMPLATE_MAX_BYTES) throw new TypeError('Workspace template exceeds the size limit.')
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)) } catch {
      throw new TypeError('Workspace template must be valid UTF-8.')
    }
    parseWorkspaceTemplate(text)
    return text
  } finally {
    await file.close()
  }
}

export async function writeWorkspaceTemplateFile(path: string, reviewedText: string): Promise<void> {
  const text = JSON.stringify(parseWorkspaceTemplate(reviewedText), null, 2)
  // Canonicalization can expand Unicode URLs; never export a file that exceeds
  // our own import limit. Validate before creating or replacing any file.
  parseWorkspaceTemplate(text)
  await writeTextFileAtomically(path, text)
}
