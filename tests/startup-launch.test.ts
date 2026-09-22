import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  STARTUP_LAUNCH_ARGUMENT,
  StartupLaunchManager,
  shouldStartMinimized
} from '../src/main/startup-launch.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('StartupLaunchManager', () => {
  it('registers and removes a quoted freedesktop autostart entry on Linux', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-startup-test-'))
    temporaryDirectories.push(directory)
    const manager = new StartupLaunchManager({
      platform: 'linux',
      isPackaged: true,
      executablePath: '/opt/Hronaut 100% Browser/hronaut',
      autostartDirectory: directory
    })

    await manager.setEnabled(true)

    const entry = await readFile(join(directory, 'hronaut.desktop'), 'utf8')
    expect(entry).toContain('Name=Hronaut')
    expect(entry).toContain('Exec="/opt/Hronaut 100%% Browser/hronaut" --launch-at-login')
    expect(entry).toContain('TryExec=/opt/Hronaut 100% Browser/hronaut')
    expect(await manager.isEnabled()).toBe(true)

    await writeFile(join(directory, 'hronaut.desktop'), `${entry}Hidden=true\n`, 'utf8')
    expect(await manager.isEnabled()).toBe(false)

    await manager.setEnabled(false)
    await expect(readFile(join(directory, 'hronaut.desktop'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await manager.isEnabled()).toBe(false)
  })

  it('escapes freedesktop string and command layers for unusual Linux executable paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-startup-test-'))
    temporaryDirectories.push(directory)
    const executablePath = '/opt/Hronaut\\$`" 100% Browser/hronaut'
    const manager = new StartupLaunchManager({
      platform: 'linux',
      isPackaged: true,
      executablePath,
      autostartDirectory: directory
    })

    await manager.setEnabled(true)

    const entry = await readFile(join(directory, 'hronaut.desktop'), 'utf8')
    expect(entry).toContain('TryExec=/opt/Hronaut\\\\$`" 100% Browser/hronaut')
    expect(entry).toContain('Exec="/opt/Hronaut\\\\\\\\\\\\$\\\\`\\\\" 100%% Browser/hronaut" --launch-at-login')
    expect(await manager.isEnabled()).toBe(true)
  })

  it('rejects Linux executable paths that cannot be represented by a desktop Exec key', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-startup-test-'))
    temporaryDirectories.push(directory)
    const manager = new StartupLaunchManager({
      platform: 'linux',
      isPackaged: true,
      executablePath: '/opt/Hronaut=Preview/hronaut',
      autostartDirectory: directory
    })

    await expect(manager.setEnabled(true)).rejects.toThrow(/not valid/i)
  })

  it('does not mistake comments or another desktop-entry group for an active Linux command', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-startup-test-'))
    temporaryDirectories.push(directory)
    const executablePath = '/opt/Hronaut/hronaut'
    const manager = new StartupLaunchManager({
      platform: 'linux',
      isPackaged: true,
      executablePath,
      autostartDirectory: directory
    })
    const command = `"${executablePath}" ${STARTUP_LAUNCH_ARGUMENT}`

    await writeFile(join(directory, 'hronaut.desktop'), [
      '[Desktop Entry]',
      'Type=Application',
      `# Exec=${command}`,
      '[Unrelated Group]',
      `Exec=${command}`,
      ''
    ].join('\n'), 'utf8')

    expect(await manager.isEnabled()).toBe(false)

    await writeFile(join(directory, 'hronaut.desktop'), [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Hronaut',
      `Exec = ${command}`,
      'Hidden = false',
      '[Unrelated Group]',
      'Hidden=true',
      ''
    ].join('\n'), 'utf8')

    expect(await manager.isEnabled()).toBe(true)
  })

  it('requires the mandatory Linux application autostart fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-startup-test-'))
    temporaryDirectories.push(directory)
    const executablePath = '/opt/Hronaut/hronaut'
    const manager = new StartupLaunchManager({
      platform: 'linux',
      isPackaged: true,
      executablePath,
      autostartDirectory: directory
    })
    const command = `"${executablePath}" ${STARTUP_LAUNCH_ARGUMENT}`

    for (const fields of [
      ['Name=Hronaut'],
      ['Type=Link', 'Name=Hronaut'],
      ['Type=Directory', 'Name=Hronaut'],
      ['Type=Application']
    ]) {
      await writeFile(join(directory, 'hronaut.desktop'), [
        '[Desktop Entry]',
        ...fields,
        `Exec=${command}`,
        ''
      ].join('\n'), 'utf8')
      expect(await manager.isEnabled()).toBe(false)
    }
  })

  it('rejects an otherwise matching Linux desktop entry with duplicate keys or groups', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-startup-test-'))
    temporaryDirectories.push(directory)
    const executablePath = '/opt/Hronaut/hronaut'
    const manager = new StartupLaunchManager({
      platform: 'linux',
      isPackaged: true,
      executablePath,
      autostartDirectory: directory
    })
    const command = `"${executablePath}" ${STARTUP_LAUNCH_ARGUMENT}`

    for (const duplicate of [
      ['Hidden=false', 'Hidden=false'],
      ['Name=Hronaut', 'Name=Duplicate'],
      ['Name=Hronaut', '[Desktop Entry]']
    ]) {
      await writeFile(join(directory, 'hronaut.desktop'), [
        '[Desktop Entry]',
        'Type=Application',
        `Exec=${command}`,
        ...duplicate,
        ''
      ].join('\n'), 'utf8')
      expect(await manager.isEnabled()).toBe(false)
    }
  })

  it('uses matching arguments when registering and verifying a Windows login item', async () => {
    let enabled = false
    const setLoginItemSettings = vi.fn((value: Electron.Settings) => { enabled = Boolean(value.openAtLogin) })
    const getLoginItemSettings = vi.fn(() => ({ openAtLogin: enabled }))
    const manager = new StartupLaunchManager({
      platform: 'win32',
      isPackaged: true,
      executablePath: 'C:\\Program Files\\Hronaut\\Hronaut.exe',
      autostartDirectory: 'unused',
      nativeLoginItems: { setLoginItemSettings, getLoginItemSettings }
    })

    await manager.setEnabled(true)

    const expected = {
      openAtLogin: true,
      path: 'C:\\Program Files\\Hronaut\\Hronaut.exe',
      args: [STARTUP_LAUNCH_ARGUMENT]
    }
    expect(setLoginItemSettings).toHaveBeenCalledWith(expected)
    expect(getLoginItemSettings).toHaveBeenCalledWith({ path: expected.path, args: expected.args })
  })

  it('rejects unavailable or unverifiable login-item registration', async () => {
    const unpackaged = new StartupLaunchManager({
      platform: 'linux', isPackaged: false, executablePath: '/tmp/hronaut', autostartDirectory: '/tmp/unused'
    })
    await expect(unpackaged.setEnabled(true)).rejects.toThrow(/packaged/i)

    const setRejectedLoginItem = vi.fn()
    const rejected = new StartupLaunchManager({
      platform: 'darwin', isPackaged: true, executablePath: '/Applications/Hronaut.app', autostartDirectory: 'unused',
      nativeLoginItems: {
        setLoginItemSettings: setRejectedLoginItem,
        getLoginItemSettings: vi.fn(() => ({ openAtLogin: false, wasOpenedAtLogin: false }))
      }
    })
    await expect(rejected.setEnabled(true)).rejects.toThrow(/could not enable/i)
    expect(setRejectedLoginItem).toHaveBeenLastCalledWith({ openAtLogin: false })
  })

  it('recognizes automatic launches without hiding ordinary launches', () => {
    expect(shouldStartMinimized(
      { launchAtStartup: true, launchMinimized: true },
      { platform: 'linux', argv: ['hronaut', STARTUP_LAUNCH_ARGUMENT] }
    )).toBe(true)
    expect(shouldStartMinimized(
      { launchAtStartup: true, launchMinimized: true },
      { platform: 'linux', argv: ['hronaut'] }
    )).toBe(false)
    expect(shouldStartMinimized(
      { launchAtStartup: false, launchMinimized: true },
      { platform: 'linux', argv: ['hronaut', STARTUP_LAUNCH_ARGUMENT] }
    )).toBe(false)
    expect(shouldStartMinimized(
      { launchAtStartup: true, launchMinimized: true },
      { platform: 'darwin', argv: ['hronaut'], wasOpenedAtLogin: true }
    )).toBe(true)
  })

  it('keeps macOS launches visible when native login provenance is unavailable', () => {
    const error = new Error('login item service unavailable')
    const warn = vi.fn()
    const manager = new StartupLaunchManager({
      platform: 'darwin',
      isPackaged: true,
      executablePath: '/Applications/Hronaut.app/Contents/MacOS/Hronaut',
      autostartDirectory: 'unused',
      nativeLoginItems: {
        setLoginItemSettings: vi.fn(),
        getLoginItemSettings: vi.fn(() => { throw error })
      },
      warn
    })

    expect(manager.wasOpenedAtLogin()).toBe(false)
    expect(warn).toHaveBeenCalledWith('Could not determine whether Hronaut was opened at sign-in', error)
  })
})
