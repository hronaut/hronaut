import { render } from '@testing-library/vue'
import { expect, it } from 'vitest'
import NetworkRequestConditions from '../../src/renderer/src/features/network/NetworkRequestConditions.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'

it('keeps the space before a request condition’s lifetime', () => {
  // The row read "Fail as Failed· until removed": Vue dropped the space its conditional text began with.
  const view = render(NetworkRequestConditions, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      routes: [
        { enabled: true, id: 'route-1', urlPattern: 'https://example.test/*', behavior: 'abort', abort: 'Failed', createdAt: '2026-10-20T12:00:00.000Z' },
        { enabled: true, id: 'route-2', urlPattern: 'https://example.test/api', behavior: 'abort', abort: 'Failed', remainingMatches: 2, createdAt: '2026-10-20T12:00:00.000Z' }
      ],
      state: 'ready', error: '', locale: 'en-US', expanded: true, mode: 'abort', pattern: '', method: '', times: 1,
      abort: 'Failed', throttle: 'slow-4g', status: 200, headers: '', body: ''
    }
  })
  try {
    const [untilRemoved, limited] = [...view.container.querySelectorAll('.request-condition-copy small')]
      .map((line) => line.textContent?.replace(/\s+/g, ' ').trim())
    expect(untilRemoved).toBe('Any method · Fail: Generic failure · until removed')
    expect(limited).toBe('Any method · Fail: Generic failure · 2 matches left')
  } finally { view.unmount() }
})
