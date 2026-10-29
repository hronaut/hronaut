import { randomInt } from 'node:crypto'
import { isCurrentCredentialFillContext, type CredentialFillContext } from '../credential-fill-context.js'
import { isCredentialFillPageResult } from '../credential-fill-page.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { LocalizedError } from '../../localized-error.js'
import type { SuggestedPasswordAccess, SuggestedPasswordTab } from './suggested-password-access.js'
import {
  isSuggestedPasswordField,
  suggestedPasswordFieldScript,
  suggestedPasswordFillScript,
  type SuggestedPasswordField
} from './suggested-password-page.js'

// Chrome's password generator: letters and digits that are not easily confused (no l, o, I, O, 0 or 1), 15 of them,
// with at least one lowercase letter, one capital and one digit.
const LOWERCASE = 'abcdefghijkmnpqrstuvwxyz'
const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const SUGGESTED_PASSWORD_LENGTH = 15
// A field that asks for more gets up to this many characters, and one that takes fewer than four gets none.
const LONGEST_SUGGESTED_PASSWORD = 128
const SHORTEST_SUGGESTED_PASSWORD = 4

/**
 * The length of the password suggested for a field: 15 characters, or more when the field needs more, or fewer when
 * it takes fewer; null when it takes fewer than four.
 */
export function suggestedPasswordLength(field: SuggestedPasswordField): number | null {
  const longest = field.maxLength >= 0 ? Math.min(field.maxLength, LONGEST_SUGGESTED_PASSWORD) : LONGEST_SUGGESTED_PASSWORD
  const length = Math.min(Math.max(SUGGESTED_PASSWORD_LENGTH, field.minLength), longest)
  return length >= SHORTEST_SUGGESTED_PASSWORD ? length : null
}

/** A random password of this length from the system's secure random numbers, as Chrome suggests one. */
export function generateStrongPassword(length: number, random: (max: number) => number = randomInt): string {
  if (!Number.isSafeInteger(length) || length < 3) throw new RangeError('A suggested password needs at least 3 characters')
  const any = LOWERCASE + UPPERCASE + DIGITS
  const pick = (characters: string): string => characters[random(characters.length)]!
  const characters = [pick(LOWERCASE), pick(UPPERCASE), pick(DIGITS)]
  while (characters.length < length) characters.push(pick(any))
  // Fisher–Yates, so the required letters and digit can be anywhere.
  for (let index = characters.length - 1; index > 0; index--) {
    const other = random(index + 1)
    ;[characters[index], characters[other]] = [characters[other]!, characters[index]!]
  }
  return characters.join('')
}

/**
 * Runs one of the suggestion's scripts in Hronaut's own isolated world of the page. A script that fails is reported
 * without its error, which a page could have written.
 */
async function runInPage(tab: SuggestedPasswordTab, code: string, userGesture: boolean): Promise<unknown> {
  try {
    return await tab.webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLDS.suggestedPassword, [{ code }], userGesture)
  } catch {
    throw new LocalizedError('appErrors.credentials.suggestFailed')
  }
}

/**
 * Suggests a strong password in the password field the person right-clicked, as Chrome's Suggest strong password
 * does: Hronaut makes one in main, fills it into the field and the field that confirms it while agents are paused,
 * and remembers that it suggested it, so the offer to save it when the page submits it says so. Nothing is filled
 * while passwords cannot be saved, once the tab is no longer the one, at the address, the suggestion was offered
 * for, or once the focus left the field. It reports whether the page took the password.
 */
export async function suggestStrongPassword<Tab extends SuggestedPasswordTab>(
  access: SuggestedPasswordAccess<Tab>,
  tab: Tab,
  expectedContext: CredentialFillContext
): Promise<boolean> {
  const suggestions = access.options().suggestedPasswords
  const current = (): boolean => access.findTab(tab.id) === tab
    && !tab.webContents.isDestroyed()
    && isCurrentCredentialFillContext(expectedContext, access.credentialContext(tab.id))
  if (!suggestions?.available() || !current()) return false
  const field = await runInPage(tab, suggestedPasswordFieldScript(expectedContext), false)
  const length = isSuggestedPasswordField(field) ? suggestedPasswordLength(field) : null
  if (length === null) return false
  return suggestions.whileAgentsPaused(async () => {
    if (!suggestions.available() || !current()) return false
    const password = generateStrongPassword(length)
    // Remembered before the page has it: a page that submits as soon as the field changes is offered to save it too.
    suggestions.suggested(expectedContext.origin, password)
    const outcome = await access.withAgentInput(
      tab.webContents,
      () => runInPage(tab, suggestedPasswordFillScript(expectedContext, password), true)
    )
    if (!isCredentialFillPageResult(outcome)) return false
    return access.recordTrustedCredentialFill(outcome, tab, Date.now(), access.options().onUserInteraction)
  })
}
