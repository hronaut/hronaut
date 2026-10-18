import type { CommandLine } from 'electron'

/**
 * Turns on Chromium's own WebMCP for pages before Electron is ready, unless the command line already disables it.
 *
 * Electron 44 ships Chromium's native WebMCP implementation behind the same
 * feature gate as Chrome's local testing flag. Enable only the browser-native
 * API; Hronaut never injects a page polyfill. An explicit Chromium disable
 * switch remains authoritative for troubleshooting or enterprise policy.
 */
export function enableNativeWebMcp(commandLine: Pick<CommandLine, 'getSwitchValue' | 'appendSwitch'>): void {
  const disabledChromiumFeatures = new Set(
    commandLine.getSwitchValue('disable-features').split(',').map(value => value.trim()).filter(Boolean)
  )
  if (!disabledChromiumFeatures.has('WebMCP')) {
    const enabledChromiumFeatures = new Set(
      commandLine.getSwitchValue('enable-features').split(',').map(value => value.trim()).filter(Boolean)
    )
    enabledChromiumFeatures.add('WebMCP')
    commandLine.appendSwitch('enable-features', [...enabledChromiumFeatures].join(','))
  }
}
