import { nextTick, ref } from 'vue'
import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SearchSettingsPanel from '../../src/renderer/src/features/settings/SearchSettingsPanel.vue'
import { useSearchSettingsController } from '../../src/renderer/src/features/settings/useSearchSettingsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import { SITE_SEARCH_LIMIT, siteSearchFromDraft, type SiteSearch, type SiteSearchDraft } from '../../src/shared/site-search.js'
import type { AppSettings } from '../../src/shared/types.js'

// Settings > Search engine had only the default engine. Chrome's Site search list beside it adds, edits and deletes
// the shortcuts that search a site from the address bar.

const WIKIPEDIA: SiteSearch = { id: 'wiki', name: 'Wikipedia', keyword: 'w', url: 'https://en.wikipedia.org/w/index.php?search=%s' }

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}

function renderPanel(siteSearches: SiteSearch[] = []) {
  const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS, siteSearches })
  let nextId = 0
  const apply = (next: SiteSearch[]) => (settings.value = { ...settings.value, siteSearches: next })
  const addSiteSearch = vi.fn(async (draft: SiteSearchDraft) => apply([...settings.value.siteSearches, siteSearchFromDraft(`new-${++nextId}`, draft)]))
  const updateSiteSearch = vi.fn(async (id: string, draft: SiteSearchDraft) => apply(settings.value.siteSearches.map((entry) => (
    entry.id === id ? siteSearchFromDraft(id, draft) : entry
  ))))
  const removeSiteSearch = vi.fn(async (id: string) => apply(settings.value.siteSearches.filter((entry) => entry.id !== id)))
  const onError = vi.fn()
  const controller = useSearchSettingsController({
    settings,
    setSearchEngine: vi.fn(async () => settings.value),
    addSiteSearch,
    updateSiteSearch,
    removeSiteSearch,
    onError
  })
  render(SearchSettingsPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { controller }
  })
  const region = screen.getByRole('region', { name: 'Site search' })
  return { settings, controller, addSiteSearch, updateSiteSearch, removeSiteSearch, onError, region, user: userEvent.setup() }
}

