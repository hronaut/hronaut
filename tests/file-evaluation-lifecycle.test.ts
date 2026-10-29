import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
import { Browser } from '../src/main/browser/browser.js'

it('releases process admission and the timer when target capture throws', async () => {
  vi.useFakeTimers()
  try {
    const manager = Object.assign(Object.create(Browser.prototype), {
      getTab: () => ({ webContents: { get mainFrame() { throw new Error('Synthetic unavailable frame') } } })
    }) as Browser
    const hooks = { validate: vi.fn(), submitted: vi.fn(), retainPublication: vi.fn(), retainCompletion: vi.fn() }
    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await manager.evaluateFile({ path: '/synthetic.js', sha256: 'a'.repeat(64), workspaceId: 'workspace', tabId: 'tab', expectedOrigin: 'https://example.test' }, hooks)
      expect(result).toMatchObject({ status: 'NOT_DISPATCHED', reason: 'UNAVAILABLE', submitted: false })
      expect(vi.getTimerCount()).toBe(0)
    }
    expect(hooks.submitted).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})
