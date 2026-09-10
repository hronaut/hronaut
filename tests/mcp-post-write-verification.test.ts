import { expect, it } from 'vitest'
import { browserClickPageInput } from '../src/main/mcp/server.js'

it('removes private verification predicates before constructing a page-world click', () => {
  const input = {
    tabId: 'tab', selector: '#submit',
    postcondition: {
      expectedOrigin: 'https://example.invalid', accountSelector: '#account',
      expectedAccount: 'private-account-canary', stateSelector: '#state',
      expectedText: 'private-state-canary'
    }
  }
  const pageInput = browserClickPageInput(input)
  expect(pageInput).toEqual({ tabId: 'tab', selector: '#submit' })
  expect(JSON.stringify(pageInput)).not.toMatch(/private-account-canary|private-state-canary/)
})
