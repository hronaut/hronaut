import { describe, expect, it } from 'vitest'
import { parseWorkspaceTemplate, previewWorkspaceTemplate, WORKSPACE_TEMPLATE_MAX_BYTES } from '../src/shared/workspace-template.js'

function manifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ format: 'hronaut-workspace-template', version: 1, sourcePlatform: 'linux', workspaces: [{ name: 'Demo', color: 'blue', startPages: ['https://example.com/'] }], ...overrides })
}

describe('portable workspace template input', () => {
  it.each(['linux', 'windows', 'macos'])('accepts the same portable setup from %s', sourcePlatform => {
    expect(parseWorkspaceTemplate(manifest({ sourcePlatform })).workspaces[0]).toEqual({ name: 'Demo', color: 'blue', startPages: ['https://example.com/'] })
  })
  it.each(['null', '[]', '{', '"a"'])('rejects malformed root %s', text => {
    expect(() => parseWorkspaceTemplate(text)).toThrow()
  })
  it.each([0, 2, '1', null])('rejects unsupported version %s', version => {
    expect(() => parseWorkspaceTemplate(manifest({ version }))).toThrow('Unsupported')
  })
  it.each(['cookies', 'localStorage', 'storageId', 'resumeKey', 'credentials', 'sourceWorkspaceId', '__proto__'])('rejects unexpected field %s at either level', key => {
    expect(() => parseWorkspaceTemplate(manifest({ [key]: 'sensitive' }))).toThrow('Unsupported')
    expect(() => parseWorkspaceTemplate(manifest({ workspaces: [{ name: 'Demo', color: 'blue', startPages: [], [key]: 'sensitive' }] }))).toThrow('Unsupported')
  })
  it.each(['file:///tmp/profile', 'javascript:alert(1)', 'data:text/html,test', 'https://user:secret@example.com/', 'https://example.com/\nprivate'])('rejects nonportable or credential URL %s', url => {
    expect(() => parseWorkspaceTemplate(manifest({ workspaces: [{ name: 'Demo', color: 'blue', startPages: [url] }] }))).toThrow()
  })
  it('checks actual UTF-8 byte size', () => {
    expect(() => parseWorkspaceTemplate(' '.repeat(WORKSPACE_TEMPLATE_MAX_BYTES + 1))).toThrow('size limit')
    const text = manifest({ workspaces: [{ name: 'é'.repeat(WORKSPACE_TEMPLATE_MAX_BYTES / 2), color: 'blue', startPages: [] }] })
    expect(text.length).toBeLessThan(WORKSPACE_TEMPLATE_MAX_BYTES)
    expect(() => parseWorkspaceTemplate(text)).toThrow('size limit')
  })
  it('rejects equivalent duplicate names using runtime collision semantics', () => {
    expect(() => parseWorkspaceTemplate(manifest({ workspaces: [
      { name: ' Demo ', color: 'blue', startPages: [] },
      { name: 'ＤＥＭＯ', color: 'green', startPages: [] }
    ] }))).toThrow('Duplicate')
  })
  it('reports collisions without mutating the existing names or input', () => {
    const existing = ['Other', 'ＤＥＭＯ']
    const text = manifest()
    const preview = previewWorkspaceTemplate(text, existing)
    expect(preview).toMatchObject({ canImport: false, collisions: ['Demo'] })
    expect(existing).toEqual(['Other', 'ＤＥＭＯ'])
    expect(text).toBe(manifest())
    expect(previewWorkspaceTemplate(text, ['Other'])).toMatchObject({ canImport: true, collisions: [] })
  })
  it('bounds counts and detects canonical duplicate start pages', () => {
    const entry = { name: 'Demo', color: 'blue', startPages: [] }
    expect(() => parseWorkspaceTemplate(manifest({ workspaces: [] }))).toThrow()
    expect(() => parseWorkspaceTemplate(manifest({ workspaces: Array(21).fill(entry) }))).toThrow()
    expect(() => parseWorkspaceTemplate(manifest({ workspaces: [{ ...entry, startPages: ['https://example.com', 'https://example.com/'] }] }))).toThrow('Duplicate')
    expect(() => parseWorkspaceTemplate(manifest({ workspaces: [{ ...entry, startPages: Array(21).fill('https://example.com') }] }))).toThrow()
  })
})
