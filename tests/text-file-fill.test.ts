import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ISOLATED_WORLDS } from '../src/main/browser/isolated-worlds.js'
import { fillFromFile, MAX_FILL_FILE_BYTES, readFillText, type TextFileFillProgress } from '../src/main/browser/text-file-fill/text-file-fill.js'
import type { TextFileFillAccess, TextFileFillTab } from '../src/main/browser/text-file-fill/text-file-fill-access.js'
import type { TextFileFillPageResult } from '../src/main/browser/text-file-fill/text-file-fill-scripts.js'
import { registerBrowserFillFromFile } from '../src/main/mcp/tools/browser-fill-from-file/index.js'

const ORIGIN = 'http://127.0.0.1:4100'
const TEXT = 'private-fixture-canary "quoted" `tick` 😀 мир\nsecond line\n'
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
  })
})

/** A page whose fill script answers from a queue, and a manager view whose authority checks call the fill's validator. */
function fieldPage(options: {
  url?: string
  results?: Array<TextFileFillPageResult | Error>
  /** Runs inside the agent input scope, before the fill's last check. */
  beforeWrite?: () => void
} = {}) {
  const scripts: Array<{ world: number; code: string }> = []
  const results = [...(options.results ?? [{ field: 'textarea', matched: true, connected: true, fieldCharacters: TEXT.length }])]
  const events = new EventEmitter()
  const webContents = Object.assign(events, {
    getURL: () => options.url ?? `${ORIGIN}/form`,
    executeJavaScriptInIsolatedWorld: async (world: number, sources: Array<{ code: string }>) => {
      scripts.push({ world, code: sources[0]!.code })
      const next = results.shift()
      if (next instanceof Error) throw next
      return next
    }
  })
  let disposed = 0
  const access: TextFileFillAccess<TextFileFillTab> = {
    validateTarget: (target) => {
      if ((target.ref === undefined) === (target.selector === undefined)) throw new Error('Provide exactly one of ref or selector')
    },
    getTab: () => ({ webContents }) as unknown as TextFileFillTab,
    nativeInputAuthority: (_tab, validateInput) => ({
      validate: () => validateInput?.(() => undefined),
      dispose: () => { disposed += 1 }
    }),
    withAgentInput: async (_webContents, operation) => {
      options.beforeWrite?.()
      return operation()
    }
  }
  return {
    access,
    scripts,
    navigate: () => { events.emit('did-start-navigation', { isMainFrame: true }) },
    disposed: () => disposed,
    listeners: () => events.listenerCount('did-start-navigation')
  }
}

const source = (overrides: Partial<{ path: string; expectedOrigin: string; sha256: string }> = {}) => ({ path: textFile, expectedOrigin: ORIGIN, ...overrides })

