import { describe, expect, it, vi } from 'vitest'
import { credentialFillContext } from '../src/main/browser/credential-fill-context.js'
import { fillCredential } from '../src/main/browser/credential-fill/credential-fill.js'
import type { Browser } from '../src/main/browser/browser.js'

vi.mock('../src/main/browser/agent-input-scope/agent-input-scope.js', () => ({
  withAgentInput: (_browser: unknown, _webContents: unknown, operation: () => Promise<unknown>) => operation()
}))

describe('filling a saved credential', () => {
  it('gives the page function the page\'s origin and address, then the username and password, in the page\'s world with a gesture', async () => {
    const executeJavaScript = vi.fn(async (_code: string, _userGesture?: boolean): Promise<unknown> => 'filled')
    const onUserInteraction = vi.fn()
    const tab = { id: 'tab', url: 'https://accounts.example/sign-in', navigationGeneration: 4, humanInteractionGeneration: 0, webContents: { executeJavaScript } }
    const browser = { tabs: new Map([[tab.id, tab]]), activeTabId: tab.id, tabSelectionGeneration: 2, options: { onUserInteraction } } as unknown as Browser
    const expected = credentialFillContext(tab.url, 4, 2)!

    await expect(fillCredential(browser, tab.id, expected, 'person@example.com', 'p"ss\\word')).resolves.toBe(true)
    const [code, userGesture] = executeJavaScript.mock.calls[0]!
    expect(code).toContain('function fillCredentialInPage(')
    expect(code.slice(code.lastIndexOf(' })()(') + ' })()('.length, -1))
      .toBe('"https://accounts.example", "https://accounts.example/sign-in", "person@example.com", "p\\"ss\\\\word"')
    expect(userGesture).toBe(true)
    expect(tab.humanInteractionGeneration).toBe(1)
  })

  it('fills nothing for a page the fill was not offered for', async () => {
    const executeJavaScript = vi.fn()
    const tab = { id: 'tab', url: 'https://accounts.example/other', navigationGeneration: 4, webContents: { executeJavaScript } }
    const browser = { tabs: new Map([[tab.id, tab]]), activeTabId: tab.id, tabSelectionGeneration: 2, options: {} } as unknown as Browser

    await expect(fillCredential(browser, tab.id, credentialFillContext('https://accounts.example/sign-in', 4, 2)!, 'person', 'secret')).resolves.toBe(false)
    expect(executeJavaScript).not.toHaveBeenCalled()
  })
})
