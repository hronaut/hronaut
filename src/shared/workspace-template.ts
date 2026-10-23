import { isBrowserTabGroupColor, type BrowserTabGroupColor } from './tab-groups.js'
import { normalizeWorkspaceDescription } from './workspace-description.js'
import { givenWorkspaceName, plainWorkspaceName } from './plain-workspace-name.js'

export const WORKSPACE_TEMPLATE_MAX_BYTES = 256 * 1024
export const WORKSPACE_TEMPLATE_MAX_WORKSPACES = 20
export const WORKSPACE_TEMPLATE_MAX_START_PAGES = 20

/** Why a template is refused, in English; the template editor names each one in the interface language. */
export const WORKSPACE_TEMPLATE_ERRORS = {
  invalidTemplate: 'Invalid workspace template.',
  unsupportedTemplateField: 'Unsupported workspace template field.',
  invalidEntry: 'Invalid workspace entry.',
  unsupportedEntryField: 'Unsupported workspace entry field.',
  tooLarge: 'Workspace template exceeds the size limit.',
  invalidJson: 'Workspace template is not valid JSON.',
  unsupportedFormat: 'Unsupported workspace template format or version.',
  invalidPlatform: 'Invalid template source platform.',
  workspaceCount: 'Workspace template must contain between 1 and 20 workspaces.',
  invalidName: 'Invalid template workspace name.',
  duplicateNames: 'Duplicate template workspace names.',
  invalidDescription: 'Invalid template workspace description.',
  invalidColor: 'Invalid template workspace color.',
  invalidStartPages: 'Invalid template start pages.',
  duplicateStartPages: 'Duplicate template start pages.',
  invalidStartPage: 'Invalid template start page.',
  startPageScheme: 'Template start pages require HTTP(S) without URL credentials.'
} as const

export interface WorkspaceTemplateEntry {
  name: string
  description: string
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

function record(value: unknown, keys: string[], invalid: string, unsupported: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(invalid)
  const result = value as Record<string, unknown>
  if (Object.keys(result).some(key => !keys.includes(key))) throw new TypeError(unsupported)
  return result
}

function nameKey(name: string): string {
  return name.trim().normalize('NFKC').toLowerCase()
}

/** Match the parser's collision rules when suggesting an editable default name, such as the editor's "Workspace 3". */
export function nextWorkspaceTemplateName(
  entries: Pick<WorkspaceTemplateEntry, 'name'>[],
  defaultName: (number: number) => string = number => `Workspace ${number}`
): string {
  const occupied = new Set(entries.map(entry => nameKey(plainWorkspaceName(entry.name))))
  let number = entries.length + 1
  while (occupied.has(nameKey(defaultName(number)))) number += 1
  return defaultName(number)
}

function startPage(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/u.test(value)) {
    throw new TypeError(WORKSPACE_TEMPLATE_ERRORS.invalidStartPage)
  }
  let url: URL
  try { url = new URL(value) } catch { throw new TypeError(WORKSPACE_TEMPLATE_ERRORS.invalidStartPage) }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError(WORKSPACE_TEMPLATE_ERRORS.startPageScheme)
  }
  // This is format validation, not redaction: paths, queries, fragments, and even
  // hostnames can contain sensitive data. The export UI must require review.
  return url.href
}

/** Parse untrusted file text without creating profiles, navigating, or reading storage. */
export function parseWorkspaceTemplate(text: string): WorkspaceTemplate {
  if (text.length > WORKSPACE_TEMPLATE_MAX_BYTES || new TextEncoder().encode(text).length > WORKSPACE_TEMPLATE_MAX_BYTES) {
    throw new TypeError(WORKSPACE_TEMPLATE_ERRORS.tooLarge)
  }
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new TypeError(WORKSPACE_TEMPLATE_ERRORS.invalidJson) }
  const root = record(parsed, ['format', 'version', 'sourcePlatform', 'workspaces'], WORKSPACE_TEMPLATE_ERRORS.invalidTemplate, WORKSPACE_TEMPLATE_ERRORS.unsupportedTemplateField)
  if (root.format !== 'hronaut-workspace-template' || root.version !== 1) throw new TypeError(WORKSPACE_TEMPLATE_ERRORS.unsupportedFormat)
  if (root.sourcePlatform !== 'windows' && root.sourcePlatform !== 'macos' && root.sourcePlatform !== 'linux') {
    throw new TypeError(WORKSPACE_TEMPLATE_ERRORS.invalidPlatform)
  }
  if (!Array.isArray(root.workspaces) || !root.workspaces.length || root.workspaces.length > WORKSPACE_TEMPLATE_MAX_WORKSPACES) {
    throw new TypeError(WORKSPACE_TEMPLATE_ERRORS.workspaceCount)
  }
  const names = new Set<string>()
  const workspaces = root.workspaces.map(value => {
    const entry = record(value, ['name', 'description', 'color', 'startPages'], WORKSPACE_TEMPLATE_ERRORS.invalidEntry, WORKSPACE_TEMPLATE_ERRORS.unsupportedEntryField)
    if (typeof entry.name !== 'string') throw new TypeError(WORKSPACE_TEMPLATE_ERRORS.invalidName)
    // The name the workspace will get, so a collision found at commit is found here too.
    const name = givenWorkspaceName(entry.name)
    if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/u.test(entry.name.trim())) throw new TypeError(WORKSPACE_TEMPLATE_ERRORS.invalidName)
    if (names.has(nameKey(name))) throw new TypeError(WORKSPACE_TEMPLATE_ERRORS.duplicateNames)
    names.add(nameKey(name))
    if (entry.description !== undefined && typeof entry.description !== 'string') throw new TypeError(WORKSPACE_TEMPLATE_ERRORS.invalidDescription)
    const description = normalizeWorkspaceDescription(entry.description ?? '')
    if (!isBrowserTabGroupColor(entry.color)) throw new TypeError(WORKSPACE_TEMPLATE_ERRORS.invalidColor)
    if (!Array.isArray(entry.startPages) || entry.startPages.length > WORKSPACE_TEMPLATE_MAX_START_PAGES) {
      throw new TypeError(WORKSPACE_TEMPLATE_ERRORS.invalidStartPages)
    }
    const pages = entry.startPages.map(startPage)
    if (new Set(pages).size !== pages.length) throw new TypeError(WORKSPACE_TEMPLATE_ERRORS.duplicateStartPages)
    return { name, description, color: entry.color, startPages: pages }
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
