import type { IpcMainInvokeEvent, Session } from 'electron'
import type { TypedIpcMain } from '../typed-ipc.js'
import type { AppSettings, SpellCheckLanguages } from '../../shared/types.js'
import { SETTINGS_IPC } from '../../shared/ipc/settings.js'

type SpellCheckSession = Pick<
  Session,
  'setSpellCheckerEnabled' | 'getSpellCheckerLanguages' | 'setSpellCheckerLanguages'
  | 'addWordToSpellCheckerDictionary' | 'listWordsInSpellCheckerDictionary'
>

interface SpellCheckHost {
  /** The current settings; read on every use because each committed update replaces the object. */
  settings(): AppSettings
  updateSettings(
    updates: Partial<AppSettings>,
    applyRuntime?: (value: AppSettings) => void | Promise<void>
  ): Promise<AppSettings>
  publishSettings(): void
  /**
   * The dictionaries Chromium can check spelling with; none on macOS, where the system's spell checker picks the language
   * by itself.
   */
  availableLanguages(): readonly string[]
  /** Hronaut's Chromium locale, such as `en-US` or `uk`, which picks the language when none is chosen. */
  locale(): string
}

/**
 * The language Chromium checks spelling in when none is chosen: the dictionary for its locale, the one for that locale's
 * language, or American English. A session keeps the languages it was last given across restarts, so this one is given
 * again when the chosen ones are cleared.
 */
export function automaticSpellCheckLanguages(locale: string, available: readonly string[]): string[] {
  const lowerLocale = locale.toLowerCase()
  const language = lowerLocale.split('-')[0]
  const match = available.find((code) => code.toLowerCase() === lowerLocale)
    ?? available.find((code) => code.toLowerCase() === language)
    ?? available.find((code) => code.toLowerCase().split('-')[0] === language)
    ?? available.find((code) => code === 'en-US')
  return match ? [match] : []
}

/**
 * Spell checking in websites' text fields, as Chrome's "Check for spelling errors when you type text on web pages" and
 * its spell check languages: every browser session follows the one setting, in Settings and in a text field's context
 * menu alike. The words added to the dictionary are one list too, as Chrome keeps one dictionary for its profile: each session keeps
 * its own on disk, so a session tracked takes the words the others have, and gives them its own.
 */
