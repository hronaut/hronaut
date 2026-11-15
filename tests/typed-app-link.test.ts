import { describe, expect, it, vi } from 'vitest'

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn(async (_url: string) => undefined) }))
vi.mock('electron', () => ({ shell: { openExternal } }))

const { appLinkScheme, openAppLinkForPerson } = await import('../src/main/browser/app-links/typed-app-link.js')

describe('links to other apps the person types', () => {
  it('names the scheme of a link another app opens, and none for web pages or Hronaut\'s own addresses', () => {
    expect(appLinkScheme('mailto:someone@example.test')).toBe('mailto:')
    expect(appLinkScheme('tel:911')).toBe('tel:')
    expect(appLinkScheme('zoommtg://zoom.example.test/join')).toBe('zoommtg:')
    for (const address of ['https://example.test/', 'http://example.test/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/plain,hi',
      'about:blank', 'view-source:https://example.test/', 'hronaut://home/', 'chrome://settings', 'not an address']) {
      expect(appLinkScheme(address), address).toBeUndefined()
    }
  })

  it('opens the link in its app only once the person agrees, naming only a shortened scheme', async () => {
    const confirmOpenAppLink = vi.fn(async (_scheme: string) => false)
    const browser = { options: { confirmOpenAppLink, onActionFailed: vi.fn() } }
    await openAppLinkForPerson(browser as never, 'mailto:someone@example.test?subject=token', 'mailto:')
    expect(confirmOpenAppLink).toHaveBeenCalledExactlyOnceWith('mailto:')
    expect(openExternal).not.toHaveBeenCalled()

    confirmOpenAppLink.mockResolvedValue(true)
    const long = `x${'y'.repeat(80)}:`
    await openAppLinkForPerson(browser as never, `${long}payload`, long)
    expect(confirmOpenAppLink).toHaveBeenLastCalledWith(`${long.slice(0, 63)}…`)
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(`${long}payload`)
  })

  it('reports a link the system could not open', async () => {
    openExternal.mockRejectedValueOnce(new Error('No app'))
    const browser = { options: { confirmOpenAppLink: async () => true, onActionFailed: vi.fn() } }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await openAppLinkForPerson(browser as never, 'slack://open', 'slack:')
    expect(browser.options.onActionFailed).toHaveBeenCalledExactlyOnceWith('open a link in another app', expect.any(Error))
    vi.restoreAllMocks()
  })
})
