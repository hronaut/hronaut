import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('retains exception stacks and redacts console previews and exports', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, openPageTool } = capabilities
  const consoleExceptionProbe = await client.callTool({
    name: 'browser_click',
    arguments: { tabId, selector: '#throw' }
  }) as CallToolResult
  expect(consoleExceptionProbe.isError, text(consoleExceptionProbe)).not.toBe(true)
  let consoleException: Record<string, unknown> | undefined
  let consoleErrors: Array<Record<string, unknown>> = []
  await expect.poll(async () => {
    const consoleResult = await client.callTool({
      name: 'browser_console',
      arguments: { tabId, level: 'error' }
    }) as CallToolResult
    consoleErrors = JSON.parse(text(consoleResult)) as Array<Record<string, unknown>>
    consoleException = [...consoleErrors].reverse().find((message) => (
      String(message.message).includes('console-stack-kept')
    ))
    return consoleException?.kind === 'exception'
      && Array.isArray(consoleException.stack)
      && consoleException.stack.length >= 2
  }).toBeTruthy()
  expect(consoleErrors.filter((message) => String(message.message).includes('console-stack-kept'))).toHaveLength(1)
  expect(consoleException).toMatchObject({
    level: 'error',
    kind: 'exception',
    message: expect.stringContaining('console-stack-kept token=[REDACTED]'),
    lineNumber: expect.any(Number),
    columnNumber: expect.any(Number),
    stack: expect.arrayContaining([
      expect.objectContaining({ functionName: 'innerConsoleFailure', lineNumber: expect.any(Number), columnNumber: expect.any(Number) }),
      expect.objectContaining({ functionName: 'outerConsoleFailure', lineNumber: expect.any(Number), columnNumber: expect.any(Number) })
    ])
  })
  expect(JSON.stringify(consoleException)).not.toContain('console-stack-secret')

  const repeatedExceptionProbe = await client.callTool({
    name: 'browser_click',
    arguments: { tabId, selector: '#throw' }
  }) as CallToolResult
  expect(repeatedExceptionProbe.isError, text(repeatedExceptionProbe)).not.toBe(true)
  await expect.poll(async () => {
    const consoleResult = await client.callTool({
      name: 'browser_console',
      arguments: { tabId, level: 'error' }
    }) as CallToolResult
    const repeatedErrors = (JSON.parse(text(consoleResult)) as Array<Record<string, unknown>>)
      .filter((message) => String(message.message).includes('console-stack-kept'))
    return repeatedErrors.length === 2 && repeatedErrors.every((message) => (
      message.kind === 'exception'
      && message.repeatCount === undefined
      && Array.isArray(message.stack)
      && message.stack.length >= 2
    ))
  }).toBeTruthy()

  const consoleStackKindsProbe = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: 'window.runConsoleStackKindsProbe()' }
  }) as CallToolResult
  expect(consoleStackKindsProbe.isError, text(consoleStackKindsProbe)).not.toBe(true)
  let stackKindMessages: Array<Record<string, unknown>> = []
  await expect.poll(async () => {
    const consoleResult = await client.callTool({
      name: 'browser_console',
      arguments: { tabId }
    }) as CallToolResult
    stackKindMessages = (JSON.parse(text(consoleResult)) as Array<Record<string, unknown>>)
      .filter((message) => String(message.message).includes('console-') && String(message.message).includes('-stack-kept'))
    return ['console-error-stack-kept', 'console-trace-stack-kept', 'console-assert-stack-kept'].every((marker) => (
      stackKindMessages.some((message) => (
        String(message.message).includes(marker)
        && Array.isArray(message.stack)
        && message.stack.length >= 2
      ))
    ))
  }).toBeTruthy()
  expect(stackKindMessages.find((message) => String(message.message).includes('console-error-stack-kept')))
    .toMatchObject({ level: 'error', stack: expect.arrayContaining([
      expect.objectContaining({ functionName: 'innerConsoleError' }),
      expect.objectContaining({ functionName: 'outerConsoleError' })
    ]) })
  expect(stackKindMessages.find((message) => String(message.message).includes('console-trace-stack-kept')))
    .toMatchObject({ level: 'info', stack: expect.arrayContaining([
      expect.objectContaining({ functionName: 'innerConsoleTrace' }),
      expect.objectContaining({ functionName: 'outerConsoleTrace' })
    ]) })
  expect(stackKindMessages.find((message) => String(message.message).includes('console-assert-stack-kept')))
    .toMatchObject({ level: 'error', stack: expect.arrayContaining([
      expect.objectContaining({ functionName: 'innerConsoleAssert' }),
      expect.objectContaining({ functionName: 'outerConsoleAssert' })
    ]) })
  expect(JSON.stringify(stackKindMessages)).not.toContain('console-error-secret')
  expect(JSON.stringify(stackKindMessages)).not.toContain('console-trace-secret')
  expect(JSON.stringify(stackKindMessages)).not.toContain('console-assert-secret')

  const consoleSeedResult = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: `(() => {
        window.runConsoleWarningProbe();
        console.info('human-console-info');
        return true;
      })()`
    }
  }) as CallToolResult
  expect(consoleSeedResult.isError, text(consoleSeedResult)).not.toBe(true)
  let consoleWarnings: Array<Record<string, unknown>> = []
  await expect.poll(async () => {
    const consoleResult = await client.callTool({
      name: 'browser_console',
      arguments: { tabId, level: 'warning' }
    }) as CallToolResult
    consoleWarnings = (JSON.parse(text(consoleResult)) as Array<Record<string, unknown>>)
      .filter((message) => String(message.message).includes('human-console-warning'))
    return consoleWarnings.length === 1 ? consoleWarnings[0]?.repeatCount : undefined
  }).toBe(3)
  expect(consoleWarnings[0]).toMatchObject({
    stack: expect.arrayContaining([
      expect.objectContaining({ functionName: 'innerConsoleWarning' }),
      expect.objectContaining({ functionName: 'outerConsoleWarning' })
    ])
  })
  await openPageTool('Open Console')
  const consolePanel = appWindow.getByRole('dialog', { name: 'Console' })
  await expect(consolePanel).toBeVisible()
  await expect(consolePanel.getByLabel('Preserve logs')).toBeChecked()
  await expect(consolePanel).toContainText('human-console-warning')
  await expect(consolePanel).not.toContainText('human-console-secret')
  await consolePanel.getByRole('searchbox', { name: 'Filter Console messages' }).fill('console-stack-kept')
  await consolePanel.getByRole('combobox', { name: 'Filter Console by level' }).selectOption('error')
  await expect(consolePanel).toContainText('console-stack-kept token=[REDACTED]')
  const firstConsoleStack = consolePanel.getByText('Call stack', { exact: false }).first()
  await expect(firstConsoleStack).toBeVisible()
  await firstConsoleStack.click()
  await expect(consolePanel).toContainText('innerConsoleFailure')
  await expect(consolePanel).toContainText('outerConsoleFailure')
  await expect(consolePanel).not.toContainText('console-stack-secret')
  await consolePanel.getByRole('searchbox', { name: 'Filter Console messages' }).fill('human-console')
  await consolePanel.getByRole('combobox', { name: 'Filter Console by level' }).selectOption('warning')
  await expect(consolePanel).toContainText('human-console-warning')
  await expect(consolePanel.getByText('×3', { exact: true })).toBeVisible()
  await expect(consolePanel).not.toContainText('human-console-info')
  const warningStack = consolePanel.getByText('Call stack', { exact: false })
  await expect(warningStack).toBeVisible()
  await warningStack.click()
  await expect(consolePanel).toContainText('innerConsoleWarning')
  await expect(consolePanel).toContainText('outerConsoleWarning')

  const copyConsoleEntry = consolePanel.getByRole('button', { name: 'Copy Console entry' })
  await copyConsoleEntry.click()
  await expect(copyConsoleEntry).toContainText('Copied')
  const copiedConsoleEntry = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  expect(JSON.parse(copiedConsoleEntry)).toMatchObject({
    tabId,
    scope: 'entry',
    messages: [expect.objectContaining({
      repeatCount: 3,
      stack: expect.arrayContaining([
        expect.objectContaining({ functionName: 'innerConsoleWarning' }),
        expect.objectContaining({ functionName: 'outerConsoleWarning' })
      ])
    })]
  })
  expect(copiedConsoleEntry).not.toContain('human-console-secret')

  await consolePanel.getByRole('button', { name: 'Copy all' }).click()
  await expect(consolePanel.getByRole('button', { name: 'Copied all' })).toBeVisible()
  const copiedAllConsole = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  expect(JSON.parse(copiedAllConsole)).toMatchObject({ tabId, scope: 'all' })
  expect(copiedAllConsole).toContain('human-console-warning')
  expect(copiedAllConsole).toContain('human-console-info')
  expect(copiedAllConsole).not.toContain('human-console-secret')

  await consolePanel.getByRole('button', { name: 'Copy filtered' }).click()
  await expect(consolePanel.getByRole('button', { name: 'Copied filtered' })).toBeVisible()
  const copiedConsole = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
  expect(JSON.parse(copiedConsole)).toMatchObject({ tabId, scope: 'filtered', filter: { query: 'human-console', level: 'warning' } })
  expect(JSON.parse(copiedConsole)).toMatchObject({ messages: [expect.objectContaining({ repeatCount: 3 })] })
  expect(copiedConsole).toContain('human-console-warning')
  expect(copiedConsole).not.toContain('human-console-secret')
  expect(copiedConsole).not.toContain('console-url-secret')
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
  const ukrainianConsolePanel = appWindow.getByRole('dialog', { name: 'Консоль' })
  await expect(ukrainianConsolePanel).toContainText('Попередження')
  await expect(ukrainianConsolePanel.getByRole('searchbox', { name: 'Фільтрувати повідомлення консолі' })).toHaveValue('human-console')
  await ukrainianConsolePanel.getByRole('button', { name: 'Очистити' }).click()
  await expect(ukrainianConsolePanel).toContainText('Повідомлень консолі ще немає')
  await ukrainianConsolePanel.getByRole('button', { name: 'Закрити консоль' }).click()
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")

  await client.callTool({ name: 'browser_select_tab', arguments: { tabId } })
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(tabId)
})
