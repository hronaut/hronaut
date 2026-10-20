import { render } from '@testing-library/vue'
import { expect, it } from 'vitest'
import NetworkRequestConditions from '../../src/renderer/src/components/NetworkRequestConditions.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'

it('keeps the space before a request condition’s lifetime', () => {
  // The row read "Fail as Failed· until removed": Vue dropped the space its conditional text began with.
  const view = render(NetworkRequestConditions, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      routes: [{ enabled: true, id: 'route-1', urlPattern: 'https://example.test/*', behavior: 'abort', abort: 'Failed', createdAt: '2026-10-20T12:00:00.000Z' }],
      state: 'ready', error: '', locale: 'en-US', expanded: true, mode: 'abort', pattern: '', method: '', times: 1,
      abort: 'Failed', throttle: 'slow-4g', status: 200, headers: '', body: ''
    }
  })
  try {
    expect(view.container.querySelector('.request-condition-copy small')?.textContent?.replace(/\s+/g, ' ').trim())
      .toBe('Any method · Fail as Failed · until removed')
  } finally { view.unmount() }
})