describe('filling a field from a file', () => {
  it('sends the file text to the page once, in its own world, and reports a matching field without the text or path', async () => {
    const page = fieldPage()
    const progress: TextFileFillProgress = { written: false }
    const result = await fillFromFile(page.access, { selector: '#notes' }, source({ expectedOrigin: `${ORIGIN}/any/path` }), undefined, progress)
    expect(result).toEqual(expect.objectContaining({ status: 'MATCHED', field: 'textarea', characters: TEXT.length }))
    expect(page.scripts).toHaveLength(1)
    expect(page.scripts[0]!.world).toBe(ISOLATED_WORLDS.textFileFill)
    expect(page.scripts[0]!.code).toContain(JSON.stringify(TEXT))
    expect(page.scripts[0]!.code).toContain(JSON.stringify(ORIGIN))
    expect(JSON.stringify(result)).not.toMatch(/private-fixture-canary|private-path-canary/u)
    expect(progress.written).toBe(true)
    expect(page.disposed()).toBe(1)
    expect(page.listeners()).toBe(0)
  })

  it('reports a field the page rewrote, one it replaced, and a page that stopped answering after the write', async () => {
    const fill = (result: TextFileFillPageResult | Error) => fillFromFile(fieldPage({ results: [result] }).access, { ref: 'e4' }, source())
    expect(await fill({ field: 'input', matched: false, connected: true, fieldCharacters: 12 }))
      .toMatchObject({ status: 'MISMATCH', field: 'input', fieldCharacters: 12, note: expect.stringContaining('rewritten, rejected or shortened') })
    expect(await fill({ field: 'input', matched: true, connected: false, fieldCharacters: 3 }))
      .toMatchObject({ status: 'UNCONFIRMED', note: expect.stringContaining('removed or replaced the field') })
    const lost = await fill(new Error('Execution context was destroyed'))
    expect(lost).toMatchObject({ status: 'UNCONFIRMED', note: expect.stringContaining('do not fill it again without checking') })
    expect(lost.field).toBeUndefined()
  })

  it('refuses before reading the file or writing anything when the page is elsewhere or the target was refused', async () => {
    const elsewhere = fieldPage({ url: 'https://other.example/form' })
    await expect(fillFromFile(elsewhere.access, { ref: 'e4' }, source())).rejects.toThrow(/not at expectedOrigin/u)
    expect(elsewhere.scripts).toHaveLength(0)
    const blank = fieldPage({ url: 'about:blank' })
    await expect(fillFromFile(blank.access, { ref: 'e4' }, source())).rejects.toThrow(/not at expectedOrigin/u)
    await expect(fillFromFile(fieldPage().access, { ref: 'e4' }, source({ expectedOrigin: 'not an origin' }))).rejects.toThrow(/expectedOrigin must be an origin/u)
    await expect(fillFromFile(fieldPage().access, { ref: 'e4', selector: '#also' }, source())).rejects.toThrow(/exactly one of ref or selector/u)
    for (const [problem, message] of [['not-fillable', /not a plain text input or a textarea/u], ['too-long', /never shortens it/u], ['single-line', /drops line breaks/u], ['wrong-origin', /not at expectedOrigin/u]] as const) {
      const progress: TextFileFillProgress = { written: false }
      const refused = fieldPage({ results: [{ problem }] })
      await expect(fillFromFile(refused.access, { ref: 'e4' }, source(), undefined, progress)).rejects.toThrow(message)
      // The page script checks the target before writing: a refusal wrote nothing.
      expect(progress.written).toBe(false)
    }
  })

  it('refuses a file with carriage returns, which no field keeps', async () => {
    const windows = join(directory, 'windows.txt')
    await writeFile(windows, 'first\r\nsecond')
    const page = fieldPage()
    await expect(fillFromFile(page.access, { ref: 'e4' }, source({ path: windows }))).rejects.toThrow(/carriage returns/u)
    expect(page.scripts).toHaveLength(0)
  })

  it('writes nothing when the page navigates or the authority changes while the file is read', async () => {
    const navigating: ReturnType<typeof fieldPage> = fieldPage({ beforeWrite: () => navigating.navigate() })
    const progress: TextFileFillProgress = { written: false }
    await expect(fillFromFile(navigating.access, { ref: 'e4' }, source(), undefined, progress)).rejects.toThrow(/navigated before the text was written/u)
    expect(navigating.scripts).toHaveLength(0)
    expect(progress.written).toBe(false)

    let revoked = false
    const revoking = fieldPage({ beforeWrite: () => { revoked = true } })
    const validateFill = (): void => { if (revoked) throw new Error('authority revoked') }
    await expect(fillFromFile(revoking.access, { ref: 'e4' }, source(), validateFill)).rejects.toThrow('authority revoked')
    expect(revoking.scripts).toHaveLength(0)
  })

  it('throws, with the write recorded, when the authority ends after the text was written', async () => {
    let checks = 0
    const page = fieldPage()
    const progress: TextFileFillProgress = { written: false }
    // The first two checks precede the write; the third guards the result's publication.
    const validateFill = (): void => { checks += 1; if (checks === 3) throw new Error('authority ended') }
    await expect(fillFromFile(page.access, { ref: 'e4' }, source(), validateFill, progress)).rejects.toThrow('authority ended')
    expect(page.scripts).toHaveLength(1)
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
    return { outcomes, run }
  }

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
