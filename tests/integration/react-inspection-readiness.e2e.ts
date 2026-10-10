import { setImmediate } from 'node:timers/promises'
import { expect, test, type ReactFixture } from './react-inspection-fixtures.js'

// Observe the real MCP reply without changing its contents or completion.
function observeNavigationReply(react: ReactFixture) {
  const client = react.client
  const original = client.callTool
  let received!: () => void
  const reply = new Promise<void>(resolve => { received = resolve })
  client.callTool = async function (...args) {
    const result = await original.apply(this, args)
    if (args[0].name === 'browser_navigate') received()
    return result
  }
  return { reply, restore: () => { client.callTool = original } }
}

for (const enabled of [false, true]) {
  test(`navigation waits for an initialized hook marker without requiring false (enabled=${enabled})`, async ({ react }) => {
    if (enabled) await react.success(react.react('enable'))
    // Hold only the fixture's marker, while its real React script and document
    // finish loading. Both boolean values must satisfy readiness.
    await react.page.addInitScript(() => {
      const state = globalThis as typeof globalThis & { releaseFixtureMarker(): void }
      let marker: unknown
      Object.defineProperty(state, 'fixtureSawHook', { configurable: true, set(value) { marker = value } })
      state.releaseFixtureMarker = () => Object.defineProperty(state, 'fixtureSawHook', { configurable: true, value: marker })
    })
    const observation = observeNavigationReply(react)
    let settled = false
    const navigation = react.navigate('/held-marker').finally(() => { settled = true })
    try {
      await observation.reply
      await react.page.waitForURL(react.origin + '/held-marker', { waitUntil: 'load' })
      // Drain promise continuations after the observed reply, with no time delay.
      await setImmediate()
      expect(await react.page.evaluate('typeof fixtureSawHook')).toBe('undefined')
      expect(settled, 'Navigation must not complete before the fixture marker initializes').toBe(false)
      await react.page.evaluate('releaseFixtureMarker()')
      await navigation
      const marker = await react.page.evaluate('fixtureSawHook')
      expect(marker).toBe(enabled)
      if (enabled) {
        // Readiness must not turn a real installed hook into an absent hook.
        expect(() => expect(marker).toBe(false)).toThrow()
      } else {
        expect(marker).toBe(false)
      }
    } finally {
      observation.restore()
      await react.page.evaluate('releaseFixtureMarker()').catch(() => {})
      await navigation.catch(() => {})
    }
  })
}

test('superseded native navigation cannot satisfy requested React document readiness', async ({ react, electronApp }) => {
  const path = '/superseded-destination'
  react.holdDocument(path)
  const request = react.page.waitForRequest(react.origin + path)
  const observation = observeNavigationReply(react)
  // Attach rejection handling before exercising the real native abort.
  const navigation = react.navigate(path).then(() => null, error => error as Error)
  try {
    await request
    await electronApp.evaluate(async ({ webContents }, { id, url }) => {
      await webContents.fromId(id)!.loadURL(url)
    }, { id: react.contentsId, url: react.origin + '/replacement-document' })
    await observation.reply
    const error = await navigation
    expect(error, 'An aborted requested document must not be reported ready').toBeInstanceOf(Error)
    expect(error?.message).toContain('Fixture navigation must reach its requested destination')
    await react.page.waitForURL(react.origin + '/replacement-document', { waitUntil: 'load' })
    // The replacement has a perfectly valid false marker. It is still the wrong
    // document and must never satisfy the requested destination's assertion.
    expect(await react.page.evaluate('fixtureSawHook')).toBe(false)
  } finally {
    observation.restore()
    react.releaseDocument()
    await navigation
  }
})
