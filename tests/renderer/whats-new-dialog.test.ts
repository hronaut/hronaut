import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import WhatsNewDialog from '../../src/renderer/src/components/WhatsNewDialog.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { AppReleaseHistoryEntry } from '../../src/shared/types.js'

function release(overrides: Partial<AppReleaseHistoryEntry> = {}): AppReleaseHistoryEntry {
  return {
    version: '1.11.4',
    title: 'Hronaut 1.11.4',
    publishedAt: '2026-08-31T14:19:08.000Z',
    url: 'https://github.com/hronaut/hronaut/releases/tag/v1.11.4',
    notes: '<!-- hronaut-release-notes -->\n<!-- unsigned-release-warning -->\n\n### Fixed\n\n- **Reliable** wallet actions.\n\n[Guide](https://hronaut.dev/setup)\n\n<script>window.__unsafe = 1</script>',
    ...overrides
  }
}

function renderDialog(overrides: Record<string, unknown> = {}) {
  const open = ref(true)
  const operation = ref<string | null>(null)
  const controller = {
    open,
    releases: ref([release()]),
    state: ref('ready'),
    error: ref(''),
    operation,
    page: ref(1),
    hasMore: ref(true),
    busy: computed(() => operation.value !== null),
    openDialog: vi.fn(),
    close: vi.fn(() => { open.value = false }),
    refresh: vi.fn(async () => true),
    loadMore: vi.fn(async () => true),
    dispose: vi.fn(),
    ...overrides
  }
  const openUrl = vi.fn(async () => undefined)
  render(WhatsNewDialog, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: { controller: controller as never, openUrl, reportLayout: vi.fn() }
  })
  return { controller, openUrl }
}

describe('WhatsNewDialog', () => {
  it('renders sanitized categorized history and routes every link through trusted navigation', async () => {
    const { openUrl } = renderDialog()
    const user = userEvent.setup()

    expect(screen.getByRole('dialog', { name: "What's new" })).toBeVisible()
    expect(screen.getByRole('article', { name: 'Hronaut 1.11.4' })).toBeVisible()
    expect(screen.getByText('Reliable')).toBeVisible()
    expect(screen.queryByText(/hronaut-release-notes/)).not.toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()

    await user.click(screen.getByRole('link', { name: 'Guide' }))
    await user.click(screen.getByRole('button', { name: 'Open Hronaut 1.11.4 on GitHub' }))

    expect(openUrl).toHaveBeenNthCalledWith(1, 'https://hronaut.dev/setup')
    expect(openUrl).toHaveBeenNthCalledWith(2, 'https://github.com/hronaut/hronaut/releases/tag/v1.11.4')
  })

  it('uses a compact release reader without repeating the generated release title', () => {
    renderDialog()

    const releaseArticle = screen.getByRole('article', { name: 'Hronaut 1.11.4' })
    expect(releaseArticle).toContainElement(screen.getByText('August 31, 2026'))
    expect(releaseArticle).toContainElement(screen.getByText('v1.11.4'))
    expect(screen.queryByRole('heading', { name: 'Hronaut 1.11.4' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Fixed' })).toBeVisible()
  })

  it('loads older releases and exposes a retry state without losing modal controls', async () => {
    const loadMore = vi.fn(async () => true)
    const { controller } = renderDialog({ loadMore })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Load older releases' }))
    expect(loadMore).toHaveBeenCalledOnce()

    controller.releases.value = []
    controller.state.value = 'error'
    controller.error.value = 'Could not load release history from GitHub.'
    await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Release history is unavailable'))
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
    expect(screen.getByRole('button', { name: "Close What's new" })).toBeEnabled()
  })

  it('keeps older stable releases reachable when the current GitHub page is filtered empty', async () => {
    const loadMore = vi.fn(async () => true)
    renderDialog({
      releases: ref([]),
      state: ref('ready'),
      hasMore: ref(true),
      loadMore
    })
    const user = userEvent.setup()

    expect(screen.getByText('No published releases')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Load older releases' }))

    expect(loadMore).toHaveBeenCalledOnce()
  })
})
