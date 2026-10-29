import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ISOLATED_WORLDS } from '../src/main/browser/isolated-worlds.js'
import { javascriptLiteral } from '../src/shared/javascript-literal.js'
import { fillFromFile, MAX_FILL_FILE_BYTES, readFillText, type TextFileFillProgress } from '../src/main/browser/text-file-fill/text-file-fill.js'
import type { Browser } from '../src/main/browser/browser.js'
import type { TextFileFillCheck, TextFileFillPageResult } from '../src/main/browser/text-file-fill/text-file-fill-scripts.js'
import { fillSettlement } from '../src/main/mcp/tools/browser-fill-from-file/fill-settlement.js'
import { registerBrowserFillFromFile } from '../src/main/mcp/tools/browser-fill-from-file/index.js'

// The native input authority and the agent input scope, as the fake browser of the page in use answers them.
vi.mock('../src/main/browser/native-input-authority/native-input-authority.js', () => ({
  nativeInputAuthority: (browser: { nativeInputAuthority(...args: unknown[]): unknown }, ...args: unknown[]) => browser.nativeInputAuthority(...args)
}))
vi.mock('../src/main/browser/agent-input-scope/agent-input-scope.js', () => ({
  withAgentInput: (browser: { withAgentInput(...args: unknown[]): unknown }, ...args: unknown[]) => browser.withAgentInput(...args)
}))

const ORIGIN = 'http://127.0.0.1:4100'
const TEXT = 'private-fixture-canary "quoted" `tick` </script> \u2028 😀 мир\nsecond line\n'
let directory: string
let textFile: string

beforeAll(async () => {
  // The directory name is a canary too: no message or result may name the path.
  directory = await mkdtemp(join(tmpdir(), 'private-path-canary-'))
  textFile = join(directory, 'fixture.txt')
  await writeFile(textFile, TEXT)
})

afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

async function fileProblem(path: string, hash?: string): Promise<string> {
  const message = await readFillText(path, hash).then(() => 'read', (caught: unknown) => (caught as Error).message)
  expect(message).not.toContain('private-path-canary')
  return message
}

describe('reading the file', () => {
  it('reads strict UTF-8 text whole, without trimming, and drops only a leading byte order mark', async () => {
    expect(await readFillText(textFile)).toBe(TEXT)
    expect(await readFillText(textFile, sha256(TEXT))).toBe(TEXT)
    const marked = join(directory, 'marked.txt')
    await writeFile(marked, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('  spaced  \n')]))
    expect(await readFillText(marked)).toBe('  spaced  \n')
    const largest = join(directory, 'largest.txt')
    await writeFile(largest, 'a'.repeat(MAX_FILL_FILE_BYTES))
    expect(await readFillText(largest)).toHaveLength(MAX_FILL_FILE_BYTES)
  })

  it('refuses files it cannot fill from faithfully, never naming the path', async () => {
    expect(await fileProblem('relative/fixture.txt')).toMatch(/must be absolute/u)
    expect(await fileProblem(join(directory, 'missing.txt'))).toMatch(/cannot be read/u)
    const folder = join(directory, 'folder')
    await mkdir(folder)
    expect(await fileProblem(folder)).toMatch(/not a regular file/u)
    const large = join(directory, 'large.txt')
    await writeFile(large, 'a'.repeat(MAX_FILL_FILE_BYTES + 1))
    expect(await fileProblem(large)).toMatch(/larger than 64 KiB/u)
    const empty = join(directory, 'empty.txt')
    await writeFile(empty, '')
    expect(await fileProblem(empty)).toMatch(/empty/u)
    const binary = join(directory, 'binary.txt')
    await writeFile(binary, Buffer.from([0x61, 0xff, 0x62]))
    expect(await fileProblem(binary)).toMatch(/not valid UTF-8/u)
    expect(await fileProblem(textFile, sha256('other'))).toMatch(/does not match sha256/u)
    expect(await fileProblem(textFile, 'ABC')).toMatch(/64 lowercase hexadecimal/u)
    // A byte order mark alone is no text.
    const markOnly = join(directory, 'mark-only.txt')
    await writeFile(markOnly, Buffer.from([0xef, 0xbb, 0xbf]))
    expect(await fileProblem(markOnly)).toMatch(/empty/u)
  })

  it('follows a symbolic link to its file, and refuses one that leads to a folder', async () => {
    const link = join(directory, 'link.txt')
    await symlink(textFile, link)
    expect(await readFillText(link)).toBe(TEXT)
    const folderLink = join(directory, 'folder-link')
    await mkdir(join(directory, 'linked-folder'))
    await symlink(join(directory, 'linked-folder'), folderLink)
    expect(await fileProblem(folderLink)).toMatch(/not a regular file/u)
  })

  it.runIf(process.platform !== 'win32')('refuses a named pipe without opening it, so a pipe with no writer cannot hold the read', async () => {
    const pipe = join(directory, 'pipe.txt')
    try {
      execFileSync('mkfifo', [pipe])
    } catch {
      return
    }
    expect(await fileProblem(pipe)).toMatch(/not a regular file/u)
  })

  it.runIf(process.platform === 'linux')('refuses a file whose size differs from what it read', async () => {
    // Linux reports a size of zero for its process files but returns their text when read.
    expect(await fileProblem('/proc/self/status')).toMatch(/changed while it was read/u)
  })

  it('reads at most two files at once and refuses a third until one finishes', async () => {
    const reads = await Promise.allSettled([readFillText(textFile), readFillText(textFile), readFillText(textFile)])
    expect(reads.map(read => read.status)).toEqual(['fulfilled', 'fulfilled', 'rejected'])
    expect(((reads[2] as PromiseRejectedResult).reason as Error).message).toMatch(/still reading their files/u)
    expect(await readFillText(textFile)).toBe(TEXT)
  })
})

