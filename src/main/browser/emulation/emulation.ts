import { DEFAULT_RENDERING_DEBUG } from '../../../shared/browser-environment.js'
import type { BrowserEmulationOptions, BrowserEmulationResult, BrowserEmulationState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import { prepareBrowserEmulation } from '../emulation-state.js'
import { isHronautHomeUrl } from '../url.js'
import type { EmulationAccess, EmulationTab } from './emulation-access.js'

/**
 * Captures the tab's emulation revision, context and result, and returns a
 * check that throws once any of them changed, so only the result the caller
 * received is published.
 */
function emulationPublication<Tab extends EmulationTab>(access: EmulationAccess<Tab>, tabId: string | undefined, expected: BrowserEmulationResult): () => void {
  const tab = access.getTab(tabId)
  const revision = tab.emulationRevision
  const contextGeneration = tab.emulationContextGeneration
  const navigationGeneration = tab.navigationGeneration
  const serialized = JSON.stringify(expected)
  const assert = (): void => {
    if (access.findTab(tab.id) !== tab || tab.webContents.isDestroyed() || tab.emulationRevision !== revision || tab.emulationContextGeneration !== contextGeneration || tab.navigationGeneration !== navigationGeneration || JSON.stringify(access.emulationResult(tab)) !== serialized) throw new Error('Emulation state changed before publication')
  }
  assert()
  return assert
}

/**
 * Validates the requested emulation changes and applies them to the tab's page
 * through the debugger as one transaction. A request that changes nothing
 * attaches no debugger. Network conditions must be known and confirmed first;
 * a change that failed after a command was sent leaves the emulation unknown
 * until it is explicitly restored. Its failures keep the messages agents read,
 * while Hronaut's own pages say what changed in the interface language.
 */
export async function emulate<Tab extends EmulationTab>(access: EmulationAccess<Tab>, options: BrowserEmulationOptions = {}, validate: () => void = () => {}, markSubmitted: () => void = () => {}, retainPublication?: (assert: () => void) => void): Promise<BrowserEmulationResult> {
  const tab = access.getTab(options.tabId)
  validate()
  if (isHronautHomeUrl(tab.url)) throw new LocalizedError('appErrors.emulation.homeTab')
  // Validation and reads never attach a debugger or repair native state.
  if (!prepareBrowserEmulation(tab.emulation, tab.emulationExtraHttpHeaders, options)) {
    const result = access.emulationResult(tab)
    retainPublication?.(emulationPublication(access, tab.id, result))
    return result
  }
  if (!options.recover && tab.emulationApplication === 'unknown') access.requireEmulationConfirmed(tab)
  access.requireNetworkConditionsKnown(tab)
  const webContents = tab.webContents
  const generation = tab.navigationGeneration
  const observation = tab.observationGeneration
  const contextGeneration = tab.emulationContextGeneration
  const debuggerEpoch = tab.networkDebuggerEpoch
  const context = (): void => {
    if (access.isDestroyed() || webContents.isDestroyed() || access.findTab(tab.id) !== tab || tab.webContents !== webContents
      || tab.navigationGeneration !== generation || tab.observationGeneration !== observation || tab.emulationContextGeneration !== contextGeneration || tab.networkDebuggerEpoch !== debuggerEpoch) {
      throw new LocalizedError('appErrors.emulation.targetChanged', undefined, { message: 'Emulation target changed' })
    }
  }
  const admission = (): void => { validate(); context() }
  return access.withDebugger(webContents, async () => {
    admission()
    if (tab.networkConditionApplication !== 'confirmed') {
      throw new LocalizedError('appErrors.emulation.networkUnconfirmed', undefined, {
        message: 'Network application must be confirmed before changing or restoring emulation. Recover Network conditions separately.'
      })
    }
    if (!options.recover) access.requireEmulationConfirmed(tab)
    const prepared = prepareBrowserEmulation(tab.emulation, tab.emulationExtraHttpHeaders, options)
    if (!prepared) return access.emulationResult(tab)
    const { state: next, headers: nextHeaders } = prepared
    const networkEpoch = tab.networkConditionEpoch
    const routes = tab.networkRoutes
    const networkContext = (): void => {
      if (tab.networkConditionEpoch !== networkEpoch || tab.networkRoutes !== routes) {
        throw new LocalizedError('appErrors.emulation.networkChanged', undefined, { message: 'Network application changed during emulation' })
      }
    }
    const previousApplication = tab.emulationApplication
    const revision = ++tab.emulationRevision
    const networkChanged = next.network !== tab.emulation.network
    let submitted = false
    tab.nativeInputEnvironmentGeneration += 1
    tab.emulationApplication = 'pending'
    const previousViewSize = tab.emulationViewSize
    try {
      access.changed(false)
      // The view takes its new size before the override changes. Chromium
      // sizes captures of an emulated page by the view it had when the
      // override arrived, so a view resized afterwards would cut a viewport
      // larger than the window down to the window. Removing the override
      // hands the page the view's own size, so the view also fills its
      // space first, while the override still pins the page.
      access.setEmulationViewSize(tab, next.viewport)
      await applyEmulationState(access, tab, next, nextHeaders, async (method, params) => {
        admission()
        networkContext()
        submitted = true
        markSubmitted()
        const result = await webContents.debugger.sendCommand(method, params)
        // Native settlement owns the queue even if authority was lost while awaiting it.
        context()
        return result
      })
      context()
      networkContext()
    } catch (error) {
      if (tab.emulationRevision === revision) {
        tab.emulationApplication = submitted ? 'unknown' : previousApplication
        tab.emulationRevision += 1
        // Native Network may contain the proposed throttle. If it differs
        // from the retained configuration, it needs its own recovery.
        if (submitted && networkChanged) access.markNetworkConditionsUnknown(tab)
        access.changed(false)
        access.setEmulationViewSize(tab, submitted ? undefined : previousViewSize)
      }
      throw error
    }
    // Native acknowledgement commits independently of UI/MCP publication.
    tab.emulation = next
    tab.emulationExtraHttpHeaders = nextHeaders
    tab.emulationApplication = 'confirmed'
    tab.networkConditionApplication = 'confirmed'
    access.changed(false)
    access.setEmulationViewSize(tab, next.viewport)
    validate()
    const result = access.emulationResult(tab)
    retainPublication?.(emulationPublication(access, tab.id, result))
    return result
  }, admission)
}

/**
 * Sends the debugger commands that give the page an emulation state: cache,
 * service worker and network conditions with the tab's request rules, data
 * saver, headers, CPU and animation rates, media features, vision deficiency,
 * user agent, locale, timezone, viewport and touch, geolocation, safe area,
 * text scale, small viewport height, script execution and rendering overlays.
 */
async function applyEmulationState<Tab extends EmulationTab>(
  access: EmulationAccess<Tab>,
  tab: Tab,
  state: BrowserEmulationState,
  extraHttpHeaders: Record<string, string>,
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>
): Promise<void> {
  access.requireNetworkConditionsKnown(tab)
  const webContents = tab.webContents
  const routes = tab.networkRoutes
  const epoch = tab.networkConditionEpoch
  const projection = routes.map(route => ({ ...route }))
  await send('Network.enable')
  await send('Network.setCacheDisabled', {
    cacheDisabled: state.cacheDisabled
  })
  await send('Network.setBypassServiceWorker', {
    bypass: state.bypassServiceWorker
  })
  access.requireNetworkConditionsKnown(tab)
  if (webContents.isDestroyed() || access.findTab(tab.id) !== tab || tab.webContents !== webContents || tab.networkConditionEpoch !== epoch || tab.networkRoutes !== routes) {
    throw new LocalizedError('appErrors.emulation.networkChanged', undefined, { message: 'Network emulation context changed before application' })
  }
  tab.networkConditionApplication = 'pending'
  try {
    await access.applyNetworkEmulation(webContents, state.network, projection, async (method, params) => {
      access.requireNetworkConditionsKnown(tab)
      if (webContents.isDestroyed() || access.findTab(tab.id) !== tab || tab.webContents !== webContents || tab.networkConditionEpoch !== epoch || tab.networkRoutes !== routes) {
        throw new LocalizedError('appErrors.emulation.networkChanged', undefined, { message: 'Network emulation context changed' })
      }
      return send(method, params)
    })
    if (webContents.isDestroyed() || access.findTab(tab.id) !== tab || tab.webContents !== webContents || tab.networkConditionEpoch !== epoch || tab.networkRoutes !== routes) {
      throw new LocalizedError('appErrors.emulation.networkChanged', undefined, { message: 'Network emulation acknowledgement was superseded' })
    }
    // A proposed throttle is not yet the retained throttle. Keep Network
    // pending until the entire emulation configuration commits atomically.
    tab.networkConditionApplication = state.network === tab.emulation.network ? 'confirmed' : 'pending'
  } catch (error) {
    access.markNetworkConditionsUnknown(tab)
    access.changed(false)
    throw error
  }
  await send(
    'Emulation.setDataSaverOverride',
    state.dataSaver === 'auto' ? {} : { dataSaverEnabled: state.dataSaver === 'enabled' }
  )
  await send('Network.setExtraHTTPHeaders', { headers: extraHttpHeaders })
  await send('Emulation.setCPUThrottlingRate', {
    rate: state.cpuThrottlingRate
  })
  await send('Animation.enable')
  await send('Animation.setPlaybackRate', {
    playbackRate: state.animationPlaybackRate ?? 1
  })
  const features: Array<{ name: string; value: string }> = []
  if (state.colorScheme !== 'auto') {
    features.push({ name: 'prefers-color-scheme', value: state.colorScheme })
  }
  if (state.reducedMotion !== 'auto') {
    features.push({ name: 'prefers-reduced-motion', value: state.reducedMotion })
  }
  if (state.forcedColors !== 'auto') {
    features.push({ name: 'forced-colors', value: state.forcedColors })
  }
  if (state.contrast !== 'auto') {
    features.push({ name: 'prefers-contrast', value: state.contrast })
  }
  if (state.reducedTransparency !== 'auto') {
    features.push({ name: 'prefers-reduced-transparency', value: state.reducedTransparency })
  }
  await send('Emulation.setEmulatedMedia', {
    media: state.mediaType === 'auto' ? '' : state.mediaType,
    features
  })
  await send('Emulation.setEmulatedVisionDeficiency', {
    type: state.visionDeficiency
  })
  await send('Emulation.setUserAgentOverride', {
    // Leave the UA override empty to preserve native Client Hints when only
    // acceptLanguage changes; an explicit UA keeps its existing semantics.
    userAgent: state.userAgent ?? '',
    ...(state.locale ? { acceptLanguage: state.locale } : {})
  })
  await send('Emulation.setLocaleOverride', {
    locale: state.locale ?? ''
  })
  await send('Emulation.setTimezoneOverride', {
    timezoneId: state.timezoneId ?? ''
  })
  if (state.viewport) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: state.viewport.width,
      height: state.viewport.height,
      deviceScaleFactor: state.viewport.deviceScaleFactor,
      mobile: state.viewport.mobile,
      screenOrientation: {
        type: state.viewport.orientation === 'landscape' ? 'landscapePrimary' : 'portraitPrimary',
        angle: state.viewport.orientation === 'landscape' ? 90 : 0
      }
    })
    await send('Emulation.setTouchEmulationEnabled', {
      enabled: state.viewport.touch,
      maxTouchPoints: state.viewport.touch ? 5 : 1
    })
  } else {
    await send('Emulation.clearDeviceMetricsOverride')
    await send('Emulation.setTouchEmulationEnabled', { enabled: false })
  }
  if (state.geolocation) {
    await send('Emulation.setGeolocationOverride', { ...state.geolocation })
  } else {
    await send('Emulation.clearGeolocationOverride')
  }
  // An empty override resolves every safe-area variable to 0px, matching a
  // tab that never had one; there is no separate clear command.
  await send('Emulation.setSafeAreaInsetsOverride', { insets: state.safeAreaInsets ?? {} })
  // Omitting scale removes the override and restores the browser's preference.
  await send('Emulation.setEmulatedOSTextScale', state.osTextScale === undefined ? {} : { scale: state.osTextScale })
  // There is no clear command; a difference of 0 matches a desktop tab with no browser controls.
  await send('Emulation.setSmallViewportHeightDifferenceOverride', { difference: state.smallViewportHeightDifference ?? 0 })
  await send('Emulation.setScriptExecutionDisabled', {
    value: state.javaScriptDisabled === true
  })
  const renderingDebug = { ...DEFAULT_RENDERING_DEBUG, ...state.renderingDebug }
  await send('DOM.enable')
  await send('Overlay.enable')
  await send('Overlay.setShowPaintRects', { result: renderingDebug.paintFlashing })
  await send('Overlay.setShowLayoutShiftRegions', { result: renderingDebug.layoutShiftRegions })
  await send('Overlay.setShowDebugBorders', { show: renderingDebug.layerBorders })
  await send('Overlay.setShowFPSCounter', { show: renderingDebug.fpsCounter })
  await send('Overlay.setShowScrollBottleneckRects', { show: renderingDebug.scrollBottlenecks })
  if (!Object.values(renderingDebug).some(Boolean)) await send('Overlay.disable')
}
