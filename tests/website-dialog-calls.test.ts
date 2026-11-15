import { describe, expect, it } from 'vitest'
import { withWebsiteDialogNote } from '../src/main/mcp/website-dialog-calls.js'

describe('agent calls that leave a website dialog showing', () => {
  it('notes the dialog the tab now shows after the call\'s own result', () => {
    const dialog = { id: '0b1d5e2a-7c41-4d8e-9f60-2a3b4c5d6e7f', type: 'confirm' as const, message: 'Delete "draft"?', url: 'https://example.test/' }
    const result = withWebsiteDialogNote({ content: [{ type: 'text', text: 'Pressed Enter' }] }, dialog)
    expect(result.content).toEqual([
      { type: 'text', text: 'Pressed Enter' },
      { type: 'text', text: 'The page now shows a website confirm: "Delete \\"draft\\"?". It answers nothing else until the dialog is answered; answer it with browser_dialog and dialogId "0b1d5e2a-7c41-4d8e-9f60-2a3b4c5d6e7f".' }
    ])
  })

  it('leaves the result as it is when the tab shows no dialog', () => {
    const result = { content: [{ type: 'text' as const, text: 'Pressed Enter' }], isError: false }
    expect(withWebsiteDialogNote(result, undefined)).toBe(result)
  })
})
