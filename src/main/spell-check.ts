import type { IpcMain, IpcMainInvokeEvent, Session } from 'electron'
import type { AppSettings } from '../shared/types.js'

type SpellCheckSession = Pick<Session, 'setSpellCheckerEnabled'>

interface SpellCheckHost {
  /** The current settings; read on every use because each committed update replaces the object. */
  settings(): AppSettings
  updateSettings(
    updates: Partial<AppSettings>,
    applyRuntime?: (value: AppSettings) => void | Promise<void>
  ): Promise<AppSettings>
  publishSettings(): void
}

/**
 * Spell checking in websites' text fields, as Chrome's "Check for spelling errors when you type text on web pages":
 * every browser session follows the one setting, in Settings and in a text field's context menu alike.
 */
export function createSpellCheck(host: SpellCheckHost): {
  /** Has a browser session check spelling as the setting says, now and after every change. */
  track(session: SpellCheckSession): void
  /** Applies a value to every tracked session; a settings update runs it before it saves, and again on rollback. */
  apply(enabled: boolean): void
  /** Whether spell checking is on now, including a change that is still saving. */
  isEnabled(): boolean
  /** Turns spell checking on or off, saves it and tells both shells. */
  setEnabled(enabled: boolean): Promise<AppSettings>
} {
  const sessions = new Set<SpellCheckSession>()
  // The value last applied, which an update applies before it commits, so a session tracked while it saves gets it.
  let applied: boolean | undefined

  function track(session: SpellCheckSession): void {
    if (sessions.has(session)) return
    sessions.add(session)
    session.setSpellCheckerEnabled(isEnabled())
  }

  function apply(enabled: boolean): void {
    applied = enabled
    for (const session of sessions) session.setSpellCheckerEnabled(enabled)
  }

  function isEnabled(): boolean {
    return applied ?? host.settings().spellCheck
  }

  async function setEnabled(enabled: boolean): Promise<AppSettings> {
    await host.updateSettings({ spellCheck: enabled }, (next) => apply(next.spellCheck))
    host.publishSettings()
    return { ...host.settings() }
  }

  return { track, apply, isEnabled, setEnabled }
}

/** The spell check switch in Settings → General; main checks the value. */
export function registerSpellCheckIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  host: { assertTrustedSender(event: IpcMainInvokeEvent): void, setEnabled(enabled: boolean): Promise<AppSettings> }
): void {
  ipcMain.handle('settings:set-spell-check', async (event, enabled: unknown) => {
    host.assertTrustedSender(event)
    if (typeof enabled !== 'boolean') throw new TypeError('Spell check must be a boolean')
    return await host.setEnabled(enabled)
  })
}