describe('Site search settings', () => {
  it('adds a site search from the form and gives the keyboard to the list\'s heading', async () => {
    const { region, user, addSiteSearch, settings } = renderPanel()
    expect(within(region).getByText('No site searches yet')).toBeVisible()
    await user.click(within(region).getByRole('button', { name: 'Add site search' }))
    const form = within(region).getByRole('form', { name: 'Add site search' })
    expect(within(form).getByLabelText('Name')).toHaveFocus()
    await user.keyboard('Wikipedia')
    await user.type(within(form).getByLabelText('Shortcut'), 'W')
    await user.type(within(form).getByLabelText('URL with %s in place of query'), `${WIKIPEDIA.url}{Enter}`)
    expect(addSiteSearch).toHaveBeenCalledExactlyOnceWith({ name: 'Wikipedia', keyword: 'W', url: WIKIPEDIA.url })
    expect(within(region).queryByRole('form')).toBeNull()
    expect(within(region).getByRole('heading', { name: 'Site search' })).toHaveFocus()
    const row = within(region).getByRole('listitem')
    expect(within(row).getByText('Wikipedia')).toBeVisible()
    expect(within(row).getByText('w', { selector: 'code' })).toBeVisible()
    expect(within(row).getByText(WIKIPEDIA.url)).toBeVisible()
    expect(settings.value.siteSearches).toHaveLength(1)
  })

  it('names what keeps the form from saving once Save is pressed, and saves nothing', async () => {
    const { region, user, addSiteSearch } = renderPanel([WIKIPEDIA])
    await user.click(within(region).getByRole('button', { name: 'Add site search' }))
    const form = within(region).getByRole('form', { name: 'Add site search' })
    // Nothing is named while the form is still being filled in.
    await user.type(within(form).getByLabelText('Shortcut'), 'w')
    expect(within(form).queryByRole('alert')).toBeNull()
    await user.click(within(form).getByRole('button', { name: 'Save' }))
    expect(addSiteSearch).not.toHaveBeenCalled()
    expect(within(form).getByLabelText('Name')).toHaveAccessibleDescription('Enter a name')
    expect(within(form).getByLabelText('Shortcut')).toHaveAccessibleDescription('This shortcut is already in use')
    expect(within(form).getByLabelText('URL with %s in place of query'))
      .toHaveAccessibleDescription('Enter a web address that starts with http:// or https://')
    expect(within(form).getByLabelText('Name')).toHaveFocus()
    // Then each name follows what is typed.
    await user.type(within(form).getByLabelText('URL with %s in place of query'), 'https://example.org/')
    expect(within(form).getByLabelText('URL with %s in place of query')).toHaveAccessibleDescription('Put %s where the search terms go')
    await user.type(within(form).getByLabelText('Shortcut'), 'x y')
    expect(within(form).getByLabelText('Shortcut')).toHaveAccessibleDescription('A shortcut can\u2019t contain spaces')
  })

  it('edits a site search in the form, filled in with it, and keeps its own shortcut free for it', async () => {
    const { region, user, updateSiteSearch, settings } = renderPanel([WIKIPEDIA])
    await user.click(within(region).getByRole('button', { name: 'Edit Wikipedia' }))
    const form = within(region).getByRole('form', { name: 'Edit site search' })
    expect(within(form).getByLabelText('Name')).toHaveValue('Wikipedia')
    expect(within(form).getByLabelText('Shortcut')).toHaveValue('w')
    expect(within(form).getByLabelText('URL with %s in place of query')).toHaveValue(WIKIPEDIA.url)
    expect(within(region).queryByRole('button', { name: 'Add site search' })).toBeNull()
    await user.clear(within(form).getByLabelText('Name'))
    await user.type(within(form).getByLabelText('Name'), 'Wiki{Enter}')
    expect(updateSiteSearch).toHaveBeenCalledExactlyOnceWith('wiki', { name: 'Wiki', keyword: 'w', url: WIKIPEDIA.url })
    expect(settings.value.siteSearches).toEqual([{ ...WIKIPEDIA, name: 'Wiki' }])
    expect(within(region).getByRole('heading', { name: 'Site search' })).toHaveFocus()
  })

  it('deletes a site search and gives the keyboard to the list\'s heading, never to the next row\'s Delete', async () => {
    const docs: SiteSearch = { id: 'docs', name: 'Docs', keyword: 'd', url: 'https://docs.example/?q=%s' }
    const { region, user, removeSiteSearch } = renderPanel([WIKIPEDIA, docs])
    within(region).getByRole('button', { name: 'Delete Wikipedia' }).focus()
    await user.keyboard('{Enter}')
    expect(removeSiteSearch).toHaveBeenCalledExactlyOnceWith('wiki')
    await nextTick()
    expect(within(region).getAllByRole('listitem')).toHaveLength(1)
    expect(within(region).getByRole('heading', { name: 'Site search' })).toHaveFocus()
  })

  it('closes the form on Escape without closing Settings, and on Cancel', async () => {
    const { region, user, addSiteSearch } = renderPanel()
    const outside = vi.fn((event: KeyboardEvent) => event.defaultPrevented)
    window.addEventListener('keydown', outside)
    try {
      await user.click(within(region).getByRole('button', { name: 'Add site search' }))
      await user.keyboard('Wiki{Escape}')
      expect(outside).toHaveLastReturnedWith(true)
      expect(within(region).queryByRole('form')).toBeNull()
      expect(within(region).getByRole('heading', { name: 'Site search' })).toHaveFocus()
      await user.click(within(region).getByRole('button', { name: 'Add site search' }))
      // The form opens empty again.
      expect(within(region).getByLabelText('Name')).toHaveValue('')
      await user.click(within(region).getByRole('button', { name: 'Cancel' }))
      expect(within(region).queryByRole('form')).toBeNull()
      expect(addSiteSearch).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', outside)
    }
  })

  // jsdom does not submit a form on Enter by itself, so the browser's submit is left to the e2e; the repeat must be
  // cancelled, which is what keeps it from submitting there.
  it('does not save the form an Enter still held from Add opened', async () => {
    const { region, user } = renderPanel()
    await user.click(within(region).getByRole('button', { name: 'Add site search' }))
    const name = within(region).getByLabelText('Name')
    const repeat = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
    name.dispatchEvent(repeat)
    expect(repeat.defaultPrevented).toBe(true)
    const first = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    name.dispatchEvent(first)
    expect(first.defaultPrevented).toBe(false)
  })

  it('keeps the form open with what was typed when saving fails', async () => {
    const { region, user, addSiteSearch, onError } = renderPanel()
    const failure = new Error('disk full')
    addSiteSearch.mockRejectedValueOnce(failure)
    await user.click(within(region).getByRole('button', { name: 'Add site search' }))
    await user.keyboard('Wikipedia')
    await user.type(within(region).getByLabelText('Shortcut'), 'w')
    await user.type(within(region).getByLabelText('URL with %s in place of query'), `${WIKIPEDIA.url}{Enter}`)
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure)
    expect(within(region).getByLabelText('Name')).toHaveValue('Wikipedia')
  })

  it('leaves the keyboard where it went when a save ends after Cancel', async () => {
    const { region, user, addSiteSearch, settings } = renderPanel()
    const pending = deferred<AppSettings>()
    addSiteSearch.mockImplementationOnce(() => pending.promise)
    await user.click(within(region).getByRole('button', { name: 'Add site search' }))
    await user.keyboard('Wikipedia')
    await user.type(within(region).getByLabelText('Shortcut'), 'w')
    await user.type(within(region).getByLabelText('URL with %s in place of query'), `${WIKIPEDIA.url}{Enter}`)
    await user.click(within(region).getByRole('button', { name: 'Cancel' }))
    const add = within(region).getByRole('button', { name: 'Add site search' })
    // Add waits for the save to end.
    expect(add).toHaveAttribute('aria-disabled', 'true')
    await user.click(add)
    expect(within(region).queryByRole('form')).toBeNull()
    add.focus()
    settings.value = { ...settings.value, siteSearches: [WIKIPEDIA] }
    pending.resolve(settings.value)
    // Every step after the save runs before the next task.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(add).toHaveFocus()
    expect(add).not.toHaveAttribute('aria-disabled')
    expect(within(region).getAllByRole('listitem')).toHaveLength(1)
  })

  it('offers no Add once the list is full', async () => {
    const full = Array.from({ length: SITE_SEARCH_LIMIT }, (_, index) => ({
      id: `site-${index}`, name: `Site ${index}`, keyword: `s${index}`, url: `https://s${index}.example/?q=%s`
    }))
    const { region, user } = renderPanel(full)
    const add = within(region).getByRole('button', { name: 'Add site search' })
    expect(add).toHaveAttribute('aria-disabled', 'true')
    expect(within(region).getByText('The list is full. Delete a site search to add another.')).toBeVisible()
    await user.click(add)
    expect(within(region).queryByRole('form')).toBeNull()
  })
})