export function createSpellCheck(host: SpellCheckHost): {
  /** Has a browser session check spelling as the settings say, now and after every change. */
  track(session: SpellCheckSession): void
  /** Applies a value to every tracked session; a settings update runs it before it saves, and again on rollback. */
  apply(enabled: boolean): void
  /** Gives every tracked session these chosen languages, or the automatic one for none; an update runs it as `apply`. */
  applyLanguages(languages: readonly string[]): void
  /** Whether spell checking is on now, including a change that is still saving. */
  isEnabled(): boolean
  /** Turns spell checking on or off, saves it and tells both shells. */
  setEnabled(enabled: boolean): Promise<AppSettings>
  /** The languages Settings offers, and the one checked when none is chosen. */
  languages(): SpellCheckLanguages
  /** Checks spelling in these languages, saves them and tells both shells. */
  setLanguages(languages: readonly string[]): Promise<AppSettings>
  /** Adds a word to the dictionary of every tracked session, as Add to dictionary in a text field's menu does. */
  addWord(word: string): void
} {
  const sessions = new Set<SpellCheckSession>()
  /** The words added to any tracked session's dictionary, which every tracked session is given. */
  const words = new Set<string>()
  // The values last applied, which an update applies before it commits, so a session tracked while it saves gets them.
  let applied: boolean | undefined
  let appliedLanguages: readonly string[] | undefined

  function track(session: SpellCheckSession): void {
    if (sessions.has(session)) return
    sessions.add(session)
    session.setSpellCheckerEnabled(isEnabled())
    giveLanguages(session, appliedLanguages ?? host.settings().spellCheckLanguages)
    // Words added from now on reach this session as they are added, so it is given only the ones known before.
    const known = [...words]
    const giveKnown = (own: readonly string[]): void => {
      const has = new Set(own)
      for (const word of known) if (!has.has(word)) session.addWordToSpellCheckerDictionary(word)
    }
    void session.listWordsInSpellCheckerDictionary().then((own) => {
      giveKnown(own)
      for (const word of own) {
        if (words.has(word)) continue
        words.add(word)
        for (const other of sessions) if (other !== session) other.addWordToSpellCheckerDictionary(word)
      }
    }, () => {
      // A session whose words cannot be read still gets the words the others have.
      console.warn('[spell-check] Could not read a session\'s dictionary words.')
      giveKnown([])
    }).catch(() => {
      console.warn('[spell-check] Could not add words to a session\'s dictionary.')
    })
  }

  function addWord(word: string): void {
    words.add(word)
    for (const session of sessions) session.addWordToSpellCheckerDictionary(word)
  }

  function apply(enabled: boolean): void {
    applied = enabled
    for (const session of sessions) session.setSpellCheckerEnabled(enabled)
  }

  function applyLanguages(languages: readonly string[]): void {
    appliedLanguages = languages
    for (const session of sessions) giveLanguages(session, languages)
  }

  /**
   * Only where Chromium has dictionaries, and only a change: a session keeps its languages across restarts. Electron
   * turns checking on whenever it gives a session languages, so the session is then told again whether to check.
   */
  function giveLanguages(session: SpellCheckSession, chosen: readonly string[]): void {
    const wanted = languagesFor(chosen)
    if (!wanted) return
    const current = session.getSpellCheckerLanguages()
    if (current.length === wanted.length && current.every((language, index) => language === wanted[index])) return
    session.setSpellCheckerLanguages(wanted)
    session.setSpellCheckerEnabled(isEnabled())
  }

  /** The chosen languages Chromium still has, or the automatic one; none where it has no dictionaries. */
  function languagesFor(chosen: readonly string[]): string[] | undefined {
    const available = host.availableLanguages()
    if (!available.length) return undefined
    const kept = chosen.filter((language) => available.includes(language))
    return kept.length ? kept : automaticSpellCheckLanguages(host.locale(), available)
  }

  function isEnabled(): boolean {
    return applied ?? host.settings().spellCheck
  }

  async function setEnabled(enabled: boolean): Promise<AppSettings> {
    await host.updateSettings({ spellCheck: enabled }, (next) => apply(next.spellCheck))
    host.publishSettings()
    return { ...host.settings() }
  }

  function languages(): SpellCheckLanguages {
    const available = [...host.availableLanguages()]
    return { available, automatic: automaticSpellCheckLanguages(host.locale(), available) }
  }

  async function setLanguages(languages: readonly string[]): Promise<AppSettings> {
    await host.updateSettings({ spellCheckLanguages: [...languages] }, (next) => applyLanguages(next.spellCheckLanguages))
    host.publishSettings()
    return { ...host.settings() }
  }

  return { track, apply, applyLanguages, isEnabled, setEnabled, languages, setLanguages, addWord }
}

/** The spell check switch and languages in Settings → General; main checks the values. */
export function registerSpellCheckIpc(
  ipcMain: Pick<TypedIpcMain, 'handle'>,
  host: {
    assertTrustedSender(event: IpcMainInvokeEvent): void
    setEnabled(enabled: boolean): Promise<AppSettings>
    languages(): SpellCheckLanguages
    setLanguages(languages: readonly string[]): Promise<AppSettings>
  }
): void {
  ipcMain.handle(SETTINGS_IPC.setSpellCheck, async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Spell check must be a boolean')
    return await host.setEnabled(enabled)
  })
  ipcMain.handle(SETTINGS_IPC.getSpellCheckLanguages, (event) => {
    host.assertTrustedSender(event)
    return host.languages()
  })
  ipcMain.handle(SETTINGS_IPC.setSpellCheckLanguages, async (event, value: unknown) => {
    host.assertTrustedSender(event)
    const { available } = host.languages()
    // Array.from reads a hole in a sparse array as undefined, which `every` would skip.
    const languages: unknown[] = Array.isArray(value) ? Array.from(value) : []
    if (
      !languages.length || new Set(languages).size !== languages.length
      || !languages.every((language) => typeof language === 'string' && available.includes(language))
    ) {
      throw new TypeError('Spell check languages must be one or more different languages Hronaut has dictionaries for')
    }
    return await host.setLanguages(languages as string[])
  })
}
