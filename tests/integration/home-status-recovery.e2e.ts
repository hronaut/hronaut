import { expect, test } from './fixtures.js'

for (const failure of ['http', 'network', 'json'] as const) {
  test(`shows unavailable Home status after a ${failure} failure and recovers on the next successful refresh`, async ({ electronApp }) => {
    await expect.poll(() => electronApp.evaluate(({ webContents }) => (
      webContents.getAllWebContents().some(contents => contents.getURL().startsWith('hronaut://home'))
    ))).toBe(true)

    const states = await electronApp.evaluate(async ({ webContents }, failureKind) => {
      const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
      if (!home) throw new Error('Hronaut Home web contents was not found')
      return home.executeJavaScript(`(async () => {
        const originalFetch = window.fetch;
        const originalDashboard = dashboard;
        const readStatus = () => ({
          label: document.getElementById('server-state').textContent.trim(),
          active: document.getElementById('active-count').textContent,
          detail: document.getElementById('request-count').textContent,
          ready: !!document.querySelector('#server-state .dot.ready'),
          live: document.querySelector('.hero-status').getAttribute('aria-live')
        });
        try {
          const ready = { ...dashboard, status: 'ready', paused: false, activeRequests: 2, totalRequests: 3 };
          window.fetch = async () => ({ ok: true, json: async () => ready });
          await refreshDashboard();
          const before = readStatus();
          window.fetch = async () => {
            if (${JSON.stringify(failureKind)} === 'network') throw new Error('Connection unavailable');
            return {
              ok: ${JSON.stringify(failureKind)} !== 'http',
              status: 503,
              json: async () => { throw new Error('Invalid JSON'); }
            };
          };
          await refreshDashboard();
          const unavailable = readStatus();
          window.fetch = async () => ({ ok: true, json: async () => ({ ...ready, activeRequests: 0, totalRequests: 4 }) });
          await refreshDashboard();
          return { before, unavailable, recovered: readStatus() };
        } finally {
          window.fetch = originalFetch;
          dashboard = originalDashboard;
          renderDashboard();
        }
      })()`)
    }, failure)

    expect(states.before).toMatchObject({ ready: true, active: '2 active' })
    expect(states.unavailable).toEqual({
      label: 'Unavailable',
      active: 'Unavailable',
      detail: 'Reconnecting to local status',
      ready: false,
      live: 'polite'
    })
    expect(states.recovered).toMatchObject({ ready: true, active: '0 active', detail: '4 MCP requests handled' })
  })
}

test('keeps recovered Home status when an older failed refresh arrives afterward', async ({ electronApp }) => {
  await expect.poll(() => electronApp.evaluate(({ webContents }) => (
    webContents.getAllWebContents().some(contents => contents.getURL().startsWith('hronaut://home'))
  ))).toBe(true)

  const state = await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    return home.executeJavaScript(`(async () => {
      const originalFetch = window.fetch;
      const originalDashboard = dashboard;
      try {
        let failOlder;
        window.fetch = () => new Promise((_, reject) => { failOlder = reject; });
        const older = refreshDashboard();
        window.fetch = async () => ({ ok: true, json: async () => ({ ...dashboard, status: 'ready', activeRequests: 0 }) });
        await refreshDashboard();
        failOlder(new Error('Old status request failed'));
        await older;
        return {
          ready: !!document.querySelector('#server-state .dot.ready'),
          detail: document.getElementById('request-count').textContent
        };
      } finally {
        window.fetch = originalFetch;
        dashboard = originalDashboard;
        renderDashboard();
      }
    })()`)
  })

  expect(state.ready).toBe(true)
  expect(state.detail).not.toBe('Reconnecting to local status')
})
