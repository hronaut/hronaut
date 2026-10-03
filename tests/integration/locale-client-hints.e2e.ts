import { createServer } from 'node:http'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer } from './fixtures.js'
import { test, expect, text } from './capability-fixtures.js'

test('preserves native Client Hints during locale-only emulation and keeps custom UA behavior', async ({ capabilities, electronApp }) => {
  const { client, tabId } = capabilities
  const headerNames = ['user-agent', 'accept-language', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-full-version-list', 'sec-ch-ua-platform-version']
  const server = createServer((request, response) => {
    response.setHeader('cache-control', 'no-store')
    response.setHeader('accept-ch', 'Sec-CH-UA, Sec-CH-UA-Mobile, Sec-CH-UA-Platform, Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform-Version')
    if (request.url?.startsWith('/echo')) {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(Object.fromEntries(headerNames.map(name => [name, request.headers[name] ?? null]))))
      return
    }
    response.setHeader('content-type', 'text/html')
    response.end(`<title>Client Hints fixture</title><p id="browser"></p><p id="language"></p><script>
      document.querySelector('#browser').textContent = navigator.userAgentData?.brands?.some(b=>b.brand==='Chromium') ? 'Chromium detected' : 'No Chromium Client Hints';
      document.querySelector('#language').textContent = navigator.language;
    </script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  try {
    const opened = await call('browser_new_tab', { url: `${origin}/control-initial`, active: false })
    const controlId = opened.tabs.find((tab: { url: string }) => tab.url === `${origin}/control-initial`).id
    const sample = async (id: string, name: string) => {
      const url = `${origin}/${name}-${Date.now()}`
      await call('browser_navigate', { tabId: id, url })
      await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
      const page = electronApp.context().pages().find(page => page.url() === url)!
      await expect(page.locator('#language')).not.toBeEmpty()
      const data = await page.evaluate(async () => {
        const nav = navigator as Navigator & { userAgentData?: { toJSON(): unknown; getHighEntropyValues(keys: string[]): Promise<unknown> } }
        return {
          secure: isSecureContext,
          userAgent: navigator.userAgent,
          language: navigator.language,
          languages: [...navigator.languages],
          intlLocale: new Intl.NumberFormat().resolvedOptions().locale,
          low: nav.userAgentData?.toJSON() ?? null,
          high: nav.userAgentData ? await nav.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'fullVersionList', 'platformVersion', 'model']) : null,
          headers: await (await fetch('/echo?unique=' + crypto.randomUUID(), { cache: 'no-store' })).json(),
          visibleBrowser: document.querySelector('#browser')!.textContent,
          visibleLanguage: document.querySelector('#language')!.textContent
        }
      })
      return data
    }
    const baseline = await sample(tabId, 'baseline')
    const controlBaseline = await sample(controlId, 'control-baseline')
    await call('browser_emulate', { tabId, locale: 'fr-CA' })
    const locale = await sample(tabId, 'locale-fr-CA')
    const controlDuring = await sample(controlId, 'control-during')
    await call('browser_emulate', { tabId, locale: '' })
    const cleared = await sample(tabId, 'cleared')
    const controlAfter = await sample(controlId, 'control-after')
    expect(baseline.secure).toBe(true)
    expect(baseline.low).toMatchObject({ brands: expect.arrayContaining([expect.objectContaining({ brand: 'Chromium' })]) })
    expect(baseline.headers['sec-ch-ua']).toContain('Chromium')
    const assertLocaleOnly = (value: typeof baseline) => {
      expect(value).toEqual({
        ...baseline,
        language: 'fr-CA', languages: ['fr-CA'], intlLocale: 'fr-CA', visibleLanguage: 'fr-CA',
        headers: { ...baseline.headers, 'accept-language': 'fr-CA' }
      })
    }
    assertLocaleOnly(locale)
    expect(locale.language).toBe('fr-CA')
    expect(locale.intlLocale).toBe('fr-CA')
    expect(cleared.language).toBe(baseline.language)
    expect(controlDuring).toEqual(controlBaseline)
    expect(controlAfter).toEqual(controlBaseline)
    expect(cleared).toEqual(baseline)

    const customUA = 'Hronaut locale regression/1.0'
    await call('browser_emulate', { tabId, userAgent: customUA, locale: 'fr-CA' })
    const custom = await sample(tabId, 'custom-with-locale')
    expect(custom.userAgent).toBe(customUA)
    expect(custom.headers['user-agent']).toBe(customUA)
    expect(custom.language).toBe('fr-CA')
    expect(custom.low).toEqual({ brands: [], mobile: false, platform: '' })
    expect(custom.headers['sec-ch-ua']).toBeNull()
    expect(custom.visibleBrowser).toBe('No Chromium Client Hints')
    await call('browser_emulate', { tabId, locale: '' })
    const customClearedLocale = await sample(tabId, 'custom-cleared-locale')
    expect(customClearedLocale.userAgent).toBe(customUA)
    expect(customClearedLocale.language).toBe(baseline.language)
    expect(customClearedLocale.low).toEqual(custom.low)
    expect(customClearedLocale.headers['sec-ch-ua']).toBeNull()
    await call('browser_emulate', { tabId, userAgent: '', locale: 'fr-CA' })
    assertLocaleOnly(await sample(tabId, 'custom-to-native-locale'))
    await call('browser_emulate', { tabId, reset: true })
    expect(await sample(tabId, 'final-reset')).toEqual(baseline)
    expect(await sample(controlId, 'final-control')).toEqual(controlBaseline)
  } finally { await closeFixtureServer(server) }
})
