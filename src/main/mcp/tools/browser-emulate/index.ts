import { z } from 'zod'
import type { BrowserEmulationOptions } from '../../../../shared/types.js'
import { BROWSER_VIEWPORT_PRESET_IDS } from '../../../../shared/viewport-presets.js'
import { MAX_OS_TEXT_SCALE, MAX_SAFE_AREA_INSET, MAX_SMALL_VIEWPORT_HEIGHT_DIFFERENCE, MIN_OS_TEXT_SCALE, SAFE_AREA_INSET_FIELDS } from '../../../browser/emulation-state.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserEmulate(context: McpToolContext): void {
  const { frameRequests, manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_emulate',
    {
      description: toolDescription('browser_emulate'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        reset: z.boolean().optional(),
        recover: z.boolean().optional().describe('Explicitly restore the last committed settings after uncertain native application. Cannot be combined with reset or overrides; does not replay the failed request.'),
        network: z.enum(['none', 'offline', 'slow-3g', 'slow-4g', 'fast-4g']).optional(),
        cacheDisabled: z.boolean().optional()
          .describe('Ignore the HTTP memory and disk cache for future requests in this tab without deleting cached data.'),
        bypassServiceWorker: z.boolean().optional()
          .describe('Send future requests to the network instead of service-worker fetch handlers without unregistering the worker.'),
        dataSaver: z.enum(['auto', 'enabled', 'disabled']).optional()
          .describe('Override navigator.connection.saveData. Use auto to restore the system value; this does not throttle bandwidth.'),
        cpuThrottlingRate: z.number().min(1).max(20).optional(),
        animationPlaybackRate: z.union([z.literal(0), z.literal(0.1), z.literal(0.25), z.literal(1)]).optional()
          .describe('Pause document-timeline CSS/Web Animations at 0, slow them to 10% or 25%, or restore normal playback at 1. requestAnimationFrame loops are unaffected.'),
        colorScheme: z.enum(['auto', 'light', 'dark']).optional(),
        reducedMotion: z.enum(['auto', 'reduce', 'no-preference']).optional(),
        mediaType: z.enum(['auto', 'screen', 'print']).optional(),
        forcedColors: z.enum(['auto', 'active', 'none']).optional(),
        contrast: z.enum(['auto', 'more', 'less', 'custom', 'no-preference']).optional(),
        reducedTransparency: z.enum(['auto', 'reduce', 'no-preference']).optional(),
        visionDeficiency: z.enum(['none', 'blurredVision', 'reducedContrast', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia']).optional(),
        userAgent: z.string().max(512).optional(),
        locale: z.string().max(64).optional()
          .describe('BCP 47 language tag such as en-US. Empty string restores the system locale; reload to update navigator language and request headers.'),
        timezoneId: z.string().max(100).optional()
          .describe('IANA time-zone ID such as America/New_York. Empty string restores the system time zone.'),
        javaScriptDisabled: z.boolean().optional()
          .describe('Disable page JavaScript in this tab. Reload to test startup without scripts; set false or reset to restore execution.'),
        viewport: z.object({
          width: z.number().int().min(200).max(3840),
          height: z.number().int().min(200).max(3840),
          deviceScaleFactor: z.number().min(0.5).max(5).default(1),
          mobile: z.boolean().default(false),
          touch: z.boolean().default(false),
          orientation: z.enum(['portrait', 'landscape']).default('portrait')
        }).nullable().optional(),
        viewportPreset: z.enum(BROWSER_VIEWPORT_PRESET_IDS).optional()
          .describe('Generic responsive viewport preset. Cannot be combined with viewport.'),
        viewportOrientation: z.enum(['portrait', 'landscape']).optional()
          .describe('Portrait by default. Requires viewportPreset.'),
        geolocation: z.object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
          accuracy: z.number().min(0).max(100_000).default(100)
        }).nullable().optional(),
        safeAreaInsets: z.object(Object.fromEntries(SAFE_AREA_INSET_FIELDS.map(name => [name, z.number().int().min(0).max(MAX_SAFE_AREA_INSET).optional()])))
          .strict().nullable().optional()
          .describe('Override env(safe-area-inset-*) and env(safe-area-max-inset-*) in integer CSS pixels: top, left, bottom, right and their *Max fields. Replaces the whole override; omitted fields resolve to 0px, so CSS fallbacks do not apply. Null restores the browser values. Not a device frame or notch overlay.'),
        osTextScale: z.number().min(MIN_OS_TEXT_SCALE).max(MAX_OS_TEXT_SCALE).nullable().optional()
          .describe('Emulate the operating-system text-size preference from 0.85 to 2 (1 is 100%). Only pages that opt in with <meta name="text-scale" content="scale"> or use env(preferred-text-scale) respond; others are unchanged. Null restores the browser preference. This is not page zoom.'),
        smallViewportHeightDifference: z.number().int().min(0).max(MAX_SMALL_VIEWPORT_HEIGHT_DIFFERENCE).nullable().optional()
          .describe('Emulate mobile browser controls of this many integer CSS pixels (0 to 1000) so 100lvh is that much taller than 100svh, like a phone browser showing its address bar. With a mobile viewport the small viewport shrinks; in a desktop-size tab the large viewport grows. Top-level frame only; dvh changes and address-bar animation are not emulated. Must be smaller than an emulated viewport height. Null or reset restores the browser value.'),
        renderingDebug: z.object({
          paintFlashing: z.boolean().optional()
            .describe('Flash repainted regions. This can produce rapid flashing and should be used with photosensitivity caution.'),
          layoutShiftRegions: z.boolean().optional()
            .describe('Briefly highlight layout shifts. Reload before reproducing startup shifts; this can produce flashing.'),
          layerBorders: z.boolean().optional(),
          fpsCounter: z.boolean().optional(),
          scrollBottlenecks: z.boolean().optional()
        }).nullable().optional()
          .describe('Merge Chromium rendering diagnostics into the current tab state. Null clears every rendering overlay.'),
        extraHttpHeaders: z.record(z.string(), z.string().max(8_192)).optional()
      }
    },
    tabTool('browser_emulate', async ({ validateConditions, markConditionsSubmitted, ...options }: BrowserEmulationOptions & { validateConditions?: () => void; markConditionsSubmitted?: () => void }) => {
      if (!validateConditions) throw new Error('Emulation authority is unavailable')
      const result = await manager.emulate(options, validateConditions, markConditionsSubmitted, assert => {
        frameRequests.getStore()!.conditionPublication = () => { validateConditions(); assert() }
      })
      return textResult(result)
    })
  )
}
