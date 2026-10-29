import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { credentialFillContext, type CredentialFillContext } from '../src/main/browser/credential-fill-context.js'
import {
  generateStrongPassword,
  suggestedPasswordLength,
  suggestStrongPassword
} from '../src/main/browser/suggested-password/suggested-password.js'
import type { SuggestedPasswordAccess, SuggestedPasswordOptions } from '../src/main/browser/suggested-password/suggested-password-access.js'
import type { CredentialFillPageResult } from '../src/main/browser/credential-fill-page.js'
import { ISOLATED_WORLDS } from '../src/main/browser/isolated-worlds.js'
import { LocalizedError } from '../src/main/localized-error.js'

const LOWERCASE = 'abcdefghijkmnpqrstuvwxyz'
const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'

describe('generating a strong password', () => {
  it('makes 15 letters and digits that are not easily confused, at least one lowercase, one capital and one digit', () => {
    for (let round = 0; round < 200; round++) {
      const password = generateStrongPassword(15)
      expect(password).toHaveLength(15)
      expect(password).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9]+$/u)
      expect([...password].some((character) => LOWERCASE.includes(character))).toBe(true)
      expect([...password].some((character) => UPPERCASE.includes(character))).toBe(true)
      expect([...password].some((character) => DIGITS.includes(character))).toBe(true)
    }
    expect(new Set(Array.from({ length: 50 }, () => generateStrongPassword(15))).size).toBe(50)
  })

  it('draws every character from the random numbers it is given, and shuffles the required ones', () => {
    // Always the first choice: a, A and 2 are required, a fills the rest, and each place swaps with the first.
    expect(generateStrongPassword(5, () => 0)).toBe('A2aaa')
    const draws: number[] = []
    generateStrongPassword(15, (max) => { draws.push(max); return max - 1 })
    expect(draws.slice(0, 3)).toEqual([LOWERCASE.length, UPPERCASE.length, DIGITS.length])
    expect(draws.slice(3, 15)).toEqual(Array(12).fill(LOWERCASE.length + UPPERCASE.length + DIGITS.length))
    expect(draws.slice(15)).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2])
  })

  it('suggests 15 characters, more when the field needs more, fewer when it takes fewer, and none under four', () => {
    expect(suggestedPasswordLength({ minLength: -1, maxLength: -1 })).toBe(15)
    expect(suggestedPasswordLength({ minLength: 8, maxLength: 64 })).toBe(15)
    expect(suggestedPasswordLength({ minLength: 20, maxLength: -1 })).toBe(20)
    expect(suggestedPasswordLength({ minLength: 500, maxLength: -1 })).toBe(128)
    expect(suggestedPasswordLength({ minLength: 20, maxLength: 16 })).toBe(16)
    expect(suggestedPasswordLength({ minLength: -1, maxLength: 10 })).toBe(10)
    expect(suggestedPasswordLength({ minLength: -1, maxLength: 4 })).toBe(4)
    expect(suggestedPasswordLength({ minLength: -1, maxLength: 3 })).toBeNull()
    expect(suggestedPasswordLength({ minLength: -1, maxLength: 0 })).toBeNull()
    expect(() => generateStrongPassword(2)).toThrow(RangeError)
  })
})

type Tab = { id: string, webContents: WebContents, humanInteractionGeneration: number }

function harness(options: {
  field?: unknown
  fillOutcome?: CredentialFillPageResult
  available?: () => boolean
  context?: () => CredentialFillContext | null
  fillError?: Error
} = {}) {
  const steps: string[] = []
  let filledWith: string | undefined
  const expected = credentialFillContext('https://accounts.example/sign-up', 3, 7)!
  const executeJavaScriptInIsolatedWorld = vi.fn(async (worldId: number, scripts: Array<{ code: string }>, userGesture?: boolean) => {
    const code = scripts[0]!.code
    steps.push(`world ${worldId === ISOLATED_WORLDS.suggestedPassword ? 'suggested password' : worldId}`)
    if (code.includes('return { minLength: field.minLength')) {
      steps.push(`read field${userGesture ? ' with gesture' : ''}`)
      return options.field === undefined ? { minLength: -1, maxLength: -1 } : options.field
    }
    filledWith = /const password = "([^"]*)";/u.exec(code)?.[1]
    steps.push(`fill${userGesture ? ' with gesture' : ''}`)
    if (options.fillError) throw options.fillError
    return options.fillOutcome ?? 'filled'
  })
  const tab: Tab = { id: 'tab', webContents: { isDestroyed: () => false, executeJavaScriptInIsolatedWorld } as unknown as WebContents, humanInteractionGeneration: 0 }
  const suggested = vi.fn((origin: string, password: string) => { steps.push(`remember ${origin} ${password.length}`) })
  const suggestions: SuggestedPasswordOptions = {
    available: options.available ?? (() => true),
    whileAgentsPaused: async (fill) => {
      steps.push('pause agents')
      try { return await fill() } finally { steps.push('release agents') }
    },
    suggested
  }
  const onUserInteraction = vi.fn()
  const recordTrustedCredentialFill = vi.fn((outcome: CredentialFillPageResult, recorded: Tab) => {
    if (outcome === 'none') return false
    recorded.humanInteractionGeneration++
    return outcome === 'filled'
  })
  const access: SuggestedPasswordAccess<Tab> = {
    findTab: (tabId) => tabId === tab.id ? tab : undefined,
    credentialContext: () => options.context ? options.context() : expected,
    withAgentInput: async (_webContents, operation) => {
      steps.push('agent input')
      return operation()
    },
    recordTrustedCredentialFill,
    options: () => ({ suggestedPasswords: suggestions, onUserInteraction })
  }
  return { access, tab, expected, steps, suggested, recordTrustedCredentialFill, executeJavaScript: executeJavaScriptInIsolatedWorld, filled: () => filledWith }
}

