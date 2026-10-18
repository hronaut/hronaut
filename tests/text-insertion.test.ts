import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ISOLATED_WORLDS } from '../src/main/browser/isolated-worlds.js'
import { insertableTextProblem, insertText, MAX_INSERTED_TEXT_LENGTH, type TextInsertionProgress } from '../src/main/browser/text-insertion/text-insertion.js'
import type { TextInsertionAccess, TextInsertionTab } from '../src/main/browser/text-insertion/text-insertion-access.js'
import type { TextInsertionLocation, TextInsertionObservation } from '../src/main/browser/text-insertion/text-insertion-scripts.js'

const TEXT = 'private-draft-canary 😀 мир'

const observation = (overrides: Partial<TextInsertionObservation> = {}): TextInsertionObservation => ({
  current: true, reached: true, cancelled: false, changed: true, blocked: 0, focusLeft: false, ...overrides
})

/**
 * A page whose isolated-world scripts answer from queues, and a manager view whose
 * authorized debugger records each command and checks the insertion's authority first.
 */
function editorPage(options: {
  locations?: Array<TextInsertionLocation | Error>
  observations?: Array<Partial<TextInsertionObservation> | Error>
  /** Runs after a command passed its checks and was recorded; what it returns or throws is Chromium's answer. */
  onCommand?: () => unknown
} = {}) {
  const commands: Array<{ method: string; params: Record<string, unknown> }> = []
  const scripts: Array<{ world: number; kind: string; code: string }> = []
  const locations = [...(options.locations ?? [{ editor: 'textarea' }, { editor: 'textarea' }])]
  const observations = [...(options.observations ?? [{}])]
  const events = new EventEmitter()
  const webContents = Object.assign(events, {
    executeJavaScriptInIsolatedWorld: async (world: number, sources: Array<{ code: string }>) => {
      const code = sources[0]?.code ?? ''
      const phase = /const phase = "(check|arm)"/u.exec(code)?.[1]
      if (phase) {
        scripts.push({ world, kind: phase, code })
        const next = locations.shift() ?? { problem: 'replaced' }
        if (next instanceof Error) throw next
        return next
      }
      if (code.includes('MessageChannel')) {
        scripts.push({ world, kind: 'observe', code })
        const next = observations.shift() ?? {}
        if (next instanceof Error) throw next
        return observation(next)
      }
      scripts.push({ world, kind: 'dispose', code })
      return true
    }
  })
  const tab: TextInsertionTab = { webContents: webContents as never }
  let authorityCurrent = true
  let disposed = 0
  const access: TextInsertionAccess<TextInsertionTab> = {
    validateTarget: (target) => {
      if (Boolean(target.ref) === Boolean(target.selector)) throw new Error('Provide exactly one of ref or selector')
    },
    getTab: () => tab,
    nativeInputAuthority: (_tab, validateInput) => ({
      validate: () => {
        const assertContext = (): void => { if (!authorityCurrent) throw new Error('Native input context changed') }
        if (validateInput) validateInput(assertContext)
        else assertContext()
      },
      dispose: () => { disposed += 1 }
    }),
    withAgentInput: (_webContents, operation) => operation(),
    withDebugger: (_webContents, operation) => operation(),
    agentInputDebugger: (_webContents, validateInput) => ({
      sendCommand: async (method, params = {}) => {
        // Like the authorized input path: two checks before the command.
        validateInput?.()
        validateInput?.()
        commands.push({ method, params })
        return (await options.onCommand?.()) ?? {}
      }
    })
  }
  return {
    access,
    commands,
    scripts,
    navigate: (isMainFrame = true) => { events.emit('did-start-navigation', { isMainFrame }) },
    listeners: () => events.listenerCount('did-start-navigation'),
    disposed: () => disposed,
    loseAuthority: () => { authorityCurrent = false }
  }
}

