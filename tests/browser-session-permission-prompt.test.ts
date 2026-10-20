import type { MessageBoxOptions, Session } from 'electron'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { translate } from '../src/shared/i18n.js'
import type { SupportedLocale } from '../src/shared/locale.js'

vi.mock('electron', () => ({ app: { getPath: () => '' }, session: { fromPartition: vi.fn() } }))

const { createBrowserSession } = await import('../src/main/browser-session.js')

type RequestHandler = Parameters<Session['setPermissionRequestHandler']>[0] & {}

const WORKSPACE = '01912345-6789-7abc-8def-0123456789ab'

/** Asks for one permission from a page at https://files.example and returns the prompt Hronaut showed. */
async function prompt(
  locale: SupportedLocale,
  permission: string,
  details: Record<string, unknown> = {},
  workspaceName?: string
): Promise<MessageBoxOptions> {
  const { allowed, shown } = await request(locale, permission, details, 'deny', workspaceName)
  expect(allowed).toBe(false)
  expect(shown).toHaveLength(1)
  return shown[0]!
}

/** Asks for one permission from a page at https://files.example, answering any prompt, and returns what happened. */
async function request(
  locale: SupportedLocale,
  permission: string,
  details: Record<string, unknown> = {},
  answer: 'deny' | 'allow' = 'deny',
  workspaceName?: string
): Promise<{ allowed: boolean, shown: MessageBoxOptions[] }> {
  let handler: RequestHandler | undefined
  const shown: MessageBoxOptions[] = []
  const browserSession = createBrowserSession({
    text: (key, parameters) => translate(locale, key, parameters),
    effectiveDownloadDirectory: () => '',
    showMessageBox: async (options) => {
      shown.push(options)
      return { response: answer === 'allow' ? 1 : 0, checkboxChecked: false }
    },
    workspaceName: (workspaceId) => workspaceId === WORKSPACE ? workspaceName : undefined,
    state: { persistentSession: null, sitePermissionStore: null },
    sendToShellWindows: () => undefined,
    partition: 'persist:test'
  })
  browserSession.configureBrowserSession({
    setDownloadPath: () => undefined,
    setPermissionCheckHandler: () => undefined,
    setPermissionRequestHandler: (next: RequestHandler) => { handler = next }
  } as unknown as Session, WORKSPACE)
  const url = 'https://files.example/'
  const frame = { frameTreeNodeId: 1, url, origin: 'https://files.example', detached: false }
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    getURL: () => url,
    mainFrame: { ...frame, framesInSubtree: [frame] }
  })
  const allowed = await new Promise<boolean>((resolve) => {
    handler!(webContents as never, permission as never, resolve, { requestingUrl: url, isMainFrame: true, ...details } as never)
  })
  return { allowed, shown }
}

