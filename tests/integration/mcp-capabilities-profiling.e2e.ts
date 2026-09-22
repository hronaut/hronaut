import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('coordinates coverage, CPU and memory profiling across tabs and DevTools', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, address, redactedFixtureUrl, openPageTool } = capabilities
  const coverageStarted = await client.callTool({
    name: 'browser_code_coverage',
    arguments: { tabId, action: 'start', mode: 'function', reload: true }
  }) as CallToolResult
  expect(coverageStarted.isError, text(coverageStarted)).not.toBe(true)
  expect(JSON.parse(text(coverageStarted))).toMatchObject({
    tabId,
    url: redactedFixtureUrl,
    status: 'recording',
    recording: { mode: 'function', startedUrl: redactedFixtureUrl }
  })
  expect(text(coverageStarted)).not.toContain('top-level-navigation-secret')
  await client.callTool({ name: 'browser_wait', arguments: { tabId } })
  const coverageStopped = await client.callTool({
    name: 'browser_code_coverage',
    arguments: { tabId, action: 'stop' }
  }) as CallToolResult
  expect(coverageStopped.isError, text(coverageStopped)).not.toBe(true)
  const coverageReport = JSON.parse(text(coverageStopped))
  expect(coverageReport).toMatchObject({
    tabId,
    url: redactedFixtureUrl,
    status: 'complete',
    report: {
      startedUrl: redactedFixtureUrl,
      currentUrl: redactedFixtureUrl,
      mode: 'function',
      totalBytes: expect.any(Number),
      usedBytes: expect.any(Number),
      unusedBytes: expect.any(Number),
      resources: expect.any(Array)
    }
  })
  expect(coverageReport.report.totalBytes).toBeGreaterThan(0)
  expect(coverageReport.report.usedBytes).toBeLessThanOrEqual(coverageReport.report.totalBytes)
  expect(JSON.stringify(coverageReport)).not.toContain('hronaut-console-marker')
  expect(JSON.stringify(coverageReport)).not.toContain('top-level-navigation-secret')

  await openPageTool(/Code coverage:/)
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
  const coveragePanel = appWindow.getByRole('dialog', { name: 'Покриття коду' })
  await expect(coveragePanel).toBeVisible()
  await expect(coveragePanel).toContainText('Не використано')
  await expect(coveragePanel).toContainText('Ресурси')
  await coveragePanel.getByRole('button', { name: 'Закрити покриття коду' }).click()
  await expect(coveragePanel).toBeHidden()
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")

  const cpuProfileStarted = await client.callTool({
    name: 'browser_cpu_profile',
    arguments: { tabId, action: 'start' }
  }) as CallToolResult
  expect(cpuProfileStarted.isError, text(cpuProfileStarted)).not.toBe(true)
  expect(JSON.parse(text(cpuProfileStarted))).toMatchObject({
    tabId,
    url: redactedFixtureUrl,
    status: 'recording',
    recording: { startedUrl: redactedFixtureUrl }
  })
  expect(text(cpuProfileStarted)).not.toContain('top-level-navigation-secret')
  const cpuProbe = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: 'window.runCpuProfileProbe()' }
  }) as CallToolResult
  expect(cpuProbe.isError, text(cpuProbe)).not.toBe(true)
  const cpuProfileStopped = await client.callTool({
    name: 'browser_cpu_profile',
    arguments: { tabId, action: 'stop' }
  }) as CallToolResult
  expect(cpuProfileStopped.isError, text(cpuProfileStopped)).not.toBe(true)
  const cpuProfile = JSON.parse(text(cpuProfileStopped))
  expect(cpuProfile).toMatchObject({
    tabId,
    url: redactedFixtureUrl,
    status: 'complete',
    report: {
      startedUrl: redactedFixtureUrl,
      currentUrl: redactedFixtureUrl,
      durationMs: expect.any(Number),
      sampledTimeMs: expect.any(Number),
      sampleCount: expect.any(Number),
      hotspots: expect.any(Array)
    }
  })
  expect(cpuProfile.report.sampleCount).toBeGreaterThan(0)
  expect(cpuProfile.report.hotspots).toEqual(expect.arrayContaining([
    expect.objectContaining({
      functionName: 'cpuProfileBusyLoop',
      url: expect.stringContaining('token=%5BREDACTED%5D'),
      selfTimeMs: expect.any(Number),
      samples: expect.any(Number)
    })
  ]))
  expect(JSON.stringify(cpuProfile)).not.toContain('cpu-profile-secret')
  expect(JSON.stringify(cpuProfile)).not.toContain('top-level-navigation-secret')

  await openPageTool(/JavaScript CPU profile:/)
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
  const cpuProfilePanel = appWindow.getByRole('dialog', { name: 'Профіль CPU JavaScript' })
  await expect(cpuProfilePanel).toBeVisible()
  await expect(cpuProfilePanel).toContainText('cpuProfileBusyLoop')
  await expect(cpuProfilePanel).toContainText('Вибраний час')
  await cpuProfilePanel.getByRole('button', { name: 'Записати знову' }).click()
  await expect(cpuProfilePanel).toContainText('Запис активності CPU триває')
  expect(await appWindow.evaluate(`window.hronaut.toggleDevTools(${JSON.stringify(tabId)})`)).toBe(true)
  await expect(cpuProfilePanel).toContainText('Знайдіть гарячі функції JavaScript')
  await expect.poll(() => electronApp.evaluate(({ webContents }, requestedOrigin) => {
    return webContents.getAllWebContents().some((contents) => (
      contents.getURL().startsWith(requestedOrigin) && contents.isDevToolsOpened()
    ))
  }, `http://127.0.0.1:${address.port}`)).toBe(true)
  expect(await appWindow.evaluate(`window.hronaut.toggleDevTools(${JSON.stringify(tabId)})`)).toBe(false)
  await expect.poll(() => electronApp.evaluate(({ webContents }, requestedOrigin) => {
    return webContents.getAllWebContents().some((contents) => (
      contents.getURL().startsWith(requestedOrigin) && contents.isDevToolsOpened()
    ))
  }, `http://127.0.0.1:${address.port}`)).toBe(false)
  const cpuAfterDevToolsResult = await client.callTool({
    name: 'browser_cpu_profile',
    arguments: { tabId, action: 'get' }
  }) as CallToolResult
  expect(cpuAfterDevToolsResult.isError, text(cpuAfterDevToolsResult)).not.toBe(true)
  expect(JSON.parse(text(cpuAfterDevToolsResult))).toMatchObject({
    tabId,
    status: 'idle'
  })
  await cpuProfilePanel.getByRole('button', { name: 'Закрити профіль CPU JavaScript' }).click()
  await expect(cpuProfilePanel).toBeHidden()
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")

  const memoryBaselineResult = await client.callTool({
    name: 'browser_memory',
    arguments: { tabId, action: 'set-baseline', collectGarbage: true }
  }) as CallToolResult
  expect(memoryBaselineResult.isError, text(memoryBaselineResult)).not.toBe(true)
  const memoryBaseline = JSON.parse(text(memoryBaselineResult))
  expect(memoryBaseline).toMatchObject({
    tabId,
    url: redactedFixtureUrl,
    action: 'set-baseline',
    forcedGarbageCollection: true,
    allocationStatus: 'idle',
    baseline: {
      jsHeapUsedBytes: expect.any(Number),
      nodes: expect.any(Number),
      eventListeners: expect.any(Number)
    }
  })

  const allocationStartResult = await client.callTool({
    name: 'browser_memory',
    arguments: { tabId, action: 'start-allocation-sampling' }
  }) as CallToolResult
  expect(allocationStartResult.isError, text(allocationStartResult)).not.toBe(true)
  expect(JSON.parse(text(allocationStartResult))).toMatchObject({
    tabId,
    url: redactedFixtureUrl,
    action: 'start-allocation-sampling',
    allocationStatus: 'recording',
    allocationRecording: { startedAt: expect.any(String), startedUrl: redactedFixtureUrl }
  })
  expect(text(allocationStartResult)).not.toContain('top-level-navigation-secret')
  const cpuDuringAllocation = await client.callTool({
    name: 'browser_cpu_profile',
    arguments: { tabId, action: 'start' }
  }) as CallToolResult
  expect(cpuDuringAllocation.isError).toBe(true)
  expect(text(cpuDuringAllocation)).toContain('Stop memory allocation sampling')
  const coverageDuringAllocation = await client.callTool({
    name: 'browser_code_coverage',
    arguments: { tabId, action: 'start', reload: false }
  }) as CallToolResult
  expect(coverageDuringAllocation.isError).toBe(true)
  expect(text(coverageDuringAllocation)).toContain('Stop memory allocation sampling')

  const retainedMemory = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: `(function retainMemoryForProfile() {
        const root = document.createElement('section')
        root.id = 'retained-memory-fixture'
        const records = []
        for (let index = 0; index < 800; index += 1) {
          const node = document.createElement('button')
          node.textContent = 'retained-' + index
          node.addEventListener('click', () => index)
          root.append(node)
          records.push({ index, payload: new Array(200).fill(index) })
        }
        document.body.append(root)
        window.__hronautRetainedMemory = { root, records }
        return { nodes: root.childElementCount, records: records.length }
      })()`
    }
  }) as CallToolResult
  expect(JSON.parse(text(retainedMemory))).toEqual({ nodes: 800, records: 800 })

  const allocationStopResult = await client.callTool({
    name: 'browser_memory',
    arguments: { tabId, action: 'stop-allocation-sampling' }
  }) as CallToolResult
  expect(allocationStopResult.isError, text(allocationStopResult)).not.toBe(true)
  const allocationStop = JSON.parse(text(allocationStopResult))
  expect(allocationStop).toMatchObject({
    tabId,
    url: redactedFixtureUrl,
    action: 'stop-allocation-sampling',
    allocationStatus: 'complete',
    allocationProfile: {
      startedUrl: redactedFixtureUrl,
      currentUrl: redactedFixtureUrl,
      sampledBytes: expect.any(Number),
      sampleCount: expect.any(Number),
      hotspots: expect.any(Array)
    }
  })
  expect(allocationStop.allocationProfile.sampledBytes).toBeGreaterThan(0)
  expect(allocationStop.allocationProfile.hotspots).toEqual(expect.arrayContaining([
    expect.objectContaining({
      functionName: 'retainMemoryForProfile',
      selfBytes: expect.any(Number),
      selfPercent: expect.any(Number)
    })
  ]))
  expect(JSON.stringify(allocationStop.allocationProfile)).not.toContain('retained-memory-fixture')
  expect(JSON.stringify(allocationStop.allocationProfile)).not.toContain('retained-0')

  const memoryMeasurementResult = await client.callTool({
    name: 'browser_memory',
    arguments: { tabId, action: 'measure', collectGarbage: true }
  }) as CallToolResult
  expect(memoryMeasurementResult.isError, text(memoryMeasurementResult)).not.toBe(true)
  const memoryMeasurement = JSON.parse(text(memoryMeasurementResult))
  expect(memoryMeasurement).toMatchObject({
    tabId,
    url: redactedFixtureUrl,
    action: 'measure',
    forcedGarbageCollection: true,
    delta: {
      jsHeapUsedBytes: expect.any(Number),
      nodes: expect.any(Number),
      eventListeners: expect.any(Number)
    }
  })
  expect(memoryMeasurement.current.jsHeapUsedBytes).toBeGreaterThan(memoryMeasurement.baseline.jsHeapUsedBytes)
  expect(memoryMeasurement.delta.nodes).toBeGreaterThanOrEqual(800)
  expect(memoryMeasurement.delta.eventListeners).toBeGreaterThanOrEqual(800)
  expect(JSON.stringify(memoryMeasurement)).not.toContain('retained-memory-fixture')
  expect(JSON.stringify(memoryMeasurement)).not.toContain('top-level-navigation-secret')

  await openPageTool(/Page memory:/)
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
  const memoryPanel = appWindow.getByRole('dialog', { name: 'Памʼять сторінки' })
  await expect(memoryPanel).toBeVisible()
  await expect(memoryPanel).toContainText('Базовий рівень виконання активний')
  await expect(memoryPanel).toContainText('Зростання є підказкою, а не доказом витоку')
  await expect(memoryPanel).toContainText('Знайдіть утримані розподіли за функцією')
  await expect(memoryPanel).toContainText('Вибрані активні байти')
  await expect(memoryPanel).toContainText('retainMemoryForProfile')
  await expect(memoryPanel.getByRole('button', { name: 'GC і вимірювання' })).toBeVisible()
  await memoryPanel.getByRole('button', { name: 'Очистити', exact: true }).click()
  await expect(memoryPanel).toContainText('Базового рівня немає')
  await expect(memoryPanel).toContainText('retainMemoryForProfile')
  await expect(memoryPanel).not.toContainText('Базовий рівень очищено')
  await memoryPanel.getByRole('button', { name: 'Закрити звіт памʼяті' }).click()
  await expect(memoryPanel).toBeHidden()
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")

  const sameUrlTabResult = await client.callTool({
    name: 'browser_new_tab',
    arguments: { url: `http://127.0.0.1:${address.port}/`, active: true }
  }) as CallToolResult
  expect(sameUrlTabResult.isError, text(sameUrlTabResult)).not.toBe(true)
  const sameUrlTabId = JSON.parse(text(sameUrlTabResult)).activeTabId as string
  await client.callTool({ name: 'browser_wait', arguments: { tabId: sameUrlTabId } })
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  const sameUrlPageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
  await expect(sameUrlPageTools).toBeVisible()
  await expect(sameUrlPageTools.getByRole('button', { name: 'Page memory: Heap, DOM, and allocation diagnostics' })).toBeVisible()
  await expect(sameUrlPageTools).not.toContainText('retainMemoryForProfile')
  await sameUrlPageTools.getByRole('button', { name: 'Close page tools' }).click()
  await client.callTool({ name: 'browser_close_tab', arguments: { tabId: sameUrlTabId } })
  await client.callTool({ name: 'browser_select_tab', arguments: { tabId } })
})
