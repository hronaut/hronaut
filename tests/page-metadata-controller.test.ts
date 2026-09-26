import { describe, expect, it, vi } from 'vitest'
import { PageMetadataController, type PageMetadataTab } from '../src/main/browser/diagnostics/page-metadata-controller.js'

describe('page metadata runtime lifetime', () => {
  it.each(['reload', 'replace', 'close'] as const)('rejects a report after tab %s', async (change) => {
    let resolve!: (value: unknown) => void
    const script = new Promise<unknown>((yes) => { resolve = yes })
    const tab: PageMetadataTab = { id: 'tab-one', url: 'https://example.test', navigationGeneration: 0,
      webContents: { executeJavaScriptInIsolatedWorld: vi.fn(() => script), isDestroyed: () => false } }
    let current: PageMetadataTab | undefined = tab
    const controller = new PageMetadataController({ getTab: () => tab, findTab: () => current })
    const request = controller.inspect(tab.id)
    if (change === 'reload') tab.navigationGeneration++
    if (change === 'replace') current = { ...tab }
    if (change === 'close') current = undefined
    resolve({})
    await expect(request).rejects.toThrow('page changed')
  })
})
