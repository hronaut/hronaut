import { createHash } from 'node:crypto'
import type { Session, WebContents } from 'electron'
import { redactNetworkUrl } from '../../../shared/network-details.js'
import { snapshotDeltaInvalidationReason } from '../../../shared/snapshot-delta.js'
import {
  MAX_STORAGE_CHANGE_VALUE_BYTES,
  MAX_STORAGE_CHANGE_VALUES_TOTAL_BYTES,
  MAX_STORAGE_SNAPSHOT_ITEMS_PER_KIND,
  STORAGE_CHANGES_CAVEATS,
  compareBrowserStorageSnapshots,
  type BrowserStorageSnapshot,
  type BrowserStorageSnapshotEntry
} from '../../../shared/storage-changes.js'
import type { BrowserStorageChangesAction, BrowserStorageChangesReport } from '../../../shared/types.js'
import { utf8Prefix } from '../../../shared/utf8.js'
import { StorageComparisonInputError, type StorageComparisonHooks } from '../storage-comparison-operation.js'
import type { SiteStorageAccess, SiteStorageTab } from './site-storage-access.js'

/** Records, compares or clears the tab's in-memory storage baseline for its origin. */
export async function storageChanges<Tab extends SiteStorageTab>(
  access: SiteStorageAccess<Tab>,
  action: BrowserStorageChangesAction = 'get',
  tabId?: string,
  includeValues = false,
  hooks?: StorageComparisonHooks
): Promise<BrowserStorageChangesReport> {
  const tab = access.getTab(tabId)
  const pageUrl = new URL(tab.url)
  const origin = pageUrl.origin
  const contents = tab.webContents
  const storageSession = contents.session
  const url = tab.url
  const context = access.snapshotDeltaContext(tab)
  const workspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
  const permissionGeneration = workspace ? access.inspectionPermission(workspace) ?? 0 : 0
  let comparison = tab.storageComparison
  let operationGeneration = tab.storageComparisonGeneration
  let documentCommitted = false
  let rejected = false
  let retained = false
  const onDocumentCommit = (): void => { documentCommitted = true }
  const dispose = (): void => { contents.removeListener('did-navigate', onDocumentCommit) }
  const requireCurrentOperation = (): void => {
    if (!rejected) {
      try {
        hooks?.validate()
        const currentWorkspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
        if (access.isDestroyed() || access.findTab(tab.id) !== tab || tab.webContents !== contents
          || contents.isDestroyed() || contents.session !== storageSession || tab.url !== url
          || currentWorkspace !== workspace
          || (currentWorkspace ? access.inspectionPermission(currentWorkspace) ?? 0 : 0) !== permissionGeneration
          || snapshotDeltaInvalidationReason(context, access.snapshotDeltaContext(tab))
          || documentCommitted || tab.storageComparisonGeneration !== operationGeneration
          || tab.storageComparison !== comparison) throw new Error('Storage comparison context changed')
        return
      } catch { rejected = true }
    }
    throw new Error('Storage comparison changed while the page snapshot was pending. Run the requested action again.')
  }
  const recordChange = (): void => {
    comparison = tab.storageComparison
    operationGeneration = tab.storageComparisonGeneration
    hooks?.comparisonChanged()
  }

  // Retain the commit listener through MCP audit settlement and publication.
  // Trusted UI callers dispose it after their own synchronous report creation.
  contents.on('did-navigate', onDocumentCommit)
  try {
    hooks?.retainPublication({ validate: requireCurrentOperation, dispose })
    retained = hooks !== undefined
    requireCurrentOperation()
    hooks?.started()
    if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') throw new StorageComparisonInputError('UNSUPPORTED_SCHEME')
    if (comparison && comparison.baseline.origin !== origin) {
      tab.storageComparisonGeneration += 1
      tab.storageComparison = undefined
      recordChange()
    }
    if (action === 'clear') {
      tab.storageComparisonGeneration += 1
      const changed = tab.storageComparison !== undefined
      tab.storageComparison = undefined
      operationGeneration = tab.storageComparisonGeneration
      if (changed) recordChange()
    } else if (action !== 'get') {
      if (action === 'compare' && !comparison) throw new StorageComparisonInputError('BASELINE_REQUIRED')
      operationGeneration = ++tab.storageComparisonGeneration
      const snapshot = await captureStorageSnapshot(contents, storageSession, url, origin, requireCurrentOperation)
      requireCurrentOperation()
      if (action === 'baseline') tab.storageComparison = { baseline: snapshot }
      else if (comparison) comparison.current = snapshot
      recordChange()
    }
    requireCurrentOperation()
    return storageChangesReport(tab, origin, action, includeValues)
  } finally {
    if (!retained) dispose()
  }
}

