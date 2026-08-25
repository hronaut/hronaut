import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, isDownloadDirectory, isThemeName, SettingsStore } from '../src/main/settings-store.js'
import { ATTENTION_SOUND_CUES, isAttentionSoundCue } from '../src/shared/types.js'
import { isSearchEngineName } from '../src/shared/search-engine.js'
import { DEFAULT_INTERFACE_SCALE, isInterfaceScale } from '../src/shared/interface-scale.js'

const temporaryDirectories: string[] = []
const customDownloadDirectory = join(tmpdir(), 'hronaut-custom-downloads')

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function createStore(): Promise<{ path: string; store: SettingsStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-settings-test-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'profile', 'settings.json')
  return { path, store: new SettingsStore(path) }
}

describe('SettingsStore', () => {
  it('atomically persists and restores settings', async () => {
    const { path, store } = await createStore()
    await store.save({
      theme: 'cyberpunk',
      interfaceScale: 1.25,
      tabPosition: 'left',
      searchEngine: 'duckduckgo',
      hideInTray: false,
      attentionSound: false,
      attentionSoundCue: 'bell',
      mcpAuthentication: true,
      mcpPort: 48_123,
      downloadDirectory: customDownloadDirectory,
      askWhereToSaveDownloads: true,
      memorySaverEnabled: false,
      memorySaverTimeoutMinutes: 15,
      checkForUpdatesOnStartup: false,
      languagePreference: 'uk-UA'
    })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      theme: 'cyberpunk',
      interfaceScale: 1.25,
      tabPosition: 'left',
      searchEngine: 'duckduckgo',
      hideInTray: false,
      attentionSound: false,
      attentionSoundCue: 'bell',
      mcpAuthentication: true,
      mcpPort: 48_123,
      downloadDirectory: customDownloadDirectory,
      askWhereToSaveDownloads: true,
      memorySaverEnabled: false,
      memorySaverTimeoutMinutes: 15,
      checkForUpdatesOnStartup: false,
      languagePreference: 'uk-UA'
    })
    expect(await store.load()).toEqual({
      theme: 'cyberpunk',
      interfaceScale: 1.25,
      tabPosition: 'left',
      searchEngine: 'duckduckgo',
      hideInTray: false,
      attentionSound: false,
      attentionSoundCue: 'bell',
      mcpAuthentication: true,
      mcpPort: 48_123,
      downloadDirectory: customDownloadDirectory,
      askWhereToSaveDownloads: true,
      memorySaverEnabled: false,
      memorySaverTimeoutMinutes: 15,
      checkForUpdatesOnStartup: false,
      languagePreference: 'uk-UA'
    })
  })

  it('serializes concurrent saves and keeps the last queued settings', async () => {
    const { path, store } = await createStore()
    const settings = Array.from({ length: 20 }, (_value, index) => ({
      ...DEFAULT_SETTINGS,
      mcpPort: 48_000 + index,
      interfaceScale: index % 2 === 0 ? 1 as const : 1.1 as const
    }))

    await Promise.all(settings.map((value) => store.save(value)))

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(settings.at(-1))
  })

  it('uses safe defaults for missing, malformed, and unsupported values', async () => {
    const { path, store } = await createStore()
    expect(await store.load()).toEqual(DEFAULT_SETTINGS)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, '{not json', 'utf8')
    expect(await store.load()).toEqual(DEFAULT_SETTINGS)
    await writeFile(path, '{"theme":"sepia","searchEngine":"yahoo"}', 'utf8')
    expect(await store.load()).toEqual(DEFAULT_SETTINGS)
  })

  it('defaults startup update checks on for older settings files', async () => {
    const { path, store } = await createStore()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, '{"theme":"dark"}', 'utf8')
    expect(await store.load()).toEqual({
      theme: 'dark',
      interfaceScale: DEFAULT_INTERFACE_SCALE,
      tabPosition: 'top',
      searchEngine: 'google',
      hideInTray: true,
      attentionSound: true,
      attentionSoundCue: 'warning',
      mcpAuthentication: false,
      mcpPort: 47_812,
      downloadDirectory: null,
      askWhereToSaveDownloads: false,
      memorySaverEnabled: true,
      memorySaverTimeoutMinutes: 60,
      checkForUpdatesOnStartup: true,
      languagePreference: 'system'
    })
  })

  it.each(['uk', 'en-GB', 'ja-JP', '', 42, null])('migrates an invalid language preference to system: %s', async (languagePreference) => {
    const { path, store } = await createStore()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify({ languagePreference }), 'utf8')
    expect((await store.load()).languagePreference).toBe('system')
  })

  it.each(['side', 'bottom', '', 42, null])('migrates an invalid tab position to top: %s', async (tabPosition) => {
    const { path, store } = await createStore()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify({ tabPosition }), 'utf8')
    expect((await store.load()).tabPosition).toBe('top')
  })

  it.each([80, 65_536, 48_000.5, '48000'])('rejects an invalid persisted MCP port: %s', async (mcpPort) => {
    const { path, store } = await createStore()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify({ mcpPort }), 'utf8')
    expect((await store.load()).mcpPort).toBe(47_812)
  })

  it.each(['downloads', '', 'relative/path', 42, null])('rejects an invalid persisted download directory: %s', async (downloadDirectory) => {
    const { path, store } = await createStore()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify({ downloadDirectory }), 'utf8')
    expect((await store.load()).downloadDirectory).toBeNull()
  })

  it.each([0, 10, 61, 60.5, '60', null])('rejects an invalid persisted Memory Saver timeout: %s', async (memorySaverTimeoutMinutes) => {
    const { path, store } = await createStore()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify({ memorySaverTimeoutMinutes }), 'utf8')
    expect((await store.load()).memorySaverTimeoutMinutes).toBe(60)
  })

  it('accepts only absolute download directories', () => {
    expect(isDownloadDirectory(customDownloadDirectory)).toBe(true)
    expect(isDownloadDirectory('downloads')).toBe(false)
    expect(isDownloadDirectory('')).toBe(false)
    expect(isDownloadDirectory(null)).toBe(false)
  })

  it.each([
    { autoUpdate: false, checkForUpdatesOnStartup: true, expected: false },
    { autoUpdate: true, checkForUpdatesOnStartup: false, expected: false },
    { autoUpdate: true, checkForUpdatesOnStartup: true, expected: true }
  ])('migrates legacy update settings to their effective state', async ({
    autoUpdate,
    checkForUpdatesOnStartup,
    expected
  }) => {
    const { path, store } = await createStore()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, JSON.stringify({ autoUpdate, checkForUpdatesOnStartup }), 'utf8')
    expect((await store.load()).checkForUpdatesOnStartup).toBe(expected)
  })

  it('accepts only supported theme names', () => {
    expect(['system', 'light', 'dark', 'cyberpunk'].every(isThemeName)).toBe(true)
    expect(isThemeName('sepia')).toBe(false)
    expect(isThemeName(null)).toBe(false)
  })

  it('accepts only supported interface sizes', () => {
    expect([1, 1.1, 1.25].every(isInterfaceScale)).toBe(true)
    expect(isInterfaceScale(1.2)).toBe(false)
    expect(isInterfaceScale('1.1')).toBe(false)
  })

  it('accepts only supported attention sounds', () => {
    expect(ATTENTION_SOUND_CUES.every(isAttentionSoundCue)).toBe(true)
    expect(isAttentionSoundCue('tap')).toBe(false)
    expect(isAttentionSoundCue(null)).toBe(false)
  })

  it('accepts only supported search engines', () => {
    expect(['google', 'duckduckgo', 'bing', 'brave', 'startpage'].every(isSearchEngineName)).toBe(true)
    expect(isSearchEngineName('yahoo')).toBe(false)
    expect(isSearchEngineName(null)).toBe(false)
  })
})