/**
 * A page whose check script answers with `check` and whose fill script answers from a queue, and a browser showing
 * it whose authority checks call the fill's validator.
 */
function fieldPage(options: {
  url?: string
  loading?: boolean
  check?: TextFileFillCheck
  results?: Array<TextFileFillPageResult | Error>
  /** Runs inside the agent input scope, before the fill's last check. */
  beforeWrite?: () => void
} = {}) {
  const scripts: Array<{ world: number; code: string }> = []
  const results = [...(options.results ?? [{ field: 'textarea', matched: true, connected: true, fieldCharacters: TEXT.length }])]
  const events = new EventEmitter()
  const webContents = Object.assign(events, {
    getURL: () => options.url ?? `${ORIGIN}/form`,
    isLoadingMainFrame: () => options.loading ?? false,
    executeJavaScriptInIsolatedWorld: async (world: number, sources: Array<{ code: string }>) => {
      scripts.push({ world, code: sources[0]!.code })
      if (scripts.length === 1) return options.check ?? { field: 'textarea' }
      const next = results.shift()
      if (next instanceof Error) throw next
      return next
    }
  })
  let disposed = 0
  const tab = { id: 'tab', webContents }
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: tab.id,
    nativeInputAuthority: (_tab: unknown, validateInput?: (validateContext: () => void) => void) => ({
      validate: () => validateInput?.(() => undefined),
      dispose: () => { disposed += 1 }
    }),
    withAgentInput: async <T>(_webContents: unknown, operation: () => Promise<T>): Promise<T> => {
      options.beforeWrite?.()
      return operation()
    }
  } as unknown as Browser
  return {
    browser,
    scripts,
    navigate: () => { events.emit('did-start-navigation', { isMainFrame: true }) },
    disposed: () => disposed,
    listeners: () => events.listenerCount('did-start-navigation')
  }
}

const source = (overrides: Partial<{ path: string; expectedOrigin: string; sha256: string }> = {}) => ({ path: textFile, expectedOrigin: ORIGIN, ...overrides })

