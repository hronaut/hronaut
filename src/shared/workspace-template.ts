import { isBrowserTabGroupColor, type BrowserTabGroupColor } from './tab-groups.js'

export const WORKSPACE_TEMPLATE_MAX_BYTES = 256 * 1024
export const WORKSPACE_TEMPLATE_MAX_WORKSPACES = 20
export const WORKSPACE_TEMPLATE_MAX_START_PAGES = 20

export interface WorkspaceTemplateEntry {
  name: string
  color: BrowserTabGroupColor
  startPages: string[]
}

export interface WorkspaceTemplate {
  format: 'hronaut-workspace-template'
  version: 1
  sourcePlatform: 'windows' | 'macos' | 'linux'
  workspaces: WorkspaceTemplateEntry[]
}

export interface WorkspaceTemplatePreview {
  template: WorkspaceTemplate
  collisions: string[]
  canImport: boolean
}

function record(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid ${label}.`)
  const result = value as Record<string, unknown>
  if (Object.keys(result).some(key => !keys.includes(key))) throw new TypeError(`Unsupported ${label} field.`)
  return result
}

function nameKey(name: string): string {
  return name.trim().normalize('NFKC').toLowerCase()
}

/** Match the parser's collision rules when suggesting an editable default name. */
export function nextWorkspaceTemplateName(entries: Pick<WorkspaceTemplateEntry, 'name'>[]): string {
  const occupied = new Set(entries.map(entry => nameKey(entry.name)))
  let number = entries.length + 1
  while (occupied.has(nameKey(`Workspace ${number}`))) number += 1
  return `Workspace ${number}`
}

function startPage(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/u.test(value)) {
    throw new TypeError('Invalid template start page.')
  }
  let url: URL
  try { url = new URL(value) } catch { throw new TypeError('Invalid template start page.') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('Template start pages require HTTP(S) without URL credentials.')
  }
  // This is format validation, not redaction: paths, queries, fragments, and even
  // hostnames can contain sensitive data. The export UI must require review.
  return url.href
}

/** Parse untrusted file text without creating profiles, navigating, or reading storage. */
export function parseWorkspaceTemplate(text: string): WorkspaceTemplate {
  if (text.length > WORKSPACE_TEMPLATE_MAX_BYTES || new TextEncoder().encode(text).length > WORKSPACE_TEMPLATE_MAX_BYTES) {
    throw new TypeError('Workspace template exceeds the size limit.')
  }
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new TypeError('Workspace template is not valid JSON.') }
  const root = record(parsed, ['format', 'version', 'sourcePlatform', 'workspaces'], 'workspace template')
  if (root.format !== 'hronaut-workspace-template' || root.version !== 1) throw new TypeError('Unsupported workspace template format or version.')
  if (root.sourcePlatform !== 'windows' && root.sourcePlatform !== 'macos' && root.sourcePlatform !== 'linux') {
    throw new TypeError('Invalid template source platform.')
  }
  if (!Array.isArray(root.workspaces) || !root.workspaces.length || root.workspaces.length > WORKSPACE_TEMPLATE_MAX_WORKSPACES) {
    throw new TypeError('Workspace template must contain between 1 and 20 workspaces.')
  }
  const names = new Set<string>()
  const workspaces = root.workspaces.map(value => {
    const entry = record(value, ['name', 'color', 'startPages'], 'workspace entry')
    if (typeof entry.name !== 'string') throw new TypeError('Invalid template workspace name.')
    const name = entry.name.trim().normalize('NFC')
    if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/u.test(name)) throw new TypeError('Invalid template workspace name.')
    if (names.has(nameKey(name))) throw new TypeError('Duplicate template workspace names.')
    names.add(nameKey(name))
    if (!isBrowserTabGroupColor(entry.color)) throw new TypeError('Invalid template workspace color.')
    if (!Array.isArray(entry.startPages) || entry.startPages.length > WORKSPACE_TEMPLATE_MAX_START_PAGES) {
      throw new TypeError('Invalid template start pages.')
    }
    const pages = entry.startPages.map(startPage)
    if (new Set(pages).size !== pages.length) throw new TypeError('Duplicate template start pages.')
    return { name, color: entry.color, startPages: pages }
  })
  return { format: 'hronaut-workspace-template', version: 1, sourcePlatform: root.sourcePlatform, workspaces }
}

/** Existing names must include active and archived workspaces. Recheck at commit. */
export function previewWorkspaceTemplate(text: string, existingNames: Iterable<string>): WorkspaceTemplatePreview {
  const template = parseWorkspaceTemplate(text)
  const occupied = new Set([...existingNames].map(nameKey))
  const collisions = template.workspaces.filter(entry => occupied.has(nameKey(entry.name))).map(entry => entry.name)
  return { template, collisions, canImport: collisions.length === 0 }
}

export interface WorkspaceTemplateImportResult {
  status: 'completed' | 'rolled-back' | 'partial'
  workspaceIds: string[]
}