describe('suggesting a strong password in a page', () => {
  it('reads the field, pauses agents, remembers the password, then fills it as the person’s input', async () => {
    const { access, tab, expected, steps, suggested, recordTrustedCredentialFill, filled } = harness()
    await expect(suggestStrongPassword(access, tab, expected)).resolves.toBe(true)
    expect(steps).toEqual([
      'world suggested password', 'read field', 'pause agents', 'remember https://accounts.example 15',
      'agent input', 'world suggested password', 'fill with gesture', 'release agents'
    ])
    expect(suggested).toHaveBeenCalledExactlyOnceWith('https://accounts.example', filled())
    expect(filled()).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9]{15}$/u)
    expect(recordTrustedCredentialFill).toHaveBeenCalledExactlyOnceWith('filled', tab, expect.any(Number), expect.any(Function))
    expect(tab.humanInteractionGeneration).toBe(1)
  })

  it('fits the password to the field', async () => {
    const { access, tab, expected, filled } = harness({ field: { minLength: -1, maxLength: 12 } })
    await expect(suggestStrongPassword(access, tab, expected)).resolves.toBe(true)
    expect(filled()).toHaveLength(12)
  })

  it('pauses no agent and fills nothing when there is no field to suggest a password for', async () => {
    for (const field of [null, { minLength: -1, maxLength: 3 }, { minLength: 'x', maxLength: 1 }, 'filled']) {
      const { access, tab, expected, steps, suggested } = harness({ field })
      await expect(suggestStrongPassword(access, tab, expected)).resolves.toBe(false)
      expect(steps).toEqual(['world suggested password', 'read field'])
      expect(suggested).not.toHaveBeenCalled()
    }
  })

  it('touches no page while passwords cannot be saved, and fills none when that changes while agents pause', async () => {
    const unavailable = harness({ available: () => false })
    await expect(suggestStrongPassword(unavailable.access, unavailable.tab, unavailable.expected)).resolves.toBe(false)
    expect(unavailable.executeJavaScript).not.toHaveBeenCalled()

    let available = true
    const closing = harness({ available: () => available })
    closing.access.withAgentInput = vi.fn()
    const pause = closing.access.options().suggestedPasswords!.whileAgentsPaused
    closing.access.options().suggestedPasswords!.whileAgentsPaused = (fill) => { available = false; return pause(fill) }
    await expect(suggestStrongPassword(closing.access, closing.tab, closing.expected)).resolves.toBe(false)
    expect(closing.steps).toEqual(['world suggested password', 'read field', 'pause agents', 'release agents'])
    expect(closing.suggested).not.toHaveBeenCalled()
  })

  it('fills nothing once the tab shows another page or is no longer in front', async () => {
    const moved = harness({ context: () => credentialFillContext('https://accounts.example/sign-in', 3, 7) })
    await expect(suggestStrongPassword(moved.access, moved.tab, moved.expected)).resolves.toBe(false)
    expect(moved.executeJavaScript).not.toHaveBeenCalled()

    let current = true
    const switched = harness({ context: () => current ? credentialFillContext('https://accounts.example/sign-up', 3, 7) : null })
    const pause = switched.access.options().suggestedPasswords!.whileAgentsPaused
    switched.access.options().suggestedPasswords!.whileAgentsPaused = (fill) => { current = false; return pause(fill) }
    await expect(suggestStrongPassword(switched.access, switched.tab, switched.expected)).resolves.toBe(false)
    expect(switched.steps).toEqual(['world suggested password', 'read field', 'pause agents', 'release agents'])
  })

  it('reports a script that failed in the page without its error, which the page could have written', async () => {
    const { access, tab, expected } = harness({ fillError: new Error('k7Gm2xPqR9sTv4w leaked') })
    const failure = await suggestStrongPassword(access, tab, expected).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(LocalizedError)
    expect(failure).toMatchObject({ key: 'appErrors.credentials.suggestFailed' })
    expect(Object.hasOwn(failure as Error, 'cause')).toBe(false)
    expect(String((failure as Error).message)).not.toContain('leaked')
  })

  it('reports that the page took no password, and records no interaction then', async () => {
    const { access, tab, expected, recordTrustedCredentialFill } = harness({ fillOutcome: 'none' })
    await expect(suggestStrongPassword(access, tab, expected)).resolves.toBe(false)
    expect(recordTrustedCredentialFill).toHaveBeenCalledOnce()
    expect(tab.humanInteractionGeneration).toBe(0)
  })
})
