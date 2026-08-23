import { describe, expect, it } from 'vitest'
import { updateErrorMessage } from '../src/shared/update-errors.js'

describe('update error messages', () => {
  it.each([126, 127])('explains a failed Linux authorization (exit %s) without exposing the command', (exitCode) => {
    expect(updateErrorMessage(new Error(`Command pkexec exited with code ${exitCode}`), 'install', 'linux')).toBe(
      'System authorization did not complete. Hronaut is still running; try the installation again.'
    )
  })

  it('keeps unrelated updater errors intact', () => {
    expect(updateErrorMessage(new Error('Network request failed'), 'check', 'linux')).toBe('Network request failed')
  })

  it.each(['check', 'download'] as const)('explains an incompatible Linux updater manifest during %s', (operation) => {
    expect(updateErrorMessage(new TypeError("Cannot read properties of undefined (reading 'info')"), operation, 'linux')).toBe(
      'This release has no update package compatible with this Linux installation. Use the matching package from the Hronaut release page.'
    )
  })

  it('does not reinterpret the same command failure on another platform', () => {
    expect(updateErrorMessage(new Error('Command pkexec exited with code 127'), 'install', 'win32')).toBe(
      'Command pkexec exited with code 127'
    )
  })
})
