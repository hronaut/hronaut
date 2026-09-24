import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

async function applyDiagnosticEmulation(client: Client, tabId: string): Promise<CallToolResult> {
  return await client.callTool({
    name: 'browser_emulate',
    arguments: {
      tabId,
      network: 'slow-4g',
      dataSaver: 'enabled',
      cpuThrottlingRate: 4,
      animationPlaybackRate: 0,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      mediaType: 'print',
      forcedColors: 'active',
      contrast: 'more',
      reducedTransparency: 'reduce',
      visionDeficiency: 'deuteranopia',
      userAgent: 'Hronaut Emulation Test/1.0',
      locale: 'fr-CA',
      timezoneId: 'America/Toronto',
      viewport: {
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        mobile: true,
        touch: true,
        orientation: 'portrait'
      },
      geolocation: { latitude: 50.4501, longitude: 30.5234, accuracy: 25 },
      renderingDebug: {
        paintFlashing: true,
        layoutShiftRegions: true,
        layerBorders: true,
        fpsCounter: true,
        scrollBottlenecks: true
      },
      extraHttpHeaders: { 'X-Hronaut-Test': 'device-emulation' }
    }
  }) as CallToolResult
}

test('applies responsive presets and resets only the viewport', async ({ capabilities, appWindow }) => {
  const { client, tabId, openPageTool } = capabilities
  const seededEmulation = await client.callTool({
    name: 'browser_emulate',
    arguments: { tabId, colorScheme: 'dark' }
  }) as CallToolResult
  expect(JSON.parse(text(seededEmulation))).toMatchObject({ colorScheme: 'dark' })
  await openPageTool('Responsive preview: Test phones, tablets, and desktops')
  const responsivePanel = appWindow.getByRole('dialog', { name: 'Responsive preview' })
  await expect(responsivePanel).toBeVisible()
  await responsivePanel.getByRole('button', { name: /^Tablet/ }).click()
  await responsivePanel.getByRole('button', { name: 'Landscape' }).click()
  await responsivePanel.getByRole('button', { name: 'Apply preview' }).click()
  await expect(responsivePanel).toContainText('Viewport applied')
  const humanResponsiveState = await client.callTool({
    name: 'browser_emulate',
    arguments: { tabId }
  }) as CallToolResult
  expect(JSON.parse(text(humanResponsiveState))).toMatchObject({
    colorScheme: 'dark',
    viewport: {
      width: 1024,
      height: 768,
      deviceScaleFactor: 2,
      mobile: true,
      touch: true,
      orientation: 'landscape'
    }
  })
  const resetResponsiveViewport = responsivePanel.getByRole('button', { name: 'Reset viewport' })
  await resetResponsiveViewport.click()
  await expect.poll(async () => {
    const result = await client.callTool({ name: 'browser_emulate', arguments: { tabId } }) as CallToolResult
    return JSON.parse(text(result)).viewport ?? null
  }).toBeNull()
  const afterHumanReset = JSON.parse(text(await client.callTool({
    name: 'browser_emulate',
    arguments: { tabId }
  }) as CallToolResult))
  expect(afterHumanReset).toMatchObject({ colorScheme: 'dark' })
  expect(afterHumanReset.viewport).toBeUndefined()
  await responsivePanel.getByRole('button', { name: 'Close responsive preview' }).click()

  const presetEmulation = await client.callTool({
    name: 'browser_emulate',
    arguments: { tabId, viewportPreset: 'compact-phone', viewportOrientation: 'landscape' }
  }) as CallToolResult
  expect(presetEmulation.isError, text(presetEmulation)).not.toBe(true)
  expect(JSON.parse(text(presetEmulation))).toMatchObject({
    colorScheme: 'dark',
    viewport: {
      width: 800,
      height: 360,
      deviceScaleFactor: 2,
      mobile: true,
      touch: true,
      orientation: 'landscape'
    }
  })
  const ambiguousViewport = await client.callTool({
    name: 'browser_emulate',
    arguments: {
      tabId,
      viewportPreset: 'phone',
      viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true, orientation: 'portrait' }
    }
  }) as CallToolResult
  expect(ambiguousViewport.isError).toBe(true)
  expect(text(ambiguousViewport)).toContain('cannot be combined')

})