describe('site permission prompt', () => {
  it('names a permission the way Settings does instead of by its Chromium identifier', async () => {
    // The prompt used to say "requests “geolocation” permission" in every language.
    expect((await prompt('en-US', 'geolocation')).message).toBe('https://files.example requests “Location” permission.')
    expect((await prompt('uk-UA', 'geolocation')).message).toBe('Сайт https://files.example запитує дозвіл «Розташування».')
    expect((await prompt('de-DE', 'clipboard-read')).message).toBe('https://files.example fordert die Berechtigung „Zwischenablage lesen“ an.')
    expect((await prompt('uk-UA', 'pointerLock')).message).toBe('Сайт https://files.example запитує дозвіл «Блокування вказівника миші».')
    expect((await prompt('fr-FR', 'screen-wake-lock')).message).toBe('https://files.example demande l’autorisation « Garder l’écran allumé ».')
  })

  it('names only the device a camera-only or microphone-only request asks for', async () => {
    // A microphone-only request used to read "requests “Camera and microphone” permission".
    expect((await prompt('en-US', 'media', { mediaTypes: ['audio'] })).message).toBe('https://files.example requests “Microphone” permission.')
    expect((await prompt('en-US', 'media', { mediaTypes: ['video'] })).message).toBe('https://files.example requests “Camera” permission.')
    expect((await prompt('uk-UA', 'media', { mediaTypes: ['audio'] })).message).toBe('Сайт https://files.example запитує дозвіл «Мікрофон».')
    expect((await prompt('de-DE', 'media', { mediaTypes: ['video'] })).message).toBe('https://files.example fordert die Berechtigung „Kamera“ an.')
    const both = await prompt('en-US', 'media', { mediaTypes: ['audio', 'video'] })
    expect(both.message).toBe('https://files.example requests “Camera and microphone” permission.')
    expect(both.detail).toBe(
      "Requested devices: microphone and camera. Hronaut doesn't remember this choice. If you choose Deny, this page can't ask for this again until it reloads."
    )
  })

  it('refuses a screen sharing request without asking about the camera and microphone', async () => {
    // A screen, window or tab capture request lists no device. It used to show "requests “Camera and microphone”
    // permission", and Allow shared the whole screen for getUserMedia's chromeMediaSource "desktop".
    expect(await request('en-US', 'media', { mediaTypes: [] }, 'allow')).toEqual({ allowed: false, shown: [] })
    expect(await request('en-US', 'media', {}, 'allow')).toEqual({ allowed: false, shown: [] })
    expect(await request('en-US', 'media', { mediaTypes: ['video'] }, 'allow')).toMatchObject({ allowed: true, shown: [{}] })
  })

  it('shows a permission Settings has no name for as Settings does, without reading inherited names', async () => {
    expect((await prompt('en-US', 'local-fonts')).message).toBe('https://files.example requests “local fonts” permission.')
    expect((await prompt('en-US', 'toString')).message).toBe('https://files.example requests “toString” permission.')
  })

  it('names read and write file access in the interface language', async () => {
    // The detail used to show Electron's "readable" or "writable" between translated words.
    expect((await prompt('en-US', 'fileSystem', { fileAccessType: 'readable', filePath: '/home/notes.txt' })).detail)
      .toBe('Requested read access: /home/notes.txt. This decision will apply only once. '
        + "Hronaut doesn't remember this choice. If you choose Deny, this page can't ask for this again until it reloads.")
    const writable = await prompt('uk-UA', 'fileSystem', { fileAccessType: 'writable', filePath: '/home/notes.txt' })
    expect(writable.message).toBe('Сайт https://files.example запитує дозвіл «Файли й папки».')
    expect(writable.detail).toContain('Запитано доступ на запис: /home/notes.txt.')
    expect((await prompt('de-DE', 'fileSystem', { fileAccessType: 'readable', filePath: '/home/notes.txt' })).detail)
      .toContain('Angeforderter Zugriff (Lesen): /home/notes.txt.')
    expect((await prompt('fr-FR', 'fileSystem', { filePath: '/home/notes.txt' })).detail).toContain('Accès non précisé demandé : /home/notes.txt.')
    expect((await prompt('ru-RU', 'fileSystem', { fileAccessType: 'writable', filePath: '/home/notes.txt' })).detail)
      .toContain('Запрошен доступ (запись): /home/notes.txt.')
    expect((await prompt('es-ES', 'fileSystem', { filePath: '/home/notes.txt' })).detail).toContain('Acceso solicitado (no especificado): /home/notes.txt.')
    expect((await prompt('pl-PL', 'fileSystem', { filePath: '/home/notes.txt' })).detail).toContain('Żądany dostęp (nieokreślony): /home/notes.txt.')
  })

  it('names the workspace the tab asks in, which may not be the one shown', async () => {
    // An agent's tab in another workspace could ask while the person looked at their own, and the prompt said only
    // "this workspace" about where the choice was remembered.
    expect((await prompt('en-US', 'geolocation', {}, 'Client A')).detail)
      .toBe('Hronaut remembers this choice for this website in the “Client A” workspace. You can change it later in Settings → Site permissions.')
    expect((await prompt('uk-UA', 'geolocation', {}, 'Клієнт А')).detail)
      .toContain('Hronaut запам’ятає цей вибір для цього сайту в робочому просторі «Клієнт А».')
    expect((await prompt('en-US', 'media', { mediaTypes: ['video'] }, 'Client A')).detail)
      .toBe('Requested devices: camera. Asked in the “Client A” workspace. '
        + "Hronaut doesn't remember this choice. If you choose Deny, this page can't ask for this again until it reloads.")
    for (const locale of ['de-DE', 'fr-FR', 'es-ES', 'pl-PL', 'ru-RU'] as const) {
      expect((await prompt(locale, 'geolocation', {}, 'Client A')).detail, locale).toContain('Client A')
      expect((await prompt(locale, 'media', { mediaTypes: ['audio'] }, 'Client A')).detail, locale).toContain('Client A')
    }
    // A workspace Hronaut does not know keeps the words it had.
    expect((await prompt('en-US', 'geolocation')).detail)
      .toBe('Hronaut remembers this choice for this website in this workspace. You can change it later in Settings → Site permissions.')
  })

  it('does not say it remembers a file request that names no file', async () => {
    // A file system request without a path said both that Hronaut remembers the choice and that it does not.
    expect((await prompt('en-US', 'fileSystem')).detail)
      .toBe("Hronaut doesn't remember this choice. If you choose Deny, this page can't ask for this again until it reloads.")
    expect((await prompt('en-US', 'fileSystem', {}, 'Client A')).detail)
      .toBe("Asked in the “Client A” workspace. Hronaut doesn't remember this choice. If you choose Deny, this page can't ask for this again until it reloads.")
  })
})
