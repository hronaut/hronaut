import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  LINUX_UPDATE_RELAUNCH_SCRIPT,
  linuxUpdateExecutable,
  scheduleLinuxUpdateRelaunch,
  updaterShouldAutoRunAfterInstall,
  type SpawnUpdateRelaunch
} from '../src/main/linux-update-relaunch.js'

describe('Linux update relaunch handoff', () => {
  it('waits for the old single-instance owner before starting the installed executable', () => {
    const once = vi.fn()
    const unref = vi.fn()
    const spawnProcess = vi.fn(() => ({ once, unref })) as unknown as SpawnUpdateRelaunch

    scheduleLinuxUpdateRelaunch(4321, '/opt/Hronaut/hronaut', '/usr/share/applications/Hronaut.desktop', spawnProcess)

    expect(spawnProcess).toHaveBeenCalledOnce()
    const [command, args, options] = vi.mocked(spawnProcess).mock.calls[0]!
    expect(command).toBe('/bin/sh')
    expect(args).toEqual([
      '-c',
      LINUX_UPDATE_RELAUNCH_SCRIPT,
      'hronaut-update-relaunch',
      '4321',
      '/opt/Hronaut/hronaut',
      '/usr/share/applications/Hronaut.desktop'
    ])
    expect(options).toMatchObject({ detached: true, stdio: 'ignore' })
    expect(LINUX_UPDATE_RELAUNCH_SCRIPT).toContain('while kill -0 "$old_pid"')
    expect(LINUX_UPDATE_RELAUNCH_SCRIPT).toContain('exec /usr/bin/gio launch "$desktop_file"')
    expect(LINUX_UPDATE_RELAUNCH_SCRIPT).toContain('exec "$executable"')
    expect(once).toHaveBeenCalledWith('error', expect.any(Function))
    expect(unref).toHaveBeenCalledOnce()
  })

  it('uses the persistent AppImage path and otherwise the Electron executable', () => {
    expect(linuxUpdateExecutable({ APPIMAGE: '/apps/Hronaut.AppImage' }, '/tmp/.mount/hronaut')).toBe('/apps/Hronaut.AppImage')
    expect(linuxUpdateExecutable({}, '/opt/Hronaut/hronaut')).toBe('/opt/Hronaut/hronaut')
  })

  it('disables electron-updater immediate relaunch only on Linux', () => {
    expect(updaterShouldAutoRunAfterInstall('linux')).toBe(false)
    expect(updaterShouldAutoRunAfterInstall('darwin')).toBe(true)
    expect(updaterShouldAutoRunAfterInstall('win32')).toBe(true)
  })

  it('does not launch the replacement until the old process exits', async () => {
    const blocker = spawn('/bin/sh', ['-c', 'sleep 0.25'], { stdio: 'ignore' })
    if (!blocker.pid) throw new Error('Could not start the update handoff fixture')
    const startedAt = Date.now()
    const helper = spawn('/bin/sh', [
      '-c',
      LINUX_UPDATE_RELAUNCH_SCRIPT,
      'hronaut-update-relaunch-test',
      String(blocker.pid),
      '/usr/bin/true',
      '/missing/Hronaut.desktop'
    ], { stdio: 'ignore' })

    const [exitCode] = await once(helper, 'exit')
    expect(exitCode).toBe(0)
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(180)
  })

  it('passes shell metacharacters in the executable path as literal filename characters', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-relaunch-'))
    const executable = join(directory, 'Hronaut ; touch injected $(bad) $.sh')
    const marker = join(directory, 'launched')
    const injected = join(directory, 'injected')
    try {
      await writeFile(executable, `#!/bin/sh\nprintf launched > '${marker}'\n`, { mode: 0o755 })
      await chmod(executable, 0o755)
      const helper = spawn('/bin/sh', [
        '-c',
        LINUX_UPDATE_RELAUNCH_SCRIPT,
        'hronaut-update-relaunch-metacharacter-test',
        '2147483647',
        executable,
        join(directory, 'missing.desktop')
      ], { stdio: 'ignore' })

      const [exitCode] = await once(helper, 'exit')
      expect(exitCode).toBe(0)
      await expect(readFile(marker, 'utf8')).resolves.toBe('launched')
      await expect(readFile(injected, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects unsafe relaunch targets', () => {
    const spawnProcess = vi.fn() as unknown as SpawnUpdateRelaunch
    expect(() => scheduleLinuxUpdateRelaunch(0, '/opt/Hronaut/hronaut', '/usr/share/applications/Hronaut.desktop', spawnProcess)).toThrow('Invalid Hronaut process ID')
    expect(() => scheduleLinuxUpdateRelaunch(123, 'relative/hronaut', '/usr/share/applications/Hronaut.desktop', spawnProcess)).toThrow('absolute executable path')
    expect(() => scheduleLinuxUpdateRelaunch(123, '/opt/Hronaut/hronaut', 'Hronaut.desktop', spawnProcess)).toThrow('absolute desktop-file path')
    expect(spawnProcess).not.toHaveBeenCalled()
  })
})
