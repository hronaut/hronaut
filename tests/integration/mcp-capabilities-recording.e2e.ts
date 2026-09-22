import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('records repro steps, DOM changes, visual differences and browser issues', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, address, openPageTool } = capabilities
  const startedRepro = await client.callTool({
    name: 'browser_repro',
    arguments: { tabId, action: 'start' }
  }) as CallToolResult
  expect(startedRepro.isError, text(startedRepro)).not.toBe(true)
  expect(JSON.parse(text(startedRepro))).toMatchObject({ tabId, active: true, stepCount: 1 })
  await electronApp.evaluate(async ({ BrowserWindow, WebContentsView }) => {
    const view = BrowserWindow.getAllWindows()
      .flatMap((window) => window.contentView.children)
      .find((candidate): candidate is InstanceType<typeof WebContentsView> => (
        candidate instanceof WebContentsView && candidate.webContents.getTitle() === 'Capability fixture'
    ))
    if (!view) throw new Error('Active repro recorder fixture view disappeared')
    view.webContents.focus()
    await view.webContents.executeJavaScript("document.querySelector('#name').focus()")
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'S' })
    view.webContents.sendInputEvent({ type: 'char', keyCode: 'S' })
    view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'S' })
    const point = await view.webContents.executeJavaScript(`(() => {
      const bounds = document.querySelector('#hover').getBoundingClientRect();
      return { x: Math.round(bounds.left + bounds.width / 2), y: Math.round(bounds.top + bounds.height / 2) };
    })()`) as { x: number; y: number }
    view.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    view.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    view.webContents.sendInputEvent({ type: 'mouseWheel', x: point.x, y: point.y, deltaY: -120, canScroll: true })
  })
  await expect.poll(async () => {
    const current = await client.callTool({ name: 'browser_repro', arguments: { tabId, action: 'get' } }) as CallToolResult
    return (JSON.parse(text(current)) as { steps: Array<{ kind: string }> }).steps.map((step) => step.kind)
  }).toEqual(expect.arrayContaining(['navigate', 'input', 'click']))
  const stoppedRepro = await client.callTool({
    name: 'browser_repro',
    arguments: { tabId, action: 'stop' }
  }) as CallToolResult
  expect(stoppedRepro.isError, text(stoppedRepro)).not.toBe(true)
  const repro = JSON.parse(text(stoppedRepro)) as {
    active: boolean
    stepCount: number
    steps: Array<{ kind: string; description: string; valueRedacted?: boolean }>
  }
  expect(repro.active).toBe(false)
  expect(repro.steps).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'navigate' }),
    expect.objectContaining({ kind: 'input', valueRedacted: true }),
    expect.objectContaining({ kind: 'click' })
  ]))
  expect(text(stoppedRepro)).not.toContain('"key":"S"')
  const playwrightRepro = await client.callTool({
    name: 'browser_repro',
    arguments: { tabId, action: 'get', format: 'playwright' }
  }) as CallToolResult
  expect(playwrightRepro.isError, text(playwrightRepro)).not.toBe(true)
  expect(text(playwrightRepro)).toContain("import { test } from '@playwright/test'")
  expect(text(playwrightRepro)).toContain('process.env.HRONAUT_REPRO_INPUT_')
  expect(text(playwrightRepro)).toContain('.click()')
  expect(text(playwrightRepro)).not.toContain('"key":"S"')
  await openPageTool(/Repro recorder:/)
  const reproPanel = appWindow.getByRole('dialog', { name: 'Repro recorder' })
  await expect(reproPanel).toBeVisible()
  await expect(reproPanel).toContainText('Typed values, clipboard contents')
  await reproPanel.getByRole('button', { name: 'Copy timeline' }).click()
  await expect(reproPanel.getByRole('button', { name: 'Copied' })).toBeVisible()
  const copiedRepro = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  expect(JSON.parse(copiedRepro)).toMatchObject({ tabId, active: false, stepCount: repro.stepCount })
  expect(copiedRepro).not.toContain('"key":"S"')
  await reproPanel.getByRole('button', { name: 'Copy Playwright' }).click()
  await expect(reproPanel.getByRole('button', { name: 'Copied Playwright' })).toBeVisible()
  const copiedPlaywright = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  expect(copiedPlaywright).toContain("import { test } from '@playwright/test'")
  expect(copiedPlaywright).toContain('process.env.HRONAUT_REPRO_INPUT_')
  expect(copiedPlaywright).toContain('.click()')
  expect(copiedPlaywright).not.toContain('"key":"S"')
  await reproPanel.getByRole('button', { name: 'Close repro recorder' }).click()

  const startedDomChanges = await client.callTool({
    name: 'browser_dom_changes',
    arguments: { tabId, action: 'start' }
  }) as CallToolResult
  expect(startedDomChanges.isError, text(startedDomChanges)).not.toBe(true)
  expect(JSON.parse(text(startedDomChanges))).toMatchObject({ tabId, active: true, changeCount: 0 })
  const changedDom = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: `(() => {
        const marker = document.createElement('aside');
        marker.id = 'dom-secret-id';
        marker.className = 'dom-secret-class';
        marker.setAttribute('data-state', 'dom-secret-attribute-value');
        marker.textContent = 'dom-secret-text';
        document.body.append(marker);
        marker.setAttribute('aria-live', 'polite');
        marker.firstChild.data = 'dom-secret-updated-text';
        marker.remove();
        return true;
      })()`
    }
  }) as CallToolResult
  expect(changedDom.isError, text(changedDom)).not.toBe(true)
  const stoppedDomChanges = await client.callTool({
    name: 'browser_dom_changes',
    arguments: { tabId, action: 'stop' }
  }) as CallToolResult
  expect(stoppedDomChanges.isError, text(stoppedDomChanges)).not.toBe(true)
  const domChangesText = text(stoppedDomChanges)
  const domChanges = JSON.parse(domChangesText) as {
    active: boolean
    changeCount: number
    entries: Array<{ kind: string; target: string; attributeName?: string }>
  }
  expect(domChanges.active).toBe(false)
  expect(domChanges.changeCount).toBeGreaterThanOrEqual(4)
  expect(domChanges.entries).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'child-list' }),
    expect.objectContaining({ kind: 'attributes', attributeName: 'aria-live' }),
    expect.objectContaining({ kind: 'text' })
  ]))
  for (const secret of ['dom-secret-id', 'dom-secret-class', 'dom-secret-attribute-value', 'dom-secret-text', 'dom-secret-updated-text']) {
    expect(domChangesText).not.toContain(secret)
  }
  await openPageTool(/DOM changes:/)
  const domChangesPanel = appWindow.getByRole('dialog', { name: 'DOM changes' })
  await expect(domChangesPanel).toBeVisible()
  await expect(domChangesPanel).toContainText('Text, HTML, attribute values, IDs, classes, and form values are never recorded.')
  await domChangesPanel.getByRole('button', { name: 'Copy report' }).click()
  await expect(domChangesPanel.getByRole('button', { name: 'Copied' })).toBeVisible()
  const copiedDomChanges = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  expect(JSON.parse(copiedDomChanges)).toMatchObject({ tabId, active: false, changeCount: domChanges.changeCount })
  expect(copiedDomChanges).not.toContain('dom-secret')
  await domChangesPanel.getByRole('button', { name: 'Close DOM changes' }).click()

  const visualBaselineResult = await client.callTool({
    name: 'browser_visual_compare',
    arguments: { tabId, action: 'set-baseline', settleMs: 0 }
  }) as CallToolResult
  expect(visualBaselineResult.isError, text(visualBaselineResult)).not.toBe(true)
  expect(JSON.parse(text(visualBaselineResult))).toMatchObject({
    tabId,
    status: 'baseline',
    baseline: { width: expect.any(Number), height: expect.any(Number) }
  })
  expect(visualBaselineResult.content.some((item) => item.type === 'image')).toBe(false)
  const visualMutationResult = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: `(() => {
        const marker = document.createElement('div');
        marker.id = 'visual-compare-marker';
        marker.textContent = 'Changed';
        Object.assign(marker.style, {
          position: 'fixed', right: '24px', bottom: '24px', width: '180px', height: '100px',
          background: '#ff00aa', color: '#fff', zIndex: '2147483647'
        });
        document.body.append(marker);
        return true;
      })()`
    }
  }) as CallToolResult
  expect(visualMutationResult.isError, text(visualMutationResult)).not.toBe(true)
  const visualCompareResult = await client.callTool({
    name: 'browser_visual_compare',
    arguments: { tabId, action: 'compare', settleMs: 100 }
  }) as CallToolResult
  expect(visualCompareResult.isError, text(visualCompareResult)).not.toBe(true)
  const visualReport = JSON.parse(text(visualCompareResult)) as {
    status: string
    changedPixels: number
    changedPercent: number
    diffBounds?: { width: number; height: number }
  }
  expect(visualReport.status).toBe('compared')
  expect(visualReport.changedPixels).toBeGreaterThan(10_000)
  expect(visualReport.changedPercent).toBeGreaterThan(0)
  expect(visualReport.diffBounds).toMatchObject({ width: expect.any(Number), height: expect.any(Number) })
  const visualDiff = visualCompareResult.content.find((item) => item.type === 'image')
  expect(visualDiff?.type === 'image' ? Buffer.from(visualDiff.data, 'base64').subarray(0, 8) : Buffer.alloc(0)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  )
  await openPageTool(/Visual compare:/)
  const visualPanel = appWindow.getByRole('dialog', { name: 'Visual compare' })
  await expect(visualPanel).toBeVisible()
  await expect(visualPanel).toContainText('% of pixels changed')
  await expect(visualPanel.getByRole('img', { name: /Visual difference/ })).toBeVisible()
  await visualPanel.getByRole('button', { name: 'Copy diff PNG' }).click()
  await expect(visualPanel.getByRole('button', { name: 'Copied' })).toBeVisible()
  const copiedVisualDiff = await electronApp.evaluate(async ({ clipboard, nativeImage }) => {
    const items = await clipboard.read()
    const png = items.find((item) => item.types.includes('image/png'))
    const data = png ? await ((await png.getType('image/png')) as Blob).arrayBuffer() : new ArrayBuffer(0)
    const image = nativeImage.createFromBuffer(Buffer.from(data))
    return { empty: image.isEmpty(), size: image.getSize(), signature: [...image.toPNG().subarray(0, 8)] }
  })
  expect(copiedVisualDiff).toMatchObject({
    empty: false,
    size: { width: expect.any(Number), height: expect.any(Number) },
    signature: [137, 80, 78, 71, 13, 10, 26, 10]
  })
  await visualPanel.getByRole('button', { name: 'Close visual compare' }).click()

  const openedIssuesTab = await client.callTool({
    name: 'browser_new_tab',
    arguments: { url: `http://127.0.0.1:${address.port}/issues`, active: true }
  }) as CallToolResult
  const issueTabId = JSON.parse(text(openedIssuesTab)).activeTabId as string
  await client.callTool({ name: 'browser_wait', arguments: { tabId: issueTabId } })
  const inspectorIssuesResult = await client.callTool({
    name: 'browser_issues',
    arguments: { tabId: issueTabId, action: 'list' }
  }) as CallToolResult
  expect(inspectorIssuesResult.isError, text(inspectorIssuesResult)).not.toBe(true)
  const inspectorIssues = JSON.parse(text(inspectorIssuesResult)) as {
    issueCount: number
    issues: Array<{ code: string; reasons: string[] }>
  }
  expect(inspectorIssues.issueCount).toBeGreaterThan(0)
  expect(inspectorIssues.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'QuirksModeIssue' })
  ]))
  expect(text(inspectorIssuesResult)).not.toContain('server-secret')

  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  const pageToolsWithIssues = appWindow.getByRole('dialog', { name: 'Page tools' })
  await expect(pageToolsWithIssues.getByRole('button', { name: /Open browser issues:/ })).toContainText('browser issue')
  await pageToolsWithIssues.getByRole('button', { name: /Open browser issues:/ }).click()
  const inspectorIssuesPanel = appWindow.getByRole('dialog', { name: 'Issues' })
  await expect(inspectorIssuesPanel).toBeVisible()
  await expect(inspectorIssuesPanel.getByRole('combobox', { name: 'Dock browser issues' })).toHaveValue('right')
  await expect(inspectorIssuesPanel).toContainText('Page rendered in quirks mode')
  await inspectorIssuesPanel.getByRole('button', { name: 'Copy issues' }).click()
  await expect(inspectorIssuesPanel.getByRole('button', { name: 'Copied' })).toBeVisible()
  const copiedInspectorIssues = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  expect(JSON.parse(copiedInspectorIssues)).toMatchObject({ tabId: issueTabId, issueCount: expect.any(Number) })
  expect(copiedInspectorIssues).not.toContain('server-secret')
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
  const ukrainianIssuesPanel = appWindow.getByRole('dialog', { name: 'Проблеми' })
  await expect(ukrainianIssuesPanel).toContainText('Задіяні ресурси')
  await ukrainianIssuesPanel.getByRole('button', { name: 'Очистити' }).click()
  await expect(ukrainianIssuesPanel).toContainText('Проблем браузера не зібрано')
  await ukrainianIssuesPanel.getByRole('button', { name: 'Закрити проблеми браузера' }).click()
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")
  await client.callTool({ name: 'browser_close_tab', arguments: { tabId: issueTabId } })
  await client.callTool({ name: 'browser_select_tab', arguments: { tabId } })
})