test('isolates emulation between tabs and preserves it across reload', async ({ capabilities, appWindow }) => {
  const { client, tabId, fixtureOrigin } = capabilities
  await appWindow.evaluate(`window.hronautPermissions.set(${JSON.stringify(fixtureOrigin)}, 'geolocation', 'allow')`)
  const isolatedTabResult = await client.callTool({
    name: 'browser_new_tab', arguments: { url: `${fixtureOrigin}/`, active: false }
  }) as CallToolResult
  expect(isolatedTabResult.isError, text(isolatedTabResult)).not.toBe(true)
  const isolatedTabId = JSON.parse(text(isolatedTabResult)).tabs.find((tab: { url: string }) => tab.url === `${fixtureOrigin}/`)?.id as string
  expect(isolatedTabId).toBeTruthy()
  await client.callTool({ name: 'browser_wait', arguments: { tabId: isolatedTabId } })
  await client.callTool({ name: 'browser_select_tab', arguments: { tabId } })
  const emulated = await applyDiagnosticEmulation(client, tabId)
  expect(emulated.isError, text(emulated)).not.toBe(true)
  expect(JSON.parse(text(emulated))).toEqual({
    network: 'slow-4g',
    cacheDisabled: false,
    bypassServiceWorker: false,
    dataSaver: 'enabled',
    cpuThrottlingRate: 4,
    animationPlaybackRate: 0,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    mediaType: 'print',
    forcedColors: 'active',
    contrast: 'more',
    reducedTransparency: 'reduce',
    visionDeficiency: 'deuteranopia',
    userAgent: 'Hronaut Emulation Test/1.0',
    locale: 'fr-CA',
    timezoneId: 'America/Toronto',
    viewport: {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      touch: true,
      orientation: 'portrait'
    },
    geolocation: { latitude: 50.4501, longitude: 30.5234, accuracy: 25 },
    renderingDebug: {
      paintFlashing: true,
      layoutShiftRegions: true,
      layerBorders: true,
      fpsCounter: true,
      scrollBottlenecks: true
    },
    extraHttpHeaderNames: ['X-Hronaut-Test']
  })
  const pausedAnimation = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: `(async () => {
        const animation = document.querySelector('#animation-probe').getAnimations()[0];
        const before = animation.currentTime;
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { before, after: animation.currentTime };
      })()`
    }
  }) as CallToolResult
  const pausedAnimationTimes = JSON.parse(text(pausedAnimation)) as { before: number; after: number }
  expect(Math.abs(pausedAnimationTimes.after - pausedAnimationTimes.before)).toBeLessThan(1)
  const emulationState = await client.callTool({
    name: 'browser_emulate',
    arguments: { tabId }
  }) as CallToolResult
  expect(JSON.parse(text(emulationState))).toEqual(JSON.parse(text(emulated)))
  const emulatedPage = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: `(async () => ({
        userAgent: navigator.userAgent,
        online: navigator.onLine,
        saveData: navigator.connection?.saveData ?? null,
        dark: matchMedia('(prefers-color-scheme: dark)').matches,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        print: matchMedia('print').matches,
        forcedColors: matchMedia('(forced-colors: active)').matches,
        moreContrast: matchMedia('(prefers-contrast: more)').matches,
        reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
        locale: new Intl.NumberFormat().resolvedOptions().locale,
        timezoneId: new Intl.DateTimeFormat().resolvedOptions().timeZone,
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio, touchPoints: navigator.maxTouchPoints },
        location: await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
          ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
          ({ message }) => reject(new Error(message))
        )),
        header: await fetch('/headers').then((response) => response.json())
      }))()`
    }
  }) as CallToolResult
  expect(JSON.parse(text(emulatedPage))).toEqual({
    userAgent: 'Hronaut Emulation Test/1.0',
    online: true,
    saveData: true,
    dark: true,
    reducedMotion: true,
    print: true,
    forcedColors: true,
    moreContrast: true,
    reducedTransparency: true,
    locale: 'fr-CA',
    timezoneId: 'America/Toronto',
    viewport: { width: 390, height: 844, devicePixelRatio: 3, touchPoints: 5 },
    location: { latitude: 50.4501, longitude: 30.5234, accuracy: 25 },
    header: { marker: 'device-emulation', language: expect.any(String) }
  })
  const emulationResetButton = appWindow.getByRole('button', { name: /^Reset tab emulation:/ })
  await expect(emulationResetButton).toContainText('Slow 4G')
  await expect(emulationResetButton).toHaveAttribute('aria-label', /390×844 at 3× mobile touch portrait viewport/)
  await expect(appWindow.locator('.tab-emulation-mark')).toHaveCount(1)
  const listedEmulation = await client.callTool({ name: 'browser_tabs', arguments: {} }) as CallToolResult
  const emulatedTabs = JSON.parse(text(listedEmulation)) as Array<{
    id: string
    emulation?: { network: string; cpuThrottlingRate: number }
  }>
  expect(emulatedTabs).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: tabId, emulation: expect.objectContaining({ network: 'slow-4g', cpuThrottlingRate: 4 }) })
  ]))
  expect(text(listedEmulation)).not.toContain('device-emulation')
  expect(emulatedTabs.find((tab) => tab.id === isolatedTabId)?.emulation).toBeUndefined()
  const isolatedUserAgent = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId: isolatedTabId, script: 'navigator.userAgent' }
  }) as CallToolResult
  expect(text(isolatedUserAgent)).not.toContain('Hronaut Emulation Test')
  await client.callTool({
    name: 'browser_memory',
    arguments: { tabId, action: 'set-baseline', collectGarbage: true }
  })
  await client.callTool({ name: 'browser_history', arguments: { action: 'reload', tabId } })
  await client.callTool({ name: 'browser_wait', arguments: { tabId } })
  const memoryAfterReload = await client.callTool({
    name: 'browser_memory',
    arguments: { tabId, action: 'measure', collectGarbage: true }
  }) as CallToolResult
  const memoryAfterReloadReport = JSON.parse(text(memoryAfterReload))
  expect(memoryAfterReloadReport.current).toBeDefined()
  expect(memoryAfterReloadReport.baseline).toBeUndefined()
  expect(memoryAfterReloadReport.delta).toBeUndefined()
  const persistedEmulation = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: `(async () => ({
        userAgent: navigator.userAgent,
        saveData: navigator.connection?.saveData ?? null,
        dark: matchMedia('(prefers-color-scheme: dark)').matches,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        print: matchMedia('print').matches,
        forcedColors: matchMedia('(forced-colors: active)').matches,
        moreContrast: matchMedia('(prefers-contrast: more)').matches,
        reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
        locale: navigator.language,
        locales: navigator.languages,
        timezoneId: new Intl.DateTimeFormat().resolvedOptions().timeZone,
        width: innerWidth,
        devicePixelRatio,
        touchPoints: navigator.maxTouchPoints,
        header: await fetch('/headers').then((response) => response.json())
      }))()`
    }
  }) as CallToolResult
  expect(JSON.parse(text(persistedEmulation))).toEqual({
    userAgent: 'Hronaut Emulation Test/1.0',
    saveData: true,
    dark: true,
    reducedMotion: true,
    print: true,
    forcedColors: true,
    moreContrast: true,
    reducedTransparency: true,
    locale: 'fr-CA',
    locales: expect.arrayContaining(['fr-CA']),
    timezoneId: 'America/Toronto',
    width: 390,
    devicePixelRatio: 3,
    touchPoints: 5,
    header: { marker: 'device-emulation', language: expect.stringContaining('fr-CA') }
  })
  const pausedAnimationAfterReload = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: `(async () => {
        const animation = document.querySelector('#animation-probe').getAnimations()[0];
        const before = animation.currentTime;
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { before, after: animation.currentTime };
      })()`
    }
  }) as CallToolResult
  const pausedAfterReloadTimes = JSON.parse(text(pausedAnimationAfterReload)) as { before: number; after: number }
  expect(Math.abs(pausedAfterReloadTimes.after - pausedAfterReloadTimes.before)).toBeLessThan(1)

})

