import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('fills forms and dispatches keyboard, pointer, upload and viewport actions', async ({ capabilities, profileDirectory }) => {
  const { client, tabId } = capabilities
  const selected = await client.callTool({
    name: 'browser_select',
    arguments: { tabId, selector: '#choice', value: 'Two' }
  }) as CallToolResult
  expect(selected.isError).not.toBe(true)
  expect(JSON.parse(text(selected))).toMatchObject({ value: 'two', label: 'Two' })

  const filled = await client.callTool({
    name: 'browser_fill_form',
    arguments: {
      tabId,
      fields: [
        { selector: '#name', value: 'Ada' },
        { selector: '#agree', value: true }
      ]
    }
  }) as CallToolResult
  expect(filled.isError, text(filled)).not.toBe(true)
  const formState = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: "({ name: document.querySelector('#name').value, agree: document.querySelector('#agree').checked })" }
  }) as CallToolResult
  expect(JSON.parse(text(formState))).toEqual({ name: 'Ada', agree: true })

  await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: "document.querySelector('#name').focus(); window.hronautKeyboardEvents = []; true"
    }
  })
  const selectedAll = await client.callTool({
    name: 'browser_press',
    arguments: { tabId, key: 'Control+A' }
  }) as CallToolResult
  expect(selectedAll.isError, text(selectedAll)).not.toBe(true)
  const shortcutState = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: "({ start: document.querySelector('#name').selectionStart, end: document.querySelector('#name').selectionEnd, events: window.hronautKeyboardEvents })"
    }
  }) as CallToolResult
  expect(JSON.parse(text(shortcutState))).toEqual({
    start: 0,
    end: 3,
    events: [
      { type: 'keydown', key: 'a', control: true, shift: false, alt: false, meta: false },
      { type: 'keyup', key: 'a', control: true, shift: false, alt: false, meta: false }
    ]
  })

  const replacedSelection = await client.callTool({
    name: 'browser_press',
    arguments: { tabId, key: 'x' }
  }) as CallToolResult
  expect(replacedSelection.isError, text(replacedSelection)).not.toBe(true)
  const pressedCharacter = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: "document.querySelector('#name').value" }
  }) as CallToolResult
  expect(text(pressedCharacter)).toBe('x')

  await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: "document.querySelector('#name').value = ''; window.hronautKeyboardEvents = []; true"
    }
  })
  const shiftedCharacter = await client.callTool({
    name: 'browser_press',
    arguments: { tabId, key: 'Shift+x' }
  }) as CallToolResult
  expect(shiftedCharacter.isError, text(shiftedCharacter)).not.toBe(true)
  const shiftedCharacterState = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: "({ value: document.querySelector('#name').value, events: window.hronautKeyboardEvents })"
    }
  }) as CallToolResult
  expect(JSON.parse(text(shiftedCharacterState))).toEqual({
    value: 'X',
    events: [
      { type: 'keydown', key: 'X', control: false, shift: true, alt: false, meta: false },
      { type: 'keyup', key: 'X', control: false, shift: true, alt: false, meta: false }
    ]
  })

  const invalidKeyCombination = await client.callTool({
    name: 'browser_press',
    arguments: { tabId, key: 'Control+A+B' }
  }) as CallToolResult
  expect(invalidKeyCombination.isError).toBe(true)
  expect(text(invalidKeyCombination)).toContain('exactly one non-modifier key')

  const invalidPromptClick = await client.callTool({
    name: 'browser_click',
    arguments: { tabId, selector: '#double-click', promptText: 'ignored without an action' }
  }) as CallToolResult
  expect(invalidPromptClick.isError).toBe(true)
  expect(text(invalidPromptClick)).toContain('promptText requires dialogAction: accept')

  const invalidDialogDoubleClick = await client.callTool({
    name: 'browser_click',
    arguments: { tabId, selector: '#double-click', doubleClick: true, dialogAction: 'dismiss' }
  }) as CallToolResult
  expect(invalidDialogDoubleClick.isError).toBe(true)
  expect(text(invalidDialogDoubleClick)).toContain('doubleClick cannot be combined with dialogAction')

  const invalidDialogNativeClick = await client.callTool({
    name: 'browser_click',
    arguments: { tabId, selector: '#double-click', native: true, dialogAction: 'dismiss' }
  }) as CallToolResult
  expect(invalidDialogNativeClick.isError).toBe(true)
  expect(text(invalidDialogNativeClick)).toContain('native cannot be combined with dialogAction')

  const doubleClicked = await client.callTool({
    name: 'browser_click',
    arguments: { tabId, selector: '#double-click', doubleClick: true }
  }) as CallToolResult
  expect(doubleClicked.isError, text(doubleClicked)).not.toBe(true)
  const doubleClickState = await client.callTool({
    name: 'browser_evaluate',
    arguments: {
      tabId,
      script: "({ clicks: document.querySelector('#double-click').dataset.clicks, doubleClicks: document.querySelector('#double-click').dataset.doubleClicks })"
    }
  }) as CallToolResult
  expect(JSON.parse(text(doubleClickState))).toEqual({ clicks: '2', doubleClicks: '1' })

  const acceptedPrompt = await client.callTool({
    name: 'browser_click',
    arguments: {
      tabId,
      selector: '#prompt',
      dialogAction: 'accept',
      promptText: 'typed by agent'
    }
  }) as CallToolResult
  expect(acceptedPrompt.isError, text(acceptedPrompt)).not.toBe(true)
  const acceptedPromptValue = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: "document.querySelector('#prompt').dataset.result" }
  }) as CallToolResult
  expect(text(acceptedPromptValue)).toBe('typed by agent')

  const dismissedPrompt = await client.callTool({
    name: 'browser_click',
    arguments: { tabId, selector: '#prompt', dialogAction: 'dismiss' }
  }) as CallToolResult
  expect(dismissedPrompt.isError, text(dismissedPrompt)).not.toBe(true)
  const dismissedPromptValue = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: "document.querySelector('#prompt').dataset.result" }
  }) as CallToolResult
  expect(text(dismissedPromptValue)).toBe('null')

  const hovered = await client.callTool({
    name: 'browser_hover',
    arguments: { tabId, selector: '#hover' }
  }) as CallToolResult
  expect(hovered.isError, text(hovered)).not.toBe(true)
  await expect.poll(async () => {
    const result = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: "document.querySelector('#hover').dataset.hovered" }
    }) as CallToolResult
    return text(result)
  }).toBe('true')

  const dragged = await client.callTool({
    name: 'browser_drag',
    arguments: { tabId, sourceSelector: '#drag', targetSelector: '#drop' }
  }) as CallToolResult
  expect(dragged.isError, text(dragged)).not.toBe(true)
  await expect.poll(async () => {
    const result = await client.callTool({
      name: 'browser_evaluate',
      arguments: { tabId, script: "document.querySelector('#drop').textContent" }
    }) as CallToolResult
    return text(result)
  }).toBe('dragged')

  const resized = await client.callTool({
    name: 'browser_resize',
    arguments: { tabId, width: 390, height: 640 }
  }) as CallToolResult
  expect(JSON.parse(text(resized))).toMatchObject({ width: 390, height: 640 })
  await client.callTool({ name: 'browser_resize', arguments: { tabId, reset: true } })

  const uploadPath = join(profileDirectory, 'upload-fixture.txt')
  await writeFile(uploadPath, 'Hronaut upload fixture', 'utf8')
  const uploaded = await client.callTool({
    name: 'browser_file_upload',
    arguments: { tabId, selector: '#upload', paths: [uploadPath] }
  }) as CallToolResult
  expect(uploaded.isError, text(uploaded)).not.toBe(true)
  const uploadName = await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: "document.querySelector('#upload').files[0].name" }
  }) as CallToolResult
  expect(text(uploadName)).toBe('upload-fixture.txt')

  const scrolled = await client.callTool({
    name: 'browser_scroll',
    arguments: { tabId, deltaY: 500 }
  }) as CallToolResult
  expect(JSON.parse(text(scrolled)).y).toBeGreaterThan(0)

  const zoomed = await client.callTool({
    name: 'browser_zoom',
    arguments: { tabId, action: 'set', percent: 125 }
  }) as CallToolResult
  expect(JSON.parse(text(zoomed)).tabs).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: tabId, zoomPercent: 125 })])
  )
  const resetZoom = await client.callTool({
    name: 'browser_zoom',
    arguments: { tabId, action: 'reset' }
  }) as CallToolResult
  expect(JSON.parse(text(resetZoom)).tabs).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: tabId, zoomPercent: 100 })])
  )
  const muted = await client.callTool({
    name: 'browser_audio',
    arguments: { tabId, muted: true }
  }) as CallToolResult
  expect(JSON.parse(text(muted)).tabs).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: tabId, muted: true })])
  )
  await client.callTool({ name: 'browser_audio', arguments: { tabId, muted: false } })

  const consoleResult = await client.callTool({ name: 'browser_console', arguments: { tabId } }) as CallToolResult
  expect(JSON.parse(text(consoleResult))).toEqual(
    expect.arrayContaining([expect.objectContaining({ level: 'error', message: 'hronaut-console-marker' })])
  )
})
