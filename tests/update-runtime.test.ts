import { describe, expect, it } from 'vitest'
import { canStartUpdateOperation, replacedPackageVersion } from '../src/shared/update-runtime.js'

describe('update operation policy', () => {
  it('allows only the operation represented by the current update state', () => {
    expect(canStartUpdateOperation('error', null, 'check')).toBe(true)
    expect(canStartUpdateOperation('available', null, 'download')).toBe(true)
    expect(canStartUpdateOperation('downloaded', null, 'install')).toBe(true)
    expect(canStartUpdateOperation('install-error', null, 'install')).toBe(true)
  })

  it('never downloads from a generic error without fresh update information', () => {
    expect(canStartUpdateOperation('error', null, 'download')).toBe(false)
    expect(canStartUpdateOperation('up-to-date', null, 'download')).toBe(false)
  })

  it.each(['check', 'download', 'install'] as const)('blocks %s while another updater operation owns the state', (operation) => {
    expect(canStartUpdateOperation('available', 'download', operation)).toBe(false)
  })
})

describe('running update replacement detection', () => {
  it('detects when a Linux package replaced the app beneath the running process', () => {
    expect(replacedPackageVersion('2.14.0', JSON.stringify({ version: '2.15.0' }))).toBe('2.15.0')
  })

  it('does not restart when the running and on-disk versions match', () => {
    expect(replacedPackageVersion('2.15.0', JSON.stringify({ version: '2.15.0' }))).toBeNull()
  })

  it.each([
    '',
    'not json',
    JSON.stringify({}),
    JSON.stringify({ version: '../unsafe' })
  ])('ignores an invalid package manifest: %s', (manifest) => {
    expect(replacedPackageVersion('2.15.0', manifest)).toBeNull()
  })
})
