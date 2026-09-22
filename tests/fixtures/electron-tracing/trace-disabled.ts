import { expect, test } from '../../integration/fixtures.js'

test.use({ trace: 'off' })

test('failure with tracing disabled', async ({ appWindow }) => {
  await appWindow.evaluate("window.hronaut.newTab({ url: 'data:text/html,<h1>Untraced fixture</h1>', active: true })")
  await appWindow.getByRole('combobox', { name: 'Address', exact: true }).fill('untraced-fixture.invalid')
  expect('intentional failure').toBe('successful fixture')
})
