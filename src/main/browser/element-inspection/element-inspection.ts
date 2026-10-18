import { randomUUID } from 'node:crypto'
import { normalizeCssProperties, unavailableCssProvenance } from '../../../shared/css-provenance.js'
import { normalizeElementInspection } from '../../../shared/element-inspection.js'
import { unavailableRenderedFonts } from '../../../shared/rendered-fonts.js'
import { snapshotDeltaInvalidationReason } from '../../../shared/snapshot-delta.js'
import type {
  BrowserElementInspection,
  BrowserElementInspectionOptions,
  BrowserImageState,
  BrowserMediaState
} from '../../../shared/types.js'
import { MAX_COMPARED_TEXT_VALUE_LENGTH } from '../../../shared/value-comparison.js'
import { collectCssProvenance } from '../css-provenance.js'
import type { PendingElementInspection } from '../element-inspection-publication.js'
import { sizingInputsSettlementScript } from '../element-sizing-inputs.js'
import { formValiditySettlementScript } from '../form-validity.js'
import { IMAGE_STATE_WORLD_ID, imageStateScript, imageStateSettlementScript, normalizeImageState } from '../image-state.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { MEDIA_STATE_WORLD_ID, mediaStateScript, mediaStateSettlementScript, normalizeMediaState } from '../media-state.js'
import { elementInspectionScript } from '../page-scripts.js'
import { passwordOccupancySettlementScript } from '../password-occupancy.js'
import { isHronautHomeUrl } from '../url.js'
import { valueComparisonSettlementScript } from '../value-comparison.js'
import type { ElementInspectionAccess, ElementInspectionTab } from './element-inspection-access.js'

const ELEMENT_INSPECTION_WORLD_ID = ISOLATED_WORLDS.elementInspection

/**
 * Inspects one element of the tab, optionally with CSS provenance, rendered
 * fonts or one guarded reading (password occupancy, form validity, sizing
 * inputs or value comparison) whose publication can be deferred to the caller.
 */