describe('filling a field from a file', () => {
  it('checks the target with only the text\'s shape, then sends the text once with a start deadline, in its own world', async () => {
    const page = fieldPage()
    const progress: TextFileFillProgress = { written: false }
    const sent = Date.now()
    const result = await fillFromFile(page.browser, { selector: '#notes' }, source({ expectedOrigin: `${ORIGIN}/any/path` }), undefined, progress)
    expect(result).toEqual(expect.objectContaining({ status: 'MATCHED', field: 'textarea', characters: TEXT.length }))
    expect(page.scripts).toHaveLength(2)
    expect(page.scripts.map(script => script.world)).toEqual([ISOLATED_WORLDS.textFileFill, ISOLATED_WORLDS.textFileFill])
    const [check, write] = page.scripts.map(script => script.code)
    expect(check).not.toMatch(/private-fixture-canary|second line/u)
    expect(check).toContain(String(TEXT.length))
    expect(check).toContain(JSON.stringify(ORIGIN))
    // The text is a script literal that cannot close a script element or a line: Function sees the same string.
    expect(write).toContain(javascriptLiteral(TEXT))
    expect(write).not.toMatch(/<\/script>|\u2028/u)
    expect(new Function(`return ${javascriptLiteral(TEXT)}`)()).toBe(TEXT)
    expect(write).toContain(JSON.stringify(ORIGIN))
    const deadline = Number(/Date\.now\(\) > (\d+)/u.exec(write!)?.[1])
    expect(deadline - sent).toBeGreaterThanOrEqual(4_000)
    expect(deadline - Date.now()).toBeLessThanOrEqual(4_000)
    expect(JSON.stringify(result)).not.toMatch(/private-fixture-canary|private-path-canary/u)
    expect(progress.written).toBe(true)
    expect(page.disposed()).toBe(1)
    expect(page.listeners()).toBe(0)
  })

  it('reports a field the page rewrote, one it replaced, and a page that stopped answering after the write', async () => {
    const fill = (result: TextFileFillPageResult | Error) => fillFromFile(fieldPage({ results: [result] }).browser, { ref: 'e4' }, source())
    expect(await fill({ field: 'input', matched: false, connected: true, fieldCharacters: 12 }))
      .toMatchObject({ status: 'MISMATCH', field: 'input', fieldCharacters: 12, note: expect.stringContaining('rewritten, rejected or shortened') })
    expect(await fill({ field: 'input', matched: true, connected: false, fieldCharacters: 3 }))
      .toMatchObject({ status: 'UNCONFIRMED', note: expect.stringContaining('removed or replaced the field') })
    const lost = await fill(new Error('Execution context was destroyed'))
    expect(lost).toMatchObject({ status: 'UNCONFIRMED', field: 'textarea', note: expect.stringContaining('do not fill it again without checking') })
  })

  it('refuses before reading the file or writing anything when the page is elsewhere or the target was refused', async () => {
    const elsewhere = fieldPage({ url: 'https://other.example/form' })
    // The origin is checked before the file is read: a missing file is not even looked for.
    await expect(fillFromFile(elsewhere.browser, { ref: 'e4' }, source({ path: join(directory, 'missing.txt') }))).rejects.toThrow(/not at expectedOrigin/u)
    expect(elsewhere.scripts).toHaveLength(0)
    const blank = fieldPage({ url: 'about:blank' })
    await expect(fillFromFile(blank.browser, { ref: 'e4' }, source())).rejects.toThrow(/not at expectedOrigin/u)
    await expect(fillFromFile(fieldPage().browser, { ref: 'e4' }, source({ expectedOrigin: 'not an origin' }))).rejects.toThrow(/expectedOrigin must be an origin/u)
    await expect(fillFromFile(fieldPage().browser, { ref: 'e4', selector: '#also' }, source())).rejects.toThrow('Provide either ref or selector, not both')
    for (const [problem, message] of [['not-fillable', /not a plain text input or a textarea/u], ['too-long', /never shortens it/u], ['single-line', /drops line breaks/u], ['wrong-origin', /not at expectedOrigin/u]] as const) {
      const progress: TextFileFillProgress = { written: false }
      const refused = fieldPage({ check: { problem } })
      await expect(fillFromFile(refused.browser, { ref: 'e4' }, source(), undefined, progress)).rejects.toThrow(message)
      // Only the check ran: the text never reached the page.
      expect(refused.scripts).toHaveLength(1)
      expect(progress.written).toBe(false)
    }
    // The fill script checks again before writing, and writes nothing once its deadline passed.
    for (const [problem, message] of [['late', /too busy to start the fill in time/u], ['not-found', /Field not found/u]] as const) {
      const progress: TextFileFillProgress = { written: false }
      const refused = fieldPage({ results: [{ problem }] })
      await expect(fillFromFile(refused.browser, { ref: 'e4' }, source(), undefined, progress)).rejects.toThrow(message)
      expect(refused.scripts).toHaveLength(2)
      expect(progress.written).toBe(false)
    }
  })

  it('refuses a page that is still loading, which Electron would hold the fill back for', async () => {
    const loading = fieldPage({ loading: true })
    const progress: TextFileFillProgress = { written: false }
    await expect(fillFromFile(loading.browser, { ref: 'e4' }, source(), undefined, progress)).rejects.toThrow(/still loading/u)
    expect(loading.scripts).toHaveLength(1)
    expect(progress.written).toBe(false)
  })

  it('refuses a file with carriage returns, which no field keeps', async () => {
    const windows = join(directory, 'windows.txt')
    await writeFile(windows, 'first\r\nsecond')
    const page = fieldPage()
    await expect(fillFromFile(page.browser, { ref: 'e4' }, source({ path: windows }))).rejects.toThrow(/carriage returns/u)
    expect(page.scripts).toHaveLength(0)
  })

  it('writes nothing when the page navigates or the authority changes while the file is read', async () => {
    const navigating: ReturnType<typeof fieldPage> = fieldPage({ beforeWrite: () => navigating.navigate() })
    const progress: TextFileFillProgress = { written: false }
    await expect(fillFromFile(navigating.browser, { ref: 'e4' }, source(), undefined, progress)).rejects.toThrow(/navigated before the text was written/u)
    expect(navigating.scripts).toHaveLength(1)
    expect(progress.written).toBe(false)

    let revoked = false
    const revoking = fieldPage({ beforeWrite: () => { revoked = true } })
    const validateFill = (): void => { if (revoked) throw new Error('authority revoked') }
    await expect(fillFromFile(revoking.browser, { ref: 'e4' }, source(), validateFill)).rejects.toThrow('authority revoked')
    expect(revoking.scripts).toHaveLength(1)
  })

  it('throws, with the write recorded, when the authority ends after the text was written', async () => {
    let checks = 0
    const page = fieldPage()
    const progress: TextFileFillProgress = { written: false }
    // The first three checks precede the write; the fourth guards the result's publication.
    const validateFill = (): void => { checks += 1; if (checks === 4) throw new Error('authority ended') }
    await expect(fillFromFile(page.browser, { ref: 'e4' }, source(), validateFill, progress)).rejects.toThrow('authority ended')
    expect(page.scripts).toHaveLength(2)
    expect(progress.written).toBe(true)
  })
})