describe('text insertion', () => {
  afterEach(() => { vi.useRealTimers() })

  it('checks the editor, arms the guard in the debugger turn, sends the text natively and reports it inserted', async () => {
    const page = editorPage()
    const progress: TextInsertionProgress = { sent: false }
    const result = await insertText(page.access, { ref: 'e4' }, TEXT, undefined, progress)
    expect(result).toEqual({
      status: 'INSERTED', editor: 'textarea', insertedBy: 'browser',
      note: 'The editor took the text and its content changed. This does not prove that the page saved it; read the editor or the page to check.'
    })
    expect(page.commands).toEqual([{ method: 'Input.insertText', params: { text: TEXT } }])
    expect(page.scripts.map(script => script.kind)).toEqual(['check', 'arm', 'observe', 'dispose'])
    expect(page.scripts.every(script => script.world === ISOLATED_WORLDS.textInsertion)).toBe(true)
    // The page scripts never carry the text, and neither does the result.
    for (const script of page.scripts) expect(script.code).not.toContain('private-draft-canary')
    expect(JSON.stringify(result)).not.toContain('private-draft-canary')
    expect(progress.sent).toBe(true)
    expect(page.disposed()).toBe(1)
    expect(page.listeners()).toBe(0)
  })

  it('tells the page scripts whether the text has line breaks, for single-line fields', async () => {
    const page = editorPage()
    await insertText(page.access, { selector: '#notes' }, 'first\nsecond')
    expect(page.scripts[0]!.code).toContain('const lineBreaks = true')
    const plain = editorPage()
    await insertText(plain.access, { selector: '#notes' }, 'first\tsecond')
    expect(plain.scripts[0]!.code).toContain('const lineBreaks = false')
  })

  it('reports an editor that applied the text itself, a cancelled or unchanged one, and a blocked insertion', async () => {
    const outcome = async (observed: Partial<TextInsertionObservation>) => insertText(editorPage({ observations: [observed] }).access, { ref: 'e4' }, TEXT)
    expect(await outcome({ cancelled: true })).toMatchObject({ status: 'INSERTED', insertedBy: 'editor' })
    expect(await outcome({ cancelled: true, changed: false })).toMatchObject({ status: 'NOT_ACCEPTED', note: expect.stringContaining('cancelled it') })
    expect(await outcome({ changed: false })).toMatchObject({ status: 'NOT_ACCEPTED', note: expect.stringContaining('length limit') })
    expect(await outcome({ reached: false, changed: false, blocked: 1, focusLeft: true })).toMatchObject({ status: 'BLOCKED', note: expect.stringContaining('nothing was inserted') })
    expect(await outcome({ reached: false, changed: false, focusLeft: true })).toMatchObject({ status: 'UNCONFIRMED', note: expect.stringContaining('frame or another window') })
    expect(await outcome({ reached: false })).toMatchObject({ status: 'UNCONFIRMED', note: expect.stringContaining('did not see the text arrive') })
    expect(await outcome({ reached: false, changed: false })).toMatchObject({ status: 'UNCONFIRMED', note: expect.stringContaining('No text reached the editor') })
    expect(await outcome({ current: false, reached: false, changed: false })).toMatchObject({ status: 'UNCONFIRMED', note: expect.stringContaining('navigated, reloaded or stopped answering') })
  })

  it('treats an observation that fails after the text was sent as unconfirmed, never as nothing sent', async () => {
    const page = editorPage({ observations: [new Error('Execution context was destroyed')] })
    expect(await insertText(page.access, { ref: 'e4' }, TEXT)).toMatchObject({ status: 'UNCONFIRMED' })
    expect(page.commands).toHaveLength(1)
  })

  it('refuses before sending anything when the editor is not ready, naming the problem without the text', async () => {
    const refused = async (location: TextInsertionLocation, phase: 'check' | 'arm' = 'check') => {
      const page = editorPage({ locations: phase === 'check' ? [location] : [{ editor: 'input' }, location] })
      const progress: TextInsertionProgress = { sent: false }
      const error = await insertText(page.access, { ref: 'e4' }, TEXT, undefined, progress).then(() => new Error('inserted'), (caught: unknown) => caught as Error)
      expect(page.commands).toHaveLength(0)
      expect(progress.sent).toBe(false)
      expect(error.message).not.toContain('private-draft-canary')
      expect(page.scripts.at(-1)?.kind).toBe('dispose')
      return error.message
    }
    expect(await refused({ problem: 'not-focused' })).toMatch(/does not have focus\. Click it with browser_click/u)
    expect(await refused({ problem: 'not-editable' })).toMatch(/not a text field, text area or editable region/u)
    expect(await refused({ problem: 'ambiguous', count: 2 })).toMatch(/more than one element/u)
    expect(await refused({ problem: 'no-caret' })).toMatch(/caret or selection is not inside the editor/u)
    expect(await refused({ problem: 'single-line' })).toMatch(/single-line field turns line breaks into spaces/u)
    expect(await refused({ problem: 'not-found' })).toMatch(/frames and shadow roots cannot be targeted/u)
    // The second check, in the debugger turn, catches focus moved or the editor replaced meanwhile.
    expect(await refused({ problem: 'replaced' }, 'arm')).toMatch(/changed before the text was sent, so nothing was inserted/u)
    expect(await refused({ problem: 'not-focused' }, 'arm')).toMatch(/does not have focus/u)
  })

  it('refuses text it cannot send faithfully before touching the page', async () => {
    expect(insertableTextProblem('a'.repeat(MAX_INSERTED_TEXT_LENGTH))).toBeUndefined()
    expect(insertableTextProblem('line\nbreak and\ttab, 😀 and мир')).toBeUndefined()
    expect(insertableTextProblem('')).toMatch(/1 to 4096 characters/u)
    expect(insertableTextProblem('a'.repeat(MAX_INSERTED_TEXT_LENGTH + 1))).toMatch(/1 to 4096 characters/u)
    for (const control of ['\r', '\u0000', '\u001b[31m', '\u007f', '\u0085']) {
      expect(insertableTextProblem(`a${control}b`), JSON.stringify(control)).toMatch(/no other control characters/u)
    }
    expect(insertableTextProblem('\uD83D')).toMatch(/unpaired surrogate/u)
    expect(insertableTextProblem('a\uDE00b')).toMatch(/unpaired surrogate/u)
    const page = editorPage()
    await expect(insertText(page.access, { ref: 'e4' }, 'bad\u0007bell')).rejects.toThrow(/control characters/u)
    await expect(insertText(page.access, { ref: 'e4', selector: '#also' }, TEXT)).rejects.toThrow(/exactly one of ref or selector/u)
    expect(page.scripts).toHaveLength(0)
  })

  it('sends nothing when the page navigates or the authority changes before the text goes out', async () => {
    const navigating = editorPage()
    const realScript = navigating.access.withDebugger
    navigating.access.withDebugger = (webContents, operation) => {
      navigating.navigate()
      return realScript(webContents, operation)
    }
    await expect(insertText(navigating.access, { ref: 'e4' }, TEXT)).rejects.toThrow(/navigated before the text was sent, so nothing was inserted/u)
    expect(navigating.commands).toHaveLength(0)
    // A subframe's navigation does not change the editor's document.
    const subframe = editorPage()
    subframe.access.withDebugger = (webContents, operation) => {
      subframe.navigate(false)
      return realScript(webContents, operation)
    }
    expect(await insertText(subframe.access, { ref: 'e4' }, TEXT)).toMatchObject({ status: 'INSERTED' })

    const revoked = editorPage()
    const progress: TextInsertionProgress = { sent: false }
    const outcomes: Array<boolean> = []
    revoked.access.withAgentInput = (webContents, operation) => {
      revoked.loseAuthority()
      return operation()
    }
    await expect(insertText(revoked.access, { ref: 'e4' }, TEXT, (validateContext) => {
      try { validateContext() } catch (error) { outcomes.push(progress.sent); throw error }
    }, progress)).rejects.toThrow(/Native input context changed/u)
    expect(revoked.commands).toHaveLength(0)
    expect(outcomes).toEqual([false])
  })

  it('marks the outcome unknown when the authority ends after the text was sent', async () => {
    const page = editorPage({ onCommand: () => { page.loseAuthority() } })
    const progress: TextInsertionProgress = { sent: false }
    const sentWhenRefused: boolean[] = []
    await expect(insertText(page.access, { ref: 'e4' }, TEXT, (validateContext) => {
      try { validateContext() } catch (error) { sentWhenRefused.push(progress.sent); throw error }
    }, progress)).rejects.toThrow(/Native input context changed/u)
    expect(page.commands).toHaveLength(1)
    expect(sentWhenRefused).toEqual([true])
  })

  it('reports a command Chromium rejected or did not answer after its last check as unconfirmed', async () => {
    const rejected = editorPage({ onCommand: () => { throw new Error('Target closed') } })
    expect(await insertText(rejected.access, { ref: 'e4' }, TEXT)).toMatchObject({ status: 'UNCONFIRMED', note: expect.stringContaining('may have reached the page') })
    expect(rejected.scripts.map(script => script.kind)).toEqual(['check', 'arm', 'dispose'])

    vi.useFakeTimers()
    const stalled = editorPage({ onCommand: () => new Promise(() => undefined) })
    const pending = insertText(stalled.access, { ref: 'e4' }, TEXT)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await pending).toMatchObject({ status: 'UNCONFIRMED' })
  })
})
