// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrustedDialog from '../../src/renderer/src/trusted-dialogs/TrustedDialog.vue'
import { useTrustedDialogController } from '../../src/renderer/src/trusted-dialogs/useTrustedDialogController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { holdOverlayEntrance, releaseOverlayEntrance, reportPageViewsHidden, resetOverlayMotion } from '../../src/renderer/src/composables/overlay-motion.js'
import { useShellOverlayCoordinationController } from '../../src/renderer/src/composables/useShellOverlayCoordinationController.js'
import type { SupportedLocale } from '../../src/shared/locale.js'
import type { HronautTrustedDialogsApi, TrustedDialogRequest } from '../../src/shared/trusted-dialogs.js'

function sitePermission(id: string, overrides: Partial<Extract<TrustedDialogRequest['variant'], { kind: 'site-permission' }>> = {}): TrustedDialogRequest {
  return {
    id,
    type: 'question',
    title: 'Site permission',
    message: 'https://maps.example requests “Location” permission.',
    detail: 'Hronaut remembers this choice for this website in this workspace.',
    buttons: ['Deny', 'Allow'],
    defaultId: 0,
    cancelId: 0,
    primaryId: 1,
    variant: { kind: 'site-permission', origin: 'https://maps.example', permission: 'geolocation', freshConsent: false, ...overrides }
  }
}