test('hands emulation diagnostics to DevTools and restores them after closing it', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureOrigin } = capabilities
  const seeded = await applyDiagnosticEmulation(client, tabId)
  expect(seeded.isError, text(seeded)).not.toBe(true)
  const routePattern = `${fixtureOrigin}/route-target`
  await client.callTool({
    name: 'browser_network_routes',
    arguments: { action: 'add', tabId, urlPattern: routePattern, times: 3, abort: 'Failed' }
  })
  await expect(appWindow.getByRole('button', { name: 'Open 1 temporary request condition' })).toBeVisible()
  expect(await appWindow.evaluate(`window.hronaut.toggleDevTools(${JSON.stringify(tabId)})`)).toBe(true)
  const routesAfterDevTools = await client.callTool({
    name: 'browser_network_routes',
    arguments: { action: 'list', tabId }
  }) as CallToolResult
  expect(JSON.parse(text(routesAfterDevTools))).toEqual([])
  await expect(appWindow.locator('.network-routes-pill')).toHaveCount(0)
  await expect.poll(() => electronApp.evaluate(({ webContents }, requestedOrigin) => {
    return webContents.getAllWebContents().some((contents) => (
      contents.getURL().startsWith(requestedOrigin) && contents.isDevToolsOpened()
    ))
  }, fixtureOrigin)).toBe(true)
  const evaluateWithDevTools = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: 'document.title' }
  }) as CallToolResult
  expect(text(evaluateWithDevTools)).toBe('Capability fixture')
  const debuggerActionWithDevTools = await client.callTool({
    name: 'browser_resize',
    arguments: { tabId, width: 400, height: 600 }
  }) as CallToolResult
  expect(debuggerActionWithDevTools.isError).toBe(true)
  expect(text(debuggerActionWithDevTools)).toContain('Close Developer Tools')
  expect(await appWindow.evaluate(`window.hronaut.toggleDevTools(${JSON.stringify(tabId)})`)).toBe(false)
  await expect.poll(() => electronApp.evaluate(({ webContents }, requestedOrigin) => {
    return webContents.getAllWebContents().some((contents) => (
      contents.getURL().startsWith(requestedOrigin) && contents.isDevToolsOpened()
    ))
  }, fixtureOrigin)).toBe(false)

  await expect.poll(async () => {
    const result = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId,
        script: `navigator.userAgent + '|' + matchMedia('(prefers-color-scheme: dark)').matches`
      }
    }) as CallToolResult
    return text(result)
  }).toBe('Hronaut Emulation Test/1.0|true')

})