describe('browser_fill_from_file tool', () => {
  type Validate = (validateContext: () => void) => void
  /** The tool's handler, over a manager whose fill runs the given steps, and a call that records its outcome class. */
  function tool(fill: (validateFill: Validate, progress: TextFileFillProgress) => Promise<unknown>, overrides: Record<string, unknown> = {}) {
    let handler: ((input: Record<string, unknown>, call: unknown) => Promise<unknown>) | undefined
    registerBrowserFillFromFile({
      manager: { fillFromFile: (_target: unknown, _source: unknown, validateFill: Validate, progress: TextFileFillProgress) => fill(validateFill, progress) },
      tabTool: (_name: string, callback: unknown) => callback,
      registerWorkspaceTool: (_name: string, _config: unknown, callback: typeof handler) => { handler = callback }
    } as never)
    const outcomes: unknown[] = []
    const call = {
      signal: undefined,
      requireCurrentTarget: () => undefined,
      requirePostWriteContext: () => undefined,
      authorityRejection: () => undefined,
      setInvalidatedOutcome: (outcome: unknown) => { outcomes.push(outcome) },
      ...overrides
    }
    const run = () => handler!({ ref: 'e4', path: textFile, expectedOrigin: ORIGIN }, call).then(() => new Error('filled'), (caught: unknown) => caught as Error)
    const result = () => handler!({ ref: 'e4', path: textFile, expectedOrigin: ORIGIN }, call) as Promise<CallToolResult>
    return { outcomes, run, result }
  }

  it('returns the result as structured content, which marks an unconfirmed fill as outcome-unknown', async () => {
    const unconfirmed = await tool(async () => ({ status: 'UNCONFIRMED', field: 'textarea', characters: 3, note: 'Read the field.' })).result()
    expect(unconfirmed.structuredContent).toMatchObject({ status: 'UNCONFIRMED', characters: 3 })
    expect(JSON.parse((unconfirmed.content[0] as { text: string }).text)).toMatchObject({ status: 'UNCONFIRMED' })
    const activity = { readOnly: false, dispatched: true, invalidatedOutcome: undefined }
    expect(fillSettlement().classifyActivity(activity, false, unconfirmed)).toEqual({ ...activity, invalidatedOutcome: 'outcome-unknown' })
    const matched = await tool(async () => ({ status: 'MATCHED', field: 'textarea', characters: 3, note: 'Read the page.' })).result()
    expect(fillSettlement().classifyActivity(activity, false, matched)).toEqual(activity)
    expect(fillSettlement().classifyActivity(activity, true, undefined)).toEqual(activity)
  })

  it('says nothing was filled when its checks fail before the text is written', async () => {
    const rejected = tool(async validate => { validate(() => undefined) }, { authorityRejection: () => ({ content: [] }) })
    expect((await rejected.run()).message).toMatch(/before the text was written; nothing was filled/u)
    expect(rejected.outcomes).toEqual([undefined])
    const failed = tool(async () => { throw new Error('The file is empty, so there is nothing to fill.') })
    expect((await failed.run()).message).toMatch(/empty/u)
    expect(failed.outcomes).toEqual([])
  })

  it('marks every failure after the text was written as outcome-unknown and says the field may have it', async () => {
    const cancelled = tool(async (validate, progress) => {
      progress.written = true
      validate(() => undefined)
    }, { signal: { aborted: true } })
    expect((await cancelled.run()).message).toMatch(/after the text was written; the field may have it/u)
    expect(cancelled.outcomes.at(-1)).toBe('outcome-unknown')
    const late = tool(async (_validate, progress) => {
      progress.written = true
      throw new Error('agent input scope failed')
    })
    expect((await late.run()).message).toBe('agent input scope failed')
    expect(late.outcomes).toEqual(['outcome-unknown'])
  })
})