function storageChangesReport(
  tab: SiteStorageTab,
  origin: string,
  action: BrowserStorageChangesAction,
  includeValues: boolean
): BrowserStorageChangesReport {
  const comparison = tab.storageComparison
  const caveats = [
    STORAGE_CHANGES_CAVEATS.baseline,
    STORAGE_CHANGES_CAVEATS.scope,
    includeValues ? STORAGE_CHANGES_CAVEATS.valuesIncluded : STORAGE_CHANGES_CAVEATS.valuesOmitted,
    STORAGE_CHANGES_CAVEATS.snapshot
  ]
  if (!comparison) {
    return {
      tabId: tab.id,
      url: redactNetworkUrl(tab.url),
      origin,
      action,
      status: 'empty',
      changeCount: 0,
      counts: { added: 0, updated: 0, removed: 0 },
      changes: [],
      valuesIncluded: includeValues,
      caveats
    }
  }
  if (!comparison.current) {
    return {
      tabId: tab.id,
      url: redactNetworkUrl(tab.url),
      origin,
      action,
      status: 'baseline',
      baselineAt: comparison.baseline.capturedAt,
      baselineItemCounts: comparison.baseline.itemCounts,
      changeCount: 0,
      counts: { added: 0, updated: 0, removed: 0 },
      changes: [],
      valuesIncluded: includeValues,
      ...(comparison.baseline.truncated ? { truncated: true } : {}),
      caveats
    }
  }
  const result = compareBrowserStorageSnapshots(comparison.baseline, comparison.current, includeValues)
  return {
    tabId: tab.id,
    url: redactNetworkUrl(tab.url),
    origin,
    action,
    status: 'compared',
    baselineAt: comparison.baseline.capturedAt,
    comparedAt: comparison.current.capturedAt,
    baselineItemCounts: comparison.baseline.itemCounts,
    currentItemCounts: comparison.current.itemCounts,
    changeCount: result.changeCount,
    counts: result.counts,
    changes: result.changes,
    valuesIncluded: includeValues,
    ...(result.truncated ? { truncated: true } : {}),
    caveats
  }
}