test('applies and resets environment conditions through the panel', async ({ capabilities, appWindow }) => {
  const { client, tabId, openPageTool } = capabilities
  const seeded = await applyDiagnosticEmulation(client, tabId)
  expect(seeded.isError, text(seeded)).not.toBe(true)
  await openPageTool(/Environment: 20 active conditions/)
  const environmentPanel = appWindow.getByRole('dialog', { name: 'Environment' })
  await expect(environmentPanel).toBeVisible()
  await expect(environmentPanel.getByRole('combobox', { name: 'Dock Environment' })).toHaveValue('right')
  await expect(environmentPanel.getByLabel('Network', { exact: true })).toHaveValue('slow-4g')
  await expect(environmentPanel.getByLabel('Data Saver')).toHaveValue('enabled')
  await expect(environmentPanel.getByLabel('CPU')).toHaveValue('4')
  await expect(environmentPanel.getByLabel('Animation playback')).toHaveValue('0')
  await expect(environmentPanel.getByLabel('Color scheme')).toHaveValue('dark')
  await expect(environmentPanel.getByLabel('Motion')).toHaveValue('reduce')
  await expect(environmentPanel.getByLabel('Media type')).toHaveValue('print')
  await expect(environmentPanel.getByLabel('Forced colors')).toHaveValue('active')
  await expect(environmentPanel.getByLabel('Contrast')).toHaveValue('more')
  await expect(environmentPanel.getByLabel('Transparency')).toHaveValue('reduce')
  await expect(environmentPanel.getByLabel('Vision simulation')).toHaveValue('deuteranopia')
  await expect(environmentPanel.getByLabel('Paint flashing')).toBeChecked()
  await expect(environmentPanel.getByLabel('Layout shift regions')).toBeChecked()
  await expect(environmentPanel.getByLabel('Layer borders')).toBeChecked()
  await expect(environmentPanel.getByLabel('Frame rendering stats')).toBeChecked()
  await expect(environmentPanel.getByLabel('Scrolling performance issues')).toBeChecked()
  await expect(environmentPanel).toContainText('These diagnostics can flash rapidly')
  await expect(environmentPanel.getByLabel('Locale')).toHaveValue('fr-CA')
  await expect(environmentPanel.getByLabel('Time zone')).toHaveValue('America/Toronto')
  await expect(environmentPanel.getByLabel('Disable JavaScript')).not.toBeChecked()
  await expect(environmentPanel.getByLabel(/Custom user agent/)).toHaveValue('Hronaut Emulation Test/1.0')
  await expect(environmentPanel.getByLabel(/Override geolocation/)).toBeChecked()
  await expect(environmentPanel).toContainText('390×844 viewport')
  await expect(environmentPanel).toContainText('1 agent-set request header')
  await expect(environmentPanel).toContainText('X-Hronaut-Test')

  await environmentPanel.getByLabel('Network', { exact: true }).selectOption('fast-4g')
  await environmentPanel.getByLabel('Data Saver').selectOption('disabled')
  await environmentPanel.getByLabel('CPU').selectOption('6')
  await environmentPanel.getByLabel('Animation playback').selectOption('0.25')
  await environmentPanel.getByLabel('Color scheme').selectOption('light')
  await environmentPanel.getByLabel('Motion').selectOption('no-preference')
  await environmentPanel.getByLabel('Media type').selectOption('screen')
  await environmentPanel.getByLabel('Forced colors').selectOption('none')
  await environmentPanel.getByLabel('Contrast').selectOption('less')
  await environmentPanel.getByLabel('Transparency').selectOption('no-preference')
  await environmentPanel.getByLabel('Vision simulation').selectOption('protanopia')
  await environmentPanel.getByLabel('Paint flashing').uncheck()
  await environmentPanel.getByLabel('Layout shift regions').uncheck()
  await environmentPanel.getByLabel('Layer borders').uncheck()
  await environmentPanel.getByLabel('Frame rendering stats').uncheck()
  await environmentPanel.getByLabel('Scrolling performance issues').uncheck()
  await environmentPanel.getByLabel('Frame rendering stats').check()
  await environmentPanel.getByLabel('Locale').fill('de-DE')
  await environmentPanel.getByLabel('Time zone').fill('Asia/Tokyo')
  await environmentPanel.getByLabel(/Custom user agent/).fill('Hronaut Human Environment/1.0')
  await environmentPanel.getByLabel(/Override geolocation/).uncheck()
  await environmentPanel.getByRole('button', { name: 'Apply & reload' }).click()
  await expect(environmentPanel.locator('.environment-status')).toContainText('Environment applied')
  await expect.poll(async () => {
    const current = await client.callTool({ name: 'browser_emulate', arguments: { tabId } }) as CallToolResult
    return JSON.parse(text(current))
  }).toMatchObject({
    network: 'fast-4g',
    dataSaver: 'disabled',
    cpuThrottlingRate: 6,
    animationPlaybackRate: 0.25,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    mediaType: 'screen',
    forcedColors: 'none',
    contrast: 'less',
    reducedTransparency: 'no-preference',
    visionDeficiency: 'protanopia',
    userAgent: 'Hronaut Human Environment/1.0',
    locale: 'de-DE',
    timezoneId: 'Asia/Tokyo',
    renderingDebug: {
      paintFlashing: false,
      layoutShiftRegions: false,
      layerBorders: false,
      fpsCounter: true,
      scrollBottlenecks: false
    },
    viewport: { width: 390, height: 844 },
    extraHttpHeaderNames: ['X-Hronaut-Test']
  })
  const humanEnvironmentState = JSON.parse(text(await client.callTool({
    name: 'browser_emulate',
    arguments: { tabId }
  }) as CallToolResult))
  expect(humanEnvironmentState.geolocation).toBeUndefined()
  await expect.poll(async () => {
    const result = await client.callTool({
      name: 'browser_evaluate',
      arguments: {
        tabId,
        script: `(async () => ({
          userAgent: navigator.userAgent,
          saveData: navigator.connection?.saveData ?? null,
          light: matchMedia('(prefers-color-scheme: light)').matches,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          screen: matchMedia('screen').matches,
          forcedColorsNone: matchMedia('(forced-colors: none)').matches,
          lessContrast: matchMedia('(prefers-contrast: less)').matches,
          reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
          locale: navigator.language,
          timezoneId: new Intl.DateTimeFormat().resolvedOptions().timeZone,
          header: await fetch('/headers').then((response) => response.json())
        }))()`
      }
    }) as CallToolResult
    return JSON.parse(text(result))
  }).toEqual({
    userAgent: 'Hronaut Human Environment/1.0',
    saveData: false,
    light: true,
    reducedMotion: false,
    screen: true,
    forcedColorsNone: true,
    lessContrast: true,
    reducedTransparency: false,
    locale: 'de-DE',
    timezoneId: 'Asia/Tokyo',
    header: { marker: 'device-emulation', language: expect.stringContaining('de-DE') }
  })
  await environmentPanel.getByRole('button', { name: 'Reset environment' }).click()
  await expect.poll(async () => {
    const current = await client.callTool({ name: 'browser_emulate', arguments: { tabId } }) as CallToolResult
    return JSON.parse(text(current))
  }).toEqual({
    network: 'none',
    cacheDisabled: false,
    bypassServiceWorker: false,
    dataSaver: 'auto',
    cpuThrottlingRate: 1,
    animationPlaybackRate: 1,
    colorScheme: 'auto',
    reducedMotion: 'auto',
    mediaType: 'auto',
    forcedColors: 'auto',
    contrast: 'auto',
    reducedTransparency: 'auto',
    visionDeficiency: 'none',
    viewport: {
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
      touch: true,
      orientation: 'portrait'
    },
    extraHttpHeaderNames: ['X-Hronaut-Test']
  })
  await environmentPanel.getByRole('button', { name: 'Close Environment' }).click()

})

