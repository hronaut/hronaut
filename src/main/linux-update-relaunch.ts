import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

const RELAUNCH_WAIT_LIMIT = 300

export const LINUX_UPDATE_RELAUNCH_SCRIPT = `
old_pid="$1"
executable="$2"
desktop_file="$3"
attempt=0
while kill -0 "$old_pid" 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge ${RELAUNCH_WAIT_LIMIT} ]; then
    exit 1
  fi
  sleep 0.1
done
# Re-enter through the desktop launcher so the replacement belongs to the
# graphical login session. A directly exec'd detached child may be unable to
# reach that session's PolicyKit authentication agent on the next .deb update.
if [ -x /usr/bin/gio ] && [ -f "$desktop_file" ]; then
  exec /usr/bin/gio launch "$desktop_file"
fi
exec "$executable"
`.trim()

export type SpawnUpdateRelaunch = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => Pick<ChildProcess, 'once' | 'unref'>

export function scheduleLinuxUpdateRelaunch(
  oldPid: number,
  executable: string,
  desktopFile = '/usr/share/applications/Hronaut.desktop',
  spawnProcess: SpawnUpdateRelaunch = spawn
): void {
  if (!Number.isSafeInteger(oldPid) || oldPid <= 0) throw new TypeError('Invalid Hronaut process ID')
  if (!executable.startsWith('/')) throw new TypeError('Linux update relaunch requires an absolute executable path')
  if (!desktopFile.startsWith('/')) throw new TypeError('Linux update relaunch requires an absolute desktop-file path')

  const helper = spawnProcess(
    '/bin/sh',
    ['-c', LINUX_UPDATE_RELAUNCH_SCRIPT, 'hronaut-update-relaunch', String(oldPid), executable, desktopFile],
    {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env }
    }
  )
  helper.once('error', (error) => console.error('[updates] Could not start the post-update relaunch helper:', error))
  helper.unref()
}

export function linuxUpdateExecutable(environment: NodeJS.ProcessEnv, electronExecutable: string): string {
  const appImage = environment.APPIMAGE
  return appImage?.startsWith('/') ? appImage : electronExecutable
}

export function updaterShouldAutoRunAfterInstall(platform: NodeJS.Platform): boolean {
  return platform !== 'linux'
}