function mountDialog(locale: SupportedLocale = 'en-US') {
  let publish: (request: TrustedDialogRequest | null) => void = () => undefined
  const ready = vi.fn()
  const respond = vi.fn()
  const api: HronautTrustedDialogsApi = {
    ready,
    respond,
    onChanged: (listener) => {
      publish = listener
      return () => undefined
    }
  }
  const controller = useTrustedDialogController(api)
  render(TrustedDialog, { props: { controller }, global: { plugins: [createHronautI18n(locale)] } })
  return {
    api: { ready, respond },
    controller,
    show: async (request: TrustedDialogRequest | null) => {
      publish(request)
      await nextTick()
      await nextTick()
    },
    /** The dialog takes answers only after it has been on screen for a moment. */
    settle: async () => {
      await vi.advanceTimersByTimeAsync(600)
      await nextTick()
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
})

afterEach(() => {
  resetOverlayMotion()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Hronaut’s permission dialog', () => {
  it('tells the shell it can show dialogs, and names the website and what it wants with Deny focused', async () => {
    const { api, show } = mountDialog()
    expect(api.ready).toHaveBeenCalledOnce()
    await show(sitePermission('one', { embeddedIn: 'https://news.example', workspaceName: 'Client A' }))

    const dialog = screen.getByRole('alertdialog', { name: 'https://maps.example wants to know your location' })
    expect(dialog).toHaveAttribute('data-variant', 'site-permission')
    expect(dialog).toHaveTextContent('Site permission')
    expect(dialog).toHaveTextContent('Embedded in https://news.example')
    expect(dialog).toHaveTextContent('Hronaut remembers this choice for this website on https://news.example in the “Client A” workspace.')
    expect(dialog).toHaveTextContent('You can change it later in Settings → Site permissions.')
    expect(screen.getByRole('button', { name: 'Deny' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Deny' })).toHaveClass('ui-button--secondary')
    expect(screen.getByRole('button', { name: 'Allow' })).toHaveClass('ui-button--primary')
  })

  it('names the one device a camera request asks for, and says it asks again every time', async () => {
    const { show } = mountDialog()
    await show(sitePermission('camera', { permission: 'media', mediaTypes: ['video'], freshConsent: true, workspaceName: 'Client A' }))
    const dialog = screen.getByRole('alertdialog', { name: 'https://maps.example wants to use your camera' })
    expect(dialog).toHaveTextContent('Asked in the “Client A” workspace.')
    expect(dialog).toHaveTextContent("Hronaut doesn't remember this choice.")
    expect(dialog).not.toHaveTextContent('Settings → Site permissions')
  })

  it('shows a file a website asks for apart from Hronaut’s words, and a permission without a design by its name', async () => {
    const { show } = mountDialog()
    await show(sitePermission('file', { permission: 'fileSystem', freshConsent: true, file: { path: '/home/notes.txt', access: 'writable' } }))
    expect(screen.getByTestId('trusted-dialog-quoted')).toHaveTextContent('/home/notes.txt')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Write access')
    await show(sitePermission('fonts', { permission: 'local-fonts' }))
    expect(screen.getByRole('alertdialog', { name: 'https://maps.example wants to use “local fonts”' })).toBeInTheDocument()
  })

  it('speaks the interface language', async () => {
    const { show } = mountDialog('uk-UA')
    await show(sitePermission('one'))
    expect(screen.getByRole('alertdialog', { name: 'Сайт https://maps.example хоче знати ваше розташування' })).toBeInTheDocument()
  })

  it('answers nothing for a click that lands before the dialog has settled on screen', async () => {
    // A website can time its request so that a click aimed at its page lands on Allow the moment the dialog appears.
    const { api, show, settle } = mountDialog()
    await show(sitePermission('one'))
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-armed', 'false')
    await fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(api.respond).not.toHaveBeenCalled()
    await settle()
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-armed', 'true')
    await fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(api.respond).toHaveBeenCalledExactlyOnceWith('one', 1)
    // A second click before main shows the next dialog sends nothing more.
    await fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    expect(api.respond).toHaveBeenCalledOnce()
  })

  it('answers Escape as Deny, ignores a held key from the page, and keeps open on a backdrop click', async () => {
    const { api, show, settle } = mountDialog()
    await show(sitePermission('one'))
    await settle()
    const deny = screen.getByRole('button', { name: 'Deny' })
    // Enter held on the page repeats once the dialog takes the focus; a repeat never presses a button.
    const heldEnter = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
    deny.dispatchEvent(heldEnter)
    expect(heldEnter.defaultPrevented).toBe(true)
    const heldEscape = new KeyboardEvent('keydown', { key: 'Escape', repeat: true, bubbles: true, cancelable: true })
    deny.dispatchEvent(heldEscape)
    expect(api.respond).not.toHaveBeenCalled()
    await fireEvent.mouseDown(document.querySelector('.ui-dialog__backdrop')!)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(api.respond).not.toHaveBeenCalled()

    await fireEvent.keyDown(deny, { key: 'Escape' })
    expect(api.respond).toHaveBeenCalledExactlyOnceWith('one', 0)
  })

  it('never answers Allow from Enter: Enter presses the focused Deny', async () => {
    const { api, show, settle } = mountDialog()
    await show(sitePermission('one'))
    await settle()
    expect(document.activeElement).toHaveTextContent('Deny')
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).keyboard('{Enter}')
    expect(api.respond).toHaveBeenCalledExactlyOnceWith('one', 0)
  })

  it('starts its moment on screen only once main reports that the page has left the screen', async () => {
    // Main keeps the page on screen until it has a picture of it. A dialog that counted that time could take a click
    // the instant the page left, the click a website timed for its page.
    const { api, show, settle } = mountDialog()
    holdOverlayEntrance()
    await show(sitePermission('one'))
    // The entrance may start before main acts, from the shell's own picture or the hold's time limit; answers may not.
    releaseOverlayEntrance()
    await vi.advanceTimersByTimeAsync(3_000)
    await nextTick()
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-armed', 'false')
    reportPageViewsHidden()
    await nextTick()
    await vi.advanceTimersByTimeAsync(400)
    await nextTick()
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-armed', 'false')
    await fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(api.respond).not.toHaveBeenCalled()
    await settle()
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-armed', 'true')
  })

  it('waits for the page to leave the screen when its own request covers the page', async () => {
    // The shell starts covering the page from the request itself, before the dialog could start its moment on screen.
    let publish: (request: TrustedDialogRequest | null) => void = () => undefined
    const api: HronautTrustedDialogsApi = { ready: vi.fn(), respond: vi.fn(), onChanged: (listener) => { publish = listener; return () => undefined } }
    const covered: boolean[] = []
    const Shell = defineComponent({
      setup() {
        const controller = useTrustedDialogController(api)
        useShellOverlayCoordinationController({
          activePanel: ref(null), splitMenu: ref(false), layoutSources: [], competingOverlayStates: [], preservedPanels: [],
          fullModalOpen: computed(() => controller.open.value),
          keepsSeparatePanelOpen: () => false, closePanelsExcept: () => undefined, closeAddressSuggestions: () => undefined,
          setBrowserContentOccluded: (occluded) => {
            covered.push(occluded)
            if (occluded) holdOverlayEntrance()
            else releaseOverlayEntrance()
          },
          reportLayout: () => undefined
        })
        return () => h(TrustedDialog, { controller })
      }
    })
    render(Shell, { global: { plugins: [createHronautI18n('en-US')] } })
    publish(sitePermission('one'))
    await nextTick()
    await nextTick()
    expect(covered).toEqual([true])
    await vi.advanceTimersByTimeAsync(900)
    await nextTick()
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-armed', 'false')
    reportPageViewsHidden()
    await nextTick()
    await vi.advanceTimersByTimeAsync(600)
    await nextTick()
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-armed', 'true')
  })

  it('waits for the window to come forward when it asks in the background, and while the window is hidden', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const { show, settle } = mountDialog()
    await show(sitePermission('one'))
    await settle()
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-armed', 'false')
    window.dispatchEvent(new FocusEvent('focus'))
    await settle()
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-armed', 'true')

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-armed', 'false')
    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()
    await vi.advanceTimersByTimeAsync(400)
    await nextTick()
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-armed', 'false')
    await settle()
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-armed', 'true')
  })

  it('takes no answer while the window is in the background, nor for a moment after it comes back', async () => {
    const { api, show, settle } = mountDialog()
    await show(sitePermission('one'))
    await settle()
    window.dispatchEvent(new FocusEvent('blur'))
    await nextTick()
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-armed', 'false')
    await settle()
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-armed', 'false')
    // The click that brings the window back lands right after it has the focus.
    window.dispatchEvent(new FocusEvent('focus'))
    await nextTick()
    await fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(api.respond).not.toHaveBeenCalled()
    await settle()
    await fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(api.respond).toHaveBeenCalledExactlyOnceWith('one', 1)
  })

  it('gives the focus back to Deny when it starts taking answers, and moves it for no held key', async () => {
    // Keys meant for the page, such as Tab and then Enter, could move the focus to Allow and press it.
    const { api, show, settle } = mountDialog()
    await show(sitePermission('one'))
    const deny = screen.getByRole('button', { name: 'Deny' })
    const heldTab = new KeyboardEvent('keydown', { key: 'Tab', repeat: true, bubbles: true, cancelable: true })
    deny.dispatchEvent(heldTab)
    expect(heldTab.defaultPrevented).toBe(true)
    screen.getByRole('button', { name: 'Allow' }).focus()
    await settle()
    expect(deny).toHaveFocus()
    expect(api.respond).not.toHaveBeenCalled()
  })

  it('moves the focus to the next dialog’s Deny and settles it again when the queue moves on', async () => {
    const { api, show, settle } = mountDialog()
    await show(sitePermission('one'))
    await settle()
    screen.getByRole('button', { name: 'Allow' }).focus()
    await show(sitePermission('two', { origin: 'https://other.example' }))
    expect(screen.getByRole('alertdialog', { name: 'https://other.example wants to know your location' })).toHaveAttribute('data-armed', 'false')
    expect(screen.getByRole('button', { name: 'Deny' })).toHaveFocus()
    await fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(api.respond).not.toHaveBeenCalled()
    await show(null)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('draws a protected file as a warning with Cancel focused', async () => {
    const { api, show, settle } = mountDialog()
    await show({
      id: 'protected',
      type: 'warning',
      title: 'Site permission',
      message: "https://editor.example can't use this folder",
      buttons: ['Cancel', 'Choose another folder'],
      defaultId: 0,
      cancelId: 0,
      primaryId: 1,
      variant: { kind: 'protected-file-access', origin: 'https://editor.example', target: 'folder' }
    })
    const dialog = screen.getByRole('alertdialog', { name: "https://editor.example can't use this folder" })
    expect(dialog).toHaveClass('trusted-dialog--warning')
    expect(dialog).toHaveTextContent('You can choose another folder')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await settle()
    await fireEvent.click(screen.getByRole('button', { name: 'Choose another folder' }))
    expect(api.respond).toHaveBeenCalledExactlyOnceWith('protected', 1)
  })

  it('draws a plain message for a dialog without a design', async () => {
    const { show } = mountDialog()
    await show({
      id: 'message', type: 'info', title: 'Hronaut', message: 'Something happened', detail: 'First part.\n\nSecond part.',
      buttons: ['OK'], defaultId: 0, cancelId: 0, variant: { kind: 'message' }
    })
    const dialog = screen.getByRole('alertdialog', { name: 'Something happened' })
    expect(dialog).toHaveTextContent('First part.')
    expect(dialog).toHaveTextContent('Second part.')
    expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus()
  })
})