test('restores JavaScript and clears offline emulation, viewport and headers', async ({ capabilities, appWindow }) => {
  const { client, tabId, fixtureOrigin, openPageTool } = capabilities
  // Preserve the reset contract previously covered after the environment UI
  // scenario, but give this independent workflow its own profile and deadline.
  const seeded = await client.callTool({
    name: 'browser_emulate',
    arguments: {
      tabId,
      viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true, orientation: 'portrait' },
      extraHttpHeaders: { 'X-Hronaut-Test': 'device-emulation' }
    }
  }) as CallToolResult
  expect(seeded.isError, text(seeded)).not.toBe(true)
  const emulationResetButton = appWindow.getByRole('button', { name: /^Reset tab emulation:/ })

  const disabledJavaScript = await client.callTool({
    name: 'browser_emulate',
    arguments: { tabId, javaScriptDisabled: true }
  }) as CallToolResult
  expect(JSON.parse(text(disabledJavaScript))).toMatchObject({ javaScriptDisabled: true })
  await client.callTool({
    name: 'browser_navigate',
    arguments: { tabId, url: `${fixtureOrigin}/no-js` }
  })
  await client.callTool({ name: 'browser_wait', arguments: { tabId } })
  const disabledJavaScriptTabs = JSON.parse(text(await client.callTool({
    name: 'browser_tabs',
    arguments: {}
  }) as CallToolResult)) as Array<{ id: string; title: string }>
  expect(disabledJavaScriptTabs.find((candidate) => candidate.id === tabId)?.title).toBe('Static fallback')

  await openPageTool(/Environment: 1 active condition/)
  const disabledJavaScriptPanel = appWindow.getByRole('dialog', { name: 'Environment' })
  await expect(disabledJavaScriptPanel.getByLabel('Disable JavaScript')).toBeChecked()
  await disabledJavaScriptPanel.getByLabel('Disable JavaScript').uncheck()
  await disabledJavaScriptPanel.getByRole('button', { name: 'Apply & reload' }).click()
  await expect.poll(async () => {
    const current = await client.callTool({ name: 'browser_emulate', arguments: { tabId } }) as CallToolResult
    return JSON.parse(text(current)).javaScriptDisabled ?? false
  }).toBe(false)
  await expect(disabledJavaScriptPanel.locator('.environment-status')).toContainText('Environment applied')
  await client.callTool({ name: 'browser_wait', arguments: { tabId } })
  const restoredJavaScriptSnapshot = await client.callTool({
    name: 'browser_snapshot',
    arguments: { tabId }
  }) as CallToolResult
  expect(text(restoredJavaScriptSnapshot)).toContain('JavaScript enhanced')
  await disabledJavaScriptPanel.getByRole('button', { name: 'Close Environment' }).click()
  await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: fixtureOrigin } })
  await client.callTool({ name: 'browser_wait', arguments: { tabId } })

  const offline = await client.callTool({
    name: 'browser_emulate',
    arguments: { tabId, network: 'offline' }
  }) as CallToolResult
  expect(JSON.parse(text(offline))).toMatchObject({ network: 'offline' })
  const offlinePage = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: `(async () => ({
        online: navigator.onLine,
        fetchFailed: await fetch('/api').then(() => false, () => true)
      }))()`
    }
  }) as CallToolResult
  expect(JSON.parse(text(offlinePage))).toEqual({ online: false, fetchFailed: true })
  await expect(emulationResetButton).toContainText('Offline')
  await emulationResetButton.click()
  await expect(emulationResetButton).toHaveCount(0)
  await expect(appWindow.locator('.tab-emulation-mark')).toHaveCount(0)
  const resetEmulation = await client.callTool({ name: 'browser_emulate', arguments: { tabId } }) as CallToolResult
  expect(JSON.parse(text(resetEmulation))).toEqual({
    network: 'none',
    cacheDisabled: false,
    bypassServiceWorker: false,
    dataSaver: 'auto',
    cpuThrottlingRate: 1,
    animationPlaybackRate: 1,
    colorScheme: 'auto',
    reducedMotion: 'auto',
    mediaType: 'auto',
    forcedColors: 'auto',
    contrast: 'auto',
    reducedTransparency: 'auto',
    visionDeficiency: 'none'
  })
  const resetPage = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: `(async () => ({
        online: navigator.onLine,
        userAgent: navigator.userAgent,
        width: innerWidth,
        touchPoints: navigator.maxTouchPoints,
        header: await fetch('/headers').then((response) => response.json())
      }))()`
    }
  }) as CallToolResult
  expect(JSON.parse(text(resetPage))).toMatchObject({ online: true })
  expect(JSON.parse(text(resetPage)).userAgent).not.toContain('Hronaut Emulation Test')
  expect(JSON.parse(text(resetPage)).width).toBeGreaterThan(390)
  expect(JSON.parse(text(resetPage)).touchPoints).toBe(0)
  expect(JSON.parse(text(resetPage)).header).toEqual({ marker: null, language: expect.any(String) })
})

test('rejects unsupported rendering overlays from environment IPC without changing tab state', async ({ capabilities, appWindow }) => {
  const { client, tabId } = capabilities
  const { DEFAULT_BROWSER_ENVIRONMENT } = await import('../../src/shared/browser-environment.js')
  for (const name of ['toString', 'constructor', '__proto__']) {
    const environment = {
      ...DEFAULT_BROWSER_ENVIRONMENT,
      network: 'offline',
      renderingDebug: { ...DEFAULT_BROWSER_ENVIRONMENT.renderingDebug, ...JSON.parse(`{"${name}":true}`) }
    }
    await expect(appWindow.evaluate(`window.hronaut.setTabEnvironment(${JSON.stringify(tabId)}, JSON.parse(${JSON.stringify(JSON.stringify(environment))}))`))
      .rejects.toThrow(`Invalid rendering debug overlay: ${name}`)
  }
  const state = JSON.parse(text(await client.callTool({ name: 'browser_emulate', arguments: { tabId } }) as CallToolResult))
  expect(state.network).toBe('none')
  expect(state.renderingDebug).toBeUndefined()
})