async function captureStorageSnapshot(
  contents: WebContents,
  storageSession: Session,
  url: string,
  origin: string,
  requireCurrentOperation: () => void
): Promise<BrowserStorageSnapshot> {
  requireCurrentOperation()
  const domStorage = await contents.executeJavaScript(`(() => {
      const limit = ${MAX_STORAGE_SNAPSHOT_ITEMS_PER_KIND};
      const previewLimit = ${MAX_STORAGE_CHANGE_VALUE_BYTES};
      const fingerprint = (value) => {
        let first = 2166136261;
        let second = 2246822519;
        for (let index = 0; index < value.length; index += 1) {
          const code = value.charCodeAt(index);
          first = Math.imul(first ^ code, 16777619);
          second = Math.imul(second ^ code, 3266489917);
        }
        return [first >>> 0, second >>> 0, value.length].join(':');
      };
      const read = (storage) => {
        const values = [];
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (key !== null) values.push([key, storage.getItem(key) ?? '']);
        }
        values.sort((left, right) => left[0].localeCompare(right[0]));
        return {
          itemCount: values.length,
          entries: values.slice(0, limit).map(([key, value]) => ({
            key,
            fingerprint: fingerprint(value),
            valueBytes: new TextEncoder().encode(value).byteLength,
            valuePreview: value.slice(0, previewLimit)
          }))
        };
      };
      return { local: read(localStorage), session: read(sessionStorage) };
    })()`, false) as {
    local: { itemCount: number; entries: Array<{ key: string; fingerprint: string; valueBytes: number; valuePreview: string }> }
    session: { itemCount: number; entries: Array<{ key: string; fingerprint: string; valueBytes: number; valuePreview: string }> }
  }
  requireCurrentOperation()
  const cookies = await storageSession.cookies.get({ url })
  requireCurrentOperation()
  const cookieEntries = cookies.map((cookie) => {
    const partitionKey = 'partitionKey' in cookie && cookie.partitionKey
      ? JSON.stringify(cookie.partitionKey)
      : undefined
    return {
      key: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expirationDate,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
      protected: cookie.httpOnly || undefined,
      partitionKey
    }
  }).sort((left, right) => left.key.localeCompare(right.key)
    || (left.domain ?? '').localeCompare(right.domain ?? '')
    || (left.path ?? '').localeCompare(right.path ?? '')
    || (left.partitionKey ?? '').localeCompare(right.partitionKey ?? ''))

  let remainingPreviewBytes = MAX_STORAGE_CHANGE_VALUES_TOTAL_BYTES
  const boundedPreview = (value: string): { valuePreview?: string; valuePreviewTruncated?: boolean } => {
    if (remainingPreviewBytes <= 0) return value ? { valuePreviewTruncated: true } : { valuePreview: '' }
    const buffer = Buffer.from(value, 'utf8')
    const allowed = Math.min(MAX_STORAGE_CHANGE_VALUE_BYTES, remainingPreviewBytes)
    const preview = utf8Prefix(buffer, allowed)
    const bytes = Buffer.byteLength(preview, 'utf8')
    remainingPreviewBytes -= bytes
    return {
      valuePreview: preview,
      ...(bytes < buffer.length ? { valuePreviewTruncated: true } : {})
    }
  }
  const domEntries = (
    kind: 'local-storage' | 'session-storage',
    values: Array<{ key: string; fingerprint: string; valueBytes: number; valuePreview: string }>
  ): BrowserStorageSnapshotEntry[] => values.map((entry) => {
    const preview = boundedPreview(entry.valuePreview)
    return {
      kind,
      key: entry.key,
      fingerprint: `dom:${entry.fingerprint}`,
      valueBytes: entry.valueBytes,
      ...preview,
      ...(entry.valueBytes > Buffer.byteLength(preview.valuePreview ?? '', 'utf8') ? { valuePreviewTruncated: true } : {})
    }
  })
  const entries: BrowserStorageSnapshotEntry[] = [
    ...domEntries('local-storage', domStorage.local.entries),
    ...domEntries('session-storage', domStorage.session.entries),
    ...cookieEntries.slice(0, MAX_STORAGE_SNAPSHOT_ITEMS_PER_KIND).map((cookie): BrowserStorageSnapshotEntry => ({
      kind: 'cookies',
      key: cookie.key,
      fingerprint: `cookie:${createHash('sha256').update(cookie.value).digest('hex')}`,
      valueBytes: Buffer.byteLength(cookie.value, 'utf8'),
      ...(cookie.protected ? {} : boundedPreview(cookie.value)),
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
      protected: cookie.protected,
      partitionKey: cookie.partitionKey
    }))
  ]
  return {
    origin,
    capturedAt: new Date().toISOString(),
    entries,
    itemCounts: {
      'local-storage': domStorage.local.itemCount,
      'session-storage': domStorage.session.itemCount,
      cookies: cookies.length
    },
    truncated: domStorage.local.itemCount > MAX_STORAGE_SNAPSHOT_ITEMS_PER_KIND
      || domStorage.session.itemCount > MAX_STORAGE_SNAPSHOT_ITEMS_PER_KIND
      || cookies.length > MAX_STORAGE_SNAPSHOT_ITEMS_PER_KIND
  }
}