export async function elementInspection<Tab extends ElementInspectionTab>(access: ElementInspectionAccess<Tab>, options: BrowserElementInspectionOptions, validateInspection?: () => void, deferInspection?: (pending: PendingElementInspection) => void): Promise<BrowserElementInspection> {
  if (options.includePasswordOccupancy !== undefined && typeof options.includePasswordOccupancy !== 'boolean') throw new TypeError('includePasswordOccupancy must be a boolean')
  const occupancy = options.includePasswordOccupancy === true
  if (options.includeValidity !== undefined && typeof options.includeValidity !== 'boolean') throw new TypeError('includeValidity must be a boolean')
  const validity = options.includeValidity === true
  if (validity && (options.ref !== undefined || !options.selector)) throw new Error('Form validity requires a unique selector; snapshot refs are unsupported')
  if (validity && (occupancy || options.cssProperties !== undefined || options.includeFonts === true)) throw new Error('Form validity cannot be combined with password occupancy, CSS provenance or rendered fonts')
  if (options.includeSizingInputs !== undefined && typeof options.includeSizingInputs !== 'boolean') throw new TypeError('includeSizingInputs must be a boolean')
  if (options.includeFlexContainer !== undefined && typeof options.includeFlexContainer !== 'boolean') throw new TypeError('includeFlexContainer must be a boolean')
  // The parent's flex context is read with the item's sizing inputs, under the same guard.
  const sizing = options.includeSizingInputs === true || options.includeFlexContainer === true
  if (sizing && (options.ref !== undefined || typeof options.selector !== 'string' || !options.selector.trim() || options.selector.length > 1000)) throw new Error('Sizing inputs require a unique selector; snapshot refs are unsupported')
  if (sizing && (validity || occupancy || options.cssProperties !== undefined || options.includeFonts === true)) throw new Error('Sizing inputs cannot combine with validity, occupancy, CSS provenance or fonts')
  const expectedValue = options.expectedValue
  if (expectedValue !== undefined && (typeof expectedValue !== 'string' || expectedValue.length > MAX_COMPARED_TEXT_VALUE_LENGTH)) {
    throw new TypeError(`expectedValue must be a string of at most ${MAX_COMPARED_TEXT_VALUE_LENGTH} UTF-16 code units`)
  }
  const comparison = expectedValue !== undefined
  if (comparison && (options.ref !== undefined || typeof options.selector !== 'string' || !options.selector.trim() || options.selector.length > 1000)) throw new Error('Value comparison requires a unique selector; snapshot refs are unsupported')
  if (comparison && (validity || occupancy || sizing || options.cssProperties !== undefined || options.includeFonts === true)) throw new Error('Value comparison cannot combine with validity, occupancy, sizing inputs, CSS provenance or fonts')
  const guarded = occupancy || validity || sizing || comparison
  const inspectionLabel = sizing ? 'Sizing inputs' : validity ? 'Form validity' : comparison ? 'Value comparison' : 'Password occupancy'
  const settlementScript = sizing ? sizingInputsSettlementScript : validity ? formValiditySettlementScript
    : comparison ? valueComparisonSettlementScript : passwordOccupancySettlementScript
  if (occupancy && (options.cssProperties !== undefined || options.includeFonts === true)) throw new Error('Password occupancy cannot be combined with CSS provenance or rendered fonts')
  const inspectionToken = guarded ? randomUUID() : undefined
  const properties = normalizeCssProperties(options.cssProperties)
  if (options.includeFonts !== undefined && typeof options.includeFonts !== 'boolean') throw new TypeError('includeFonts must be a boolean')
  if (options.includeScroll !== undefined && typeof options.includeScroll !== 'boolean') throw new TypeError('includeScroll must be a boolean')
  const includeFonts = options.includeFonts === true
  const tab = access.getTab(options.tabId)
  if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before inspecting an element')
  if (guarded && (tab.sleeping || tab.wakePromise || tab.pageLifecycleState !== 'active')) throw new Error(`${inspectionLabel} requires an already active tab`)
  access.validateTarget(options)
  const contents = tab.webContents
  let documentChanged = false
  const onCommitted = (): void => { documentChanged = true }
  const deadline = Date.now() + 5_000
  const context = access.snapshotDeltaContext(tab)
  const inspectionWorkspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
  const inspectionPermissionGeneration = inspectionWorkspace ? access.inspectionPermission(inspectionWorkspace) ?? 0 : 0
  const assertCurrent = (): void => {
    validateInspection?.()
    if (sizing && (access.isDestroyed() || documentChanged || tab.webContents !== contents || Date.now() > deadline)) throw new Error('Sizing inspection context changed or expired')
    const currentWorkspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
    if (currentWorkspace !== inspectionWorkspace || (currentWorkspace ? access.inspectionPermission(currentWorkspace) ?? 0 : 0) !== inspectionPermissionGeneration) {
      throw new Error('Workspace permissions changed during element inspection')
    }
    if (guarded && (tab.sleeping || tab.wakePromise || tab.pageLifecycleState !== 'active')) throw new Error(`${inspectionLabel} requires an already active tab`)
    const current = access.findTab(tab.id)
    if (!current || current !== tab || current.webContents.isDestroyed()) {
      throw new Error('The tab changed during element inspection. Inspect the element again.')
    }
    const invalidation = snapshotDeltaInvalidationReason(context, access.snapshotDeltaContext(current))
    if (invalidation) {
      throw new Error(`The observation context changed during element inspection (${invalidation}). Inspect the element again.`)
    }
  }
  const boundedInspection = async <T>(operation: Promise<T>): Promise<T> => {
    if (!guarded) return operation
    let timer: NodeJS.Timeout | undefined
    try {
      const result = await Promise.race([operation, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${inspectionLabel} inspection expired`)), Math.max(1, deadline - Date.now()))
      })])
      if (sizing) assertCurrent()
      return result
    } finally { if (timer) clearTimeout(timer) }
  }
  assertCurrent()
  const slot = sizing ? access.acquireSizingInspectionSlot(contents) : undefined
  try { if (sizing) contents.on('did-navigate', onCommitted) } catch (error) { contents.removeListener('did-navigate', onCommitted); slot?.close(); throw error }
  const execute = (code: string, cleanup = false): Promise<unknown> => {
    if (!sizing) return tab.webContents.executeJavaScriptInIsolatedWorld(ELEMENT_INSPECTION_WORLD_ID, [{ code }], false)
    const operation = Promise.resolve().then(() => {
      if (sizing && !cleanup) assertCurrent()
      return (sizing ? contents : tab.webContents).executeJavaScriptInIsolatedWorld(ELEMENT_INSPECTION_WORLD_ID, [{ code }], false)
    })
    return slot ? slot.track(operation) : operation
  }
  // The expected text is embedded only in the comparison reducer, not in the serialized target.
  const inspect = () => execute(elementInspectionScript({ ...options, expectedValue: undefined } as typeof options, inspectionToken, expectedValue))
  let raw: unknown
  let cssProvenance: BrowserElementInspection['cssProvenance']
  let renderedFonts: BrowserElementInspection['renderedFonts']
  let inspectionSettled = false
  let inspectionDeferred = false
  let discarded = false
  const pendingInspection: PendingElementInspection = {
    assertCurrent,
    finish: async () => {
      if (!inspectionToken) return
      assertCurrent()
      const settled = await boundedInspection(execute(settlementScript(inspectionToken)))
      inspectionSettled = true
      assertCurrent()
      if (settled !== true) throw new Error(`${inspectionLabel} target changed or expired during inspection`)
    },
    discard: () => {
      if (discarded) return
      discarded = true
      if (sizing) contents.removeListener('did-navigate', onCommitted)
      if (slot) {
        slot.close(inspectionToken && !inspectionSettled && !contents.isDestroyed() ? execute(settlementScript(inspectionToken, true), true).catch(() => undefined) : undefined)
        return
      }
      if (inspectionToken && !inspectionSettled && !tab.webContents.isDestroyed()) {
        inspectionSettled = true
        void tab.webContents.executeJavaScriptInIsolatedWorld(ELEMENT_INSPECTION_WORLD_ID, [{ code: settlementScript(inspectionToken, true) }], false).catch(() => undefined)
      }
    }
  }
  try {
    assertCurrent()
    if (properties || includeFonts) {
      // CSS provenance resets this session's DOM bindings, which would drop a CSS state preview.
      const conflict = (): boolean => access.isDevToolsOpening(tab.webContents.id)
        || tab.webContents.isDevToolsOpened()
        || Boolean(tab.codeCoverage?.recording || tab.cpuProfile?.recording)
        || access.cssStatePreviewActive(tab)
      if (conflict()) {
        if (properties) cssProvenance = unavailableCssProvenance(properties, 'debugger-in-use')
        if (includeFonts) renderedFonts = unavailableRenderedFonts('debugger-in-use')
        raw = await inspect()
      } else {
        try {
          const capture = await access.withDebugger(tab.webContents, async () => {
            assertCurrent()
            if (conflict()) throw new Error('CSS provenance debugger is in use')
            const selector = options.ref
              ? '[data-hronaut-ref="' + Array.from(options.ref, character => '\\' + character.codePointAt(0)!.toString(16) + ' ').join('') + '"]'
              : options.selector!
            const keepDomEnabled = Boolean(tab.emulation.renderingDebug && Object.values(tab.emulation.renderingDebug).some(Boolean))
            return collectCssProvenance(tab.webContents, selector, properties ?? [], assertCurrent, keepDomEnabled, inspect, includeFonts)
          })
          raw = capture.inspection
          if (properties) cssProvenance = capture.provenance
          renderedFonts = capture.renderedFonts
        } catch (error) {
          assertCurrent()
          if (!conflict() && !access.isUnavailableCdpMethod(error)) throw error
          if (properties) cssProvenance = unavailableCssProvenance(properties, conflict() ? 'debugger-in-use' : 'unsupported-protocol')
          if (includeFonts) renderedFonts = unavailableRenderedFonts(conflict() ? 'debugger-in-use' : 'unsupported-protocol')
          raw = await inspect()
        }
      }
    } else raw = await boundedInspection(inspect())
    assertCurrent()
    if (deferInspection) {
      deferInspection(pendingInspection)
      inspectionDeferred = true
    } else if (inspectionToken) await pendingInspection.finish()
    return {
      ...normalizeElementInspection({ tabId: tab.id, title: tab.title, url: tab.url, raw }),
      ...(cssProvenance ? { cssProvenance } : {}),
      ...(renderedFonts ? { renderedFonts } : {})
    }
  } finally {
    if (!inspectionDeferred) pendingInspection.discard()
  }
}

/** Reads the playback state of one media element, guarded against observation changes until publication. */
export async function mediaState<Tab extends ElementInspectionTab>(access: ElementInspectionAccess<Tab>, options: { tabId?: string; ref?: never; selector: string }, validateInspection?: () => void, deferInspection?: (pending: PendingElementInspection) => void): Promise<BrowserMediaState> {
  if (Object.hasOwn(options, 'ref')) throw new TypeError('Media state does not support snapshot refs; provide a unique selector')
  if (typeof options.selector !== 'string' || !options.selector.trim() || options.selector.length > 1_000) throw new TypeError('Media state requires a nonempty selector of at most 1000 characters')
  const tab = access.getTab(options.tabId)
  const context = access.snapshotDeltaContext(tab)
  const workspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
  const permissionGeneration = workspace ? access.inspectionPermission(workspace) ?? 0 : 0
  const assertCurrent = (): void => {
    validateInspection?.()
    const currentWorkspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
    if (access.findTab(tab.id) !== tab || tab.webContents.isDestroyed()
      || currentWorkspace !== workspace || (currentWorkspace ? access.inspectionPermission(currentWorkspace) ?? 0 : 0) !== permissionGeneration
      || snapshotDeltaInvalidationReason(context, access.snapshotDeltaContext(tab))) throw new Error('The observation context changed during media inspection')
    if (isHronautHomeUrl(tab.url) || tab.sleeping || tab.wakePromise || tab.pageLifecycleState !== 'active') throw new Error('Media state unavailable: requires an already active website tab')
  }
  assertCurrent()
  const token = randomUUID()
  const deadline = Date.now() + 5_000
  const bounded = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | undefined
    try {
      return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Media state inspection expired')), Math.max(1, deadline - Date.now()))
      })])
    } finally { if (timer) clearTimeout(timer) }
  }
  const execute = (code: string) => tab.webContents.executeJavaScriptInIsolatedWorld(MEDIA_STATE_WORLD_ID, [{ code }], false)
  let settled = false
  let deferred = false
  const pending: PendingElementInspection = {
    assertCurrent,
    finish: async () => {
      assertCurrent()
      const valid = await bounded(execute(mediaStateSettlementScript(token)))
      assertCurrent()
      if (valid !== true) throw new Error('The media target changed before publication')
      settled = true
    },
    discard: () => { if (!settled && !tab.webContents.isDestroyed()) void execute(mediaStateSettlementScript(token, true)).catch(() => undefined) }
  }
  try {
    const raw: unknown = await bounded(execute(mediaStateScript({ selector: options.selector }, token)))
    assertCurrent()
    const report = normalizeMediaState(raw)
    if (deferInspection) { deferInspection(pending); deferred = true } else await pending.finish()
    return report
  } finally { if (!deferred) pending.discard() }
}

/** Reads the load completion and natural size of one image element, guarded against document and observation changes until publication. */
export async function imageState<Tab extends ElementInspectionTab>(access: ElementInspectionAccess<Tab>, options: { tabId?: string; ref?: never; selector: string }, validateInspection?: () => void, deferInspection?: (pending: PendingElementInspection) => void): Promise<BrowserImageState> {
  if (Object.hasOwn(options, 'ref')) throw new TypeError('Image state does not support snapshot refs; provide a unique selector')
  if (typeof options.selector !== 'string' || !options.selector.trim() || options.selector.length > 1_000) throw new TypeError('Image state requires a nonempty selector of at most 1000 characters')
  const tab = access.getTab(options.tabId)
  const contents = tab.webContents
  let documentChanged = false
  const onCommitted = (): void => { documentChanged = true }
  const deadline = Date.now() + 5_000
  const context = access.snapshotDeltaContext(tab)
  const workspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
  const permissionGeneration = workspace ? access.inspectionPermission(workspace) ?? 0 : 0
  const assertCurrent = (): void => {
    validateInspection?.()
    if (Date.now() > deadline) throw new Error('Image state inspection expired')
    const currentWorkspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
    if (access.isDestroyed() || documentChanged || access.findTab(tab.id) !== tab || tab.webContents !== contents || contents.isDestroyed()
      || currentWorkspace !== workspace || (currentWorkspace ? access.inspectionPermission(currentWorkspace) ?? 0 : 0) !== permissionGeneration
      || snapshotDeltaInvalidationReason(context, access.snapshotDeltaContext(tab))) throw new Error('The observation context changed during image inspection')
    if (isHronautHomeUrl(tab.url) || tab.sleeping || tab.wakePromise || tab.pageLifecycleState !== 'active') throw new Error('Image state unavailable: requires an already active website tab')
  }
  assertCurrent()
  const slot = access.acquireImageInspectionSlot(contents)
  contents.on('did-navigate', onCommitted)
  const token = randomUUID()
  const bounded = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | undefined
    try {
      const result = await Promise.race([operation, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Image state inspection expired')), Math.max(1, deadline - Date.now()))
      })])
      if (Date.now() > deadline) throw new Error('Image state inspection expired')
      return result
    } finally { if (timer) clearTimeout(timer) }
  }
  const execute = (code: string, cleanup = false) => slot.track(Promise.resolve().then(async () => {
    if (!cleanup) assertCurrent()
    try { return await contents.executeJavaScriptInIsolatedWorld(IMAGE_STATE_WORLD_ID, [{ code }], false) }
    catch { throw new Error('Image state unavailable: native execution failed') }
  }))
  let discarded = false
  let settled = false
  let deferred = false
  const pending: PendingElementInspection = {
    assertCurrent,
    finish: async () => {
      assertCurrent()
      const valid = await bounded(execute(imageStateSettlementScript(token)))
      assertCurrent()
      if (valid !== true) throw new Error('The image target changed before publication')
      settled = true
    },
    discard: () => {
      if (discarded) return
      discarded = true
      contents.removeListener('did-navigate', onCommitted)
      slot.close(!settled && !contents.isDestroyed() ? execute(imageStateSettlementScript(token, true), true) : undefined)
    }
  }
  try {
    const raw: unknown = await bounded(execute(imageStateScript(options.selector, token, deadline)))
    assertCurrent()
    const report = normalizeImageState(raw)
    if (deferInspection) { deferInspection(pending); deferred = true } else await pending.finish()
    return report
  } finally { if (!deferred) pending.discard() }
}
