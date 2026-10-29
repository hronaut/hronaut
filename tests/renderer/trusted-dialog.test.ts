// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrustedDialog from '../../src/renderer/src/trusted-dialogs/TrustedDialog.vue'
import { useTrustedDialogController } from '../../src/renderer/src/trusted-dialogs/useTrustedDialogController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { holdOverlayEntrance, occludeBrowserContent, overlayEntranceEpoch, releaseOverlayEntrance, reportPageViewsHidden, resetOverlayMotion } from '../../src/renderer/src/composables/overlay-motion.js'
import { useShellOverlayCoordinationController } from '../../src/renderer/src/composables/useShellOverlayCoordinationController.js'
import { useModalDialogFocus } from '../../src/renderer/src/composables/useModalDialogFocus.js'
import type { SupportedLocale } from '../../src/shared/locale.js'
import type { HronautTrustedDialogsApi, TrustedDialogRequest, TrustedDialogShellState } from '../../src/shared/trusted-dialogs.js'

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
  let publish: (request: TrustedDialogRequest | null, state: TrustedDialogShellState) => void = () => undefined
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
    /** Main shows the request, or none, and says whether a sign-in closed unanswered moments ago. */
    show: async (request: TrustedDialogRequest | null, state: TrustedDialogShellState = { afterInterruptedSignIn: false }) => {
      publish(request, state)
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
    reportPageViewsHidden(overlayEntranceEpoch())
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
    let publish: (request: TrustedDialogRequest | null, state: TrustedDialogShellState) => void = () => undefined
    const api: HronautTrustedDialogsApi = { ready: vi.fn(), respond: vi.fn(), onChanged: (listener) => { publish = listener; return () => undefined } }
    const covered: Array<[boolean, number]> = []
    const shellApi = { setBrowserContentOccluded: (occluded: boolean, request: number) => { covered.push([occluded, request]) } }
    const Shell = defineComponent({
      setup() {
        const controller = useTrustedDialogController(api)
        useShellOverlayCoordinationController({
          activePanel: ref(null), splitMenu: ref(false), layoutSources: [], competingOverlayStates: [], preservedPanels: [],
          fullModalOpen: computed(() => controller.open.value),
          keepsSeparatePanelOpen: () => false, closePanelsExcept: () => undefined, closeAddressSuggestions: () => undefined,
          setBrowserContentOccluded: (occluded) => occludeBrowserContent(shellApi, occluded),
          reportLayout: () => undefined
        })
        return () => h(TrustedDialog, { controller })
      }
    })
    render(Shell, { global: { plugins: [createHronautI18n('en-US')] } })
    publish(sitePermission('one'), { afterInterruptedSignIn: false })
    await nextTick()
    await nextTick()
    expect(covered).toEqual([[true, overlayEntranceEpoch()]])
    await vi.advanceTimersByTimeAsync(900)
    await nextTick()
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-armed', 'false')
    reportPageViewsHidden(covered[0][1])
    await nextTick()
    await vi.advanceTimersByTimeAsync(600)
    await nextTick()
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-armed', 'true')
  })

  it('takes no answer on a report main sent for an earlier request, while it may still keep the page on screen', async () => {
    const sent: Array<[boolean, number]> = []
    const shellApi = { setBrowserContentOccluded: (occluded: boolean, request: number) => { sent.push([occluded, request]) } }
    const { api, show, settle } = mountDialog()
    // A website drops its first question and asks again at once.
    occludeBrowserContent(shellApi, true)
    occludeBrowserContent(shellApi, false)
    occludeBrowserContent(shellApi, true)
    await show(sitePermission('two'))
    expect(sent.map(([occluded]) => occluded)).toEqual([true, false, true])
    // Main's report for the first request crosses the second one on its way.
    reportPageViewsHidden(sent[0][1])
    await vi.advanceTimersByTimeAsync(3_000)
    await nextTick()
    await fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-armed', 'false')
    expect(api.respond).not.toHaveBeenCalled()
    reportPageViewsHidden(sent[2][1])
    await nextTick()
    await settle()
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
    expect(dialog).not.toHaveAttribute('data-topic')
  })

  it('keeps its safe answer focused over a modal that holds the focus, so Enter and Tab never reach the modal', async () => {
    // The workspace editor and Search tabs keep the focus inside them while they are open.
    const modalOpen = ref(true)
    const modalPanel = ref<HTMLElement | null>(null)
    const closeModal = vi.fn()
    render(defineComponent({
      setup() {
        useModalDialogFocus({ open: modalOpen, panel: modalPanel })
        return () => h('section', { ref: modalPanel, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Edit workspace', tabindex: -1 }, [
          h('button', { type: 'button', onClick: closeModal }, '×'),
          h('button', { type: 'button' }, 'Close workspace')
        ])
      }
    }))
    await nextTick()
    const { api, show, settle } = mountDialog()
    await show({
      id: 'close', type: 'question', title: 'Please confirm', message: 'Close workspace “Client”?', detail: 'Its pages close.',
      buttons: ['Cancel', 'OK'], defaultId: 0, cancelId: 0, primaryId: 1, variant: { kind: 'message' }
    })
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(cancel).toHaveFocus()
    await settle()
    expect(cancel).toHaveFocus()

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync })
    await user.tab()
    expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(cancel).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(api.respond).toHaveBeenCalledWith('close', 0)
    expect(closeModal).not.toHaveBeenCalled()
  })

  it('marks one of Hronaut’s own questions by what it is about, keeping its words and the safe answer focused', async () => {
    const { api, show, settle } = mountDialog()
    await show({
      id: 'leave', type: 'warning', title: 'Leave this page?', message: 'This page asked Hronaut to confirm before leaving it.',
      detail: 'Leaving the page may discard changes that have not been saved.',
      buttons: ['Keep editing', 'Leave page'], defaultId: 0, cancelId: 0, primaryId: 1,
      variant: { kind: 'message', topic: 'unsaved-changes' }
    })
    const dialog = screen.getByRole('alertdialog', { name: 'This page asked Hronaut to confirm before leaving it.' })
    expect(dialog).toHaveAttribute('data-topic', 'unsaved-changes')
    expect(dialog).toHaveClass('trusted-dialog--warning')
    expect(dialog).toHaveTextContent('Leave this page?')
    expect(dialog).toHaveTextContent('Leaving the page may discard changes')
    expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Leave page' })).toHaveClass('ui-button--primary')
    await settle()
    await fireEvent.click(screen.getByRole('button', { name: 'Leave page' }))
    expect(api.respond).toHaveBeenCalledExactlyOnceWith('leave', 1)
  })
})

function savePassword(id: string, overrides: Partial<Extract<TrustedDialogRequest['variant'], { kind: 'save-password' }>> = {}): TrustedDialogRequest {
  return {
    id,
    type: 'question',
    title: 'Save password?',
    message: 'Save the password for ada@example.com?',
    detail: 'https://login.example\n\nPasswords are encrypted with the operating system’s secure storage.',
    buttons: ['Not now', 'Save password'],
    defaultId: 1,
    cancelId: 0,
    primaryId: 1,
    variant: { kind: 'save-password', origin: 'https://login.example', username: 'ada@example.com', updating: false, suggested: false, ...overrides }
  }
}

describe('Hronaut’s save password dialog', () => {
  it('names the website, quotes the username the page sent, and saves only on Save', async () => {
    const { api, show, settle } = mountDialog()
    await show(savePassword('save'))
    const dialog = screen.getByRole('alertdialog', { name: 'Save your password for https://login.example?' })
    expect(dialog).toHaveAttribute('data-variant', 'save-password')
    expect(dialog.querySelector('.trusted-dialog__origin')).toHaveTextContent('https://login.example')
    expect(dialog).toHaveTextContent('Saved passwords')
    expect(screen.getByTestId('trusted-dialog-quoted')).toHaveTextContent('ada@example.com')
    expect(dialog.querySelector('.trusted-dialog__quoted figcaption')).toHaveTextContent('Username')
    expect(dialog).toHaveTextContent('Saved passwords are never exposed through MCP.')
    expect(dialog).not.toHaveTextContent('Hronaut suggested this password')
    const save = screen.getByRole('button', { name: 'Save password' })
    expect(save).toHaveFocus()
    expect(save).toHaveClass('ui-button--primary')
    await fireEvent.click(save)
    expect(api.respond).not.toHaveBeenCalled()
    await settle()
    await fireEvent.click(save)
    expect(api.respond).toHaveBeenCalledExactlyOnceWith('save', 1)
  })

  it('asks to update a saved password, and says so when the page sent no username', async () => {
    const { show } = mountDialog()
    await show({ ...savePassword('update', { updating: true, username: '' }), buttons: ['Not now', 'Update password'] })
    const dialog = screen.getByRole('alertdialog', { name: 'Update your saved password for https://login.example?' })
    expect(screen.queryByTestId('trusted-dialog-quoted')).toBeNull()
    expect(dialog).toHaveTextContent('The page sent no username with it.')
  })

  it('says what not saving means for a password Hronaut suggested', async () => {
    const { show } = mountDialog()
    await show(savePassword('suggested', { suggested: true }))
    const dialog = screen.getByRole('alertdialog', { name: 'Save your password for https://login.example?' })
    expect(dialog).toHaveTextContent('Hronaut suggested this password and never shows it. Save it, or you will need to reset it to sign in again.')
  })

  it('speaks the interface language', async () => {
    const { show } = mountDialog('ru-RU')
    await show(savePassword('ru'))
    screen.getByRole('alertdialog', { name: 'Сохранить пароль для https://login.example?' })
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Имя пользователя')
  })
})

const RECOVERY_WORDS = ['abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident']

function walletRecovery(id: string): TrustedDialogRequest {
  return {
    id,
    type: 'warning',
    title: 'Save wallet recovery material',
    message: 'Write down this recovery phrase and store it offline.',
    detail: `${RECOVERY_WORDS.join(' ')}\n\nHronaut cannot recover this phrase. Never share it with a website or coding agent.`,
    buttons: ['I saved it', 'Not yet'],
    defaultId: 1,
    cancelId: 1,
    primaryId: 0,
    variant: { kind: 'wallet-recovery', walletName: 'Treasury', words: [...RECOVERY_WORDS] }
  }
}

describe('Hronaut’s wallet recovery phrase dialog', () => {
  it('lists the phrase as numbered words under the wallet’s name, with Not yet focused and I saved it as the main action', async () => {
    const { api, show, settle } = mountDialog()
    await show(walletRecovery('recovery'))
    const dialog = screen.getByRole('alertdialog', { name: 'Write down the recovery phrase for Treasury' })
    expect(dialog).toHaveAttribute('data-variant', 'wallet-recovery')
    expect(dialog.querySelector('.trusted-dialog__origin')).toHaveTextContent('Treasury')
    expect(dialog).toHaveTextContent('New wallet')
    const phrase = within(dialog).getByRole('list', { name: 'Recovery phrase' })
    const items = within(phrase).getAllByRole('listitem')
    expect(items.map((item) => [item.firstElementChild?.textContent, item.lastElementChild?.textContent]))
      .toEqual(RECOVERY_WORDS.map((word, index) => [String(index + 1), word]))
    // The numbers are for the eye; a screen reader announces each word's place in the list.
    expect(items[0]?.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    // The words show once, in the list, and never as one of the dialog's paragraphs.
    expect(dialog.textContent.split('abandon')).toHaveLength(2)
    expect(dialog).toHaveTextContent('Anyone who has them controls the wallet.')
    expect(dialog).toHaveTextContent('Never share it with a website or coding agent.')
    expect(dialog).toHaveTextContent('Hronaut adds the wallet once you confirm you saved them.')
    expect(screen.getByRole('button', { name: 'Not yet' })).toHaveFocus()
    const saved = screen.getByRole('button', { name: 'I saved it' })
    expect(saved).toHaveClass('ui-button--primary')
    await settle()
    await fireEvent.click(saved)
    expect(api.respond).toHaveBeenCalledExactlyOnceWith('recovery', 0)
  })

  it('takes the phrase off the screen as soon as the person answers, before main closes the dialog', async () => {
    const { api, show, settle } = mountDialog()
    await show(walletRecovery('recovery'))
    await settle()
    await fireEvent.click(screen.getByRole('button', { name: 'I saved it' }))
    expect(api.respond).toHaveBeenCalledExactlyOnceWith('recovery', 0)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Recovery phrase' })).toBeNull()
    expect(screen.getByRole('alertdialog').textContent).not.toContain('abandon')
  })

  it('never answers I saved it from an Enter held since before it opened, and answers Escape as Not yet', async () => {
    const { api, show, settle } = mountDialog()
    await show(walletRecovery('recovery'))
    await settle()
    const notYet = screen.getByRole('button', { name: 'Not yet' })
    const heldEnter = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
    notYet.dispatchEvent(heldEnter)
    expect(heldEnter.defaultPrevented).toBe(true)
    expect(api.respond).not.toHaveBeenCalled()
    await fireEvent.keyDown(notYet, { key: 'Escape' })
    expect(api.respond).toHaveBeenCalledExactlyOnceWith('recovery', 1)
  })

  it('speaks the interface language', async () => {
    const { show } = mountDialog('uk-UA')
    await show(walletRecovery('uk'))
    const dialog = screen.getByRole('alertdialog', { name: 'Запишіть фразу відновлення для Treasury' })
    within(dialog).getByRole('list', { name: 'Фраза відновлення' })
    expect(dialog).toHaveTextContent('Новий гаманець')
  })
})

const CLAUDE_AFTER = JSON.stringify({ type: 'http', url: 'http://127.0.0.1:47812/mcp', headers: { Authorization: 'Bearer •••' } }, null, 2)
const CLAUDE_BEFORE = JSON.stringify({ type: 'http', url: 'http://127.0.0.1:47812/mcp' }, null, 2)

function claudeSetup(id: string, overrides: Partial<Extract<TrustedDialogRequest['variant'], { kind: 'claude-setup' }>> = {}): TrustedDialogRequest {
  return {
    id,
    type: 'question',
    title: 'Set up Claude Code',
    message: 'Add Hronaut to Claude Code?',
    detail: 'File: /home/person/.claude.json',
    buttons: ['Cancel', 'Add to Claude Code'],
    defaultId: 0,
    cancelId: 0,
    primaryId: 1,
    variant: { kind: 'claude-setup', path: '/home/person/.claude.json', after: CLAUDE_AFTER, before: CLAUDE_BEFORE, tokenHidden: true, backupName: '.claude.json.hronaut-backup-20261024T001500Z', ...overrides }
  }
}

describe('Hronaut’s Claude Code setup dialog', () => {
  it('shows the file, the entry Hronaut writes and the one it replaces, with Cancel focused and Add as the main action', async () => {
    const { api, show, settle } = mountDialog()
    await show(claudeSetup('setup'))
    const dialog = screen.getByRole('alertdialog', { name: 'Add Hronaut to Claude Code?' })
    expect(dialog).toHaveAttribute('data-variant', 'claude-setup')
    expect(dialog).toHaveTextContent('Set up Claude Code')
    const change = within(dialog).getByTestId('trusted-dialog-change')
    expect(within(change).getByTestId('trusted-dialog-change-path')).toHaveTextContent('/home/person/.claude.json')
    expect(change).toHaveTextContent('File')
    // The entries keep their JSON layout, as Home showed them, in diff order: written, then replaced.
    const added = within(change).getByRole('region', { name: 'New entry in "mcpServers"' })
    const removed = within(change).getByRole('region', { name: 'Entry it replaces' })
    expect(added.textContent).toBe(`"hronaut": ${CLAUDE_AFTER}`)
    expect(removed.textContent).toBe(`"hronaut": ${CLAUDE_BEFORE}`)
    expect(added.compareDocumentPosition(removed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(added.closest('.trusted-dialog__change-entry')).toHaveClass('trusted-dialog__change-entry--added')
    expect(removed.closest('.trusted-dialog__change-entry')).toHaveClass('trusted-dialog__change-entry--removed')
    // The token note belongs to the entry that will hold the token, not to the replaced one, whose ••• hide old values.
    expect(within(added.closest('.trusted-dialog__change-entry')!).getByText('Hronaut writes the actual MCP token where ••• appears.')).toBeInTheDocument()
    expect(removed.closest('.trusted-dialog__change-entry')).not.toHaveTextContent('Hronaut writes the actual MCP token')
    expect(dialog).toHaveTextContent('A copy of the file is saved first as .claude.json.hronaut-backup-20261024T001500Z.')
    expect(dialog).toHaveTextContent('If Claude Code is running, quit it first')
    // The detail given for the system dialog is not repeated under Hronaut's own design.
    expect(dialog).not.toHaveTextContent('File: /home/person/.claude.json')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    const add = screen.getByRole('button', { name: 'Add to Claude Code' })
    expect(add).toHaveClass('ui-button--primary')
    await settle()
    await fireEvent.click(add)
    expect(api.respond).toHaveBeenCalledExactlyOnceWith('setup', 1)
  })

  it('shows only the new entry for a file without one, and no token line without a token', async () => {
    const { show } = mountDialog()
    await show(claudeSetup('fresh', { before: null, tokenHidden: false, after: CLAUDE_BEFORE }))
    const dialog = screen.getByRole('alertdialog', { name: 'Add Hronaut to Claude Code?' })
    expect(within(dialog).getByRole('region', { name: 'New entry in "mcpServers"' }).textContent).toBe(`"hronaut": ${CLAUDE_BEFORE}`)
    expect(within(dialog).queryByRole('region', { name: 'Entry it replaces' })).toBeNull()
    expect(dialog).not.toHaveTextContent('•••')
  })

  it('speaks the interface language', async () => {
    const { show } = mountDialog('uk-UA')
    await show(claudeSetup('uk'))
    const dialog = screen.getByRole('alertdialog', { name: 'Додати Hronaut до Claude Code?' })
    within(dialog).getByRole('region', { name: 'Новий запис у "mcpServers"' })
    within(dialog).getByRole('region', { name: 'Запис, який він замінить' })
    expect(dialog).toHaveTextContent('Hronaut запише справжній токен MCP на місце •••.')
  })
})

function httpAuth(id: string, overrides: Partial<Extract<TrustedDialogRequest['variant'], { kind: 'http-auth' }>> = {}): TrustedDialogRequest {
  return {
    id,
    type: 'question',
    title: 'Sign in',
    message: 'Sign in to https://intranet.example',
    buttons: ['Cancel', 'Sign in'],
    defaultId: 0,
    cancelId: 0,
    primaryId: 1,
    variant: { kind: 'http-auth', origin: 'https://intranet.example', secure: true, workspaceName: 'Client A', ...overrides }
  }
}

describe('Hronaut’s sign-in dialog for a website', () => {
  it('names the website and the workspace, with the focus in Username and fields that take no typing until it takes answers', async () => {
    const { show, settle } = mountDialog()
    await show(httpAuth('one'))
    const dialog = screen.getByRole('alertdialog', { name: 'Sign in to https://intranet.example' })
    expect(dialog).toHaveAttribute('data-variant', 'http-auth')
    expect(dialog).toHaveTextContent('You stay signed in to this website in the “Client A” workspace until Hronaut quits.')
    expect(dialog).toHaveTextContent('Hronaut sends your username and password only to this website and never shows them to agents.')
    expect(dialog).not.toHaveTextContent('not private')
    const username = screen.getByLabelText('Username')
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')
    expect(username).toHaveFocus()
    expect(username).toHaveAttribute('readonly')
    await settle()
    expect(username).not.toHaveAttribute('readonly')
    expect(username).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveClass('ui-button--primary')
  })

  it('warns that anyone on the network can read what is sent over an unencrypted connection', async () => {
    const { show } = mountDialog()
    await show(httpAuth('one', { origin: 'http://intranet.example', secure: false, workspaceName: undefined }))
    const dialog = screen.getByRole('alertdialog', { name: 'Sign in to http://intranet.example' })
    expect(dialog).toHaveClass('trusted-dialog--warning')
    expect(dialog).toHaveTextContent('Your connection to this site is not private. Anyone on the network can read your username and password.')
    expect(dialog).not.toHaveTextContent('workspace')
  })

  it('signs in with what the person typed, by Enter or the button, and cancels without sending any of it', async () => {
    const { api, show, settle } = mountDialog()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync })
    await show(httpAuth('one'))
    await settle()
    await user.type(screen.getByLabelText('Username'), 'ada')
    await user.type(screen.getByLabelText('Password'), 's3cret{Enter}')
    expect(api.respond).toHaveBeenCalledExactlyOnceWith('one', 1, { username: 'ada', password: 's3cret' })
    expect(screen.getByLabelText('Password')).toHaveValue('')

    await show(httpAuth('two'))
    await settle()
    expect(screen.getByLabelText('Username')).toHaveValue('')
    await user.type(screen.getByLabelText('Password'), 'typed')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.respond).toHaveBeenLastCalledWith('two', 0)

    await show(httpAuth('three'))
    await settle()
    expect(screen.getByLabelText('Password')).toHaveValue('')
    await user.type(screen.getByLabelText('Username'), 'grace')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(api.respond).toHaveBeenLastCalledWith('three', 1, { username: 'grace', password: '' })
  })

  it('takes no Enter before it takes answers, nor one held since before it opened, nor one that ends a composed word', async () => {
    const { api, show, settle } = mountDialog()
    await show(httpAuth('one'))
    const password = screen.getByLabelText('Password')
    await fireEvent.keyDown(password, { key: 'Enter' })
    await settle()
    password.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true }))
    await fireEvent.keyDown(password, { key: 'Enter', isComposing: true })
    expect(api.respond).not.toHaveBeenCalled()
    await fireEvent.keyDown(password, { key: 'Enter' })
    expect(api.respond).toHaveBeenCalledExactlyOnceWith('one', 1, { username: '', password: '' })
  })

  it('moves from Username to Password on Enter, so a password typed into Username is never sent by its Enter', async () => {
    const { api, show, settle } = mountDialog()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync })
    await show(httpAuth('one'))
    await settle()
    await user.type(screen.getByLabelText('Username'), 'tail{Enter}')
    expect(api.respond).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Password')).toHaveFocus()
  })

  it('repeats a key held in its fields, such as Backspace, but never a held Enter or Tab', async () => {
    const { show, settle } = mountDialog()
    await show(httpAuth('one'))
    await settle()
    const username = screen.getByLabelText('Username')
    const held = (key: string): boolean => username.dispatchEvent(new KeyboardEvent('keydown', { key, repeat: true, bubbles: true, cancelable: true }))
    expect(held('Backspace')).toBe(true)
    expect(held('a')).toBe(true)
    expect(held('Enter')).toBe(false)
    expect(held('Tab')).toBe(false)
  })

  it('starts on its text when it shows moments after a sign-in that closed before the person answered, who may still be typing', async () => {
    const { api, show, settle } = mountDialog()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync })
    const interrupted = { afterInterruptedSignIn: true }
    await show(httpAuth('one'))
    await settle()
    await user.type(screen.getByLabelText('Password'), 'pass')
    // Main closes the first sign-in, as when its page loads another, and shows another tab's one in its place.
    await show(httpAuth('two', { origin: 'https://intranet-example.test' }), interrupted)
    const text = screen.getByTestId('trusted-dialog-details')
    expect(text).toHaveFocus()
    await settle()
    expect(text).toHaveFocus()
    // The rest of the password and its Enter press nothing, not even Cancel, and no field takes them.
    await user.keyboard('word{Enter}')
    expect(api.respond).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Username')).toHaveValue('')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    // Tab moves on to Username, where the person signs in.
    await user.tab()
    expect(screen.getByLabelText('Username')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.respond).toHaveBeenCalledExactlyOnceWith('two', 0)

    // The page that asked opens one that asks: no dialog for a moment, then the new sign-in, which the rest of the
    // password must not reach either.
    await show(httpAuth('three'))
    await settle()
    await user.type(screen.getByLabelText('Password'), 'pass')
    await show(null, interrupted)
    await show(httpAuth('four', { origin: 'https://intranet-example.test' }), interrupted)
    expect(screen.getByTestId('trusted-dialog-details')).toHaveFocus()
    await user.keyboard('word{Enter}')
    await settle()
    expect(screen.getByTestId('trusted-dialog-details')).toHaveFocus()
    await user.keyboard('word{Enter}')
    expect(screen.getByLabelText('Username')).toHaveValue('')
    expect(api.respond).toHaveBeenCalledTimes(1)

    // One that comes later starts in Username, as usual, and its text takes no focus.
    await show(httpAuth('five'))
    await settle()
    expect(screen.getByLabelText('Username')).toHaveFocus()
    expect(screen.getByTestId('trusted-dialog-details')).not.toHaveAttribute('tabindex')
  })

  it('starts any dialog shown moments after an interrupted sign-in on its text, where the rest of a password and Enter answer nothing', async () => {
    const { api, show, settle } = mountDialog()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync })
    await show(httpAuth('one'))
    await settle()
    await user.type(screen.getByLabelText('Password'), 'pass')
    // A website's permission prompt replaces the sign-in that closed while the person typed.
    await show(sitePermission('permission'), { afterInterruptedSignIn: true })
    const text = screen.getByTestId('trusted-dialog-details')
    expect(text).toHaveFocus()
    await settle()
    expect(text).toHaveFocus()
    await user.keyboard('word{Enter}')
    expect(api.respond).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Allow' }))
    expect(api.respond).toHaveBeenCalledExactlyOnceWith('permission', 1)
    // So does a message with nothing but its headline, whose OK Enter would press.
    await show({ id: 'message', type: 'info', title: 'Hronaut', message: 'Something happened', buttons: ['OK'], defaultId: 0, cancelId: 0, variant: { kind: 'message' } }, { afterInterruptedSignIn: true })
    await settle()
    expect(screen.getByTestId('trusted-dialog-details')).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(api.respond).toHaveBeenCalledOnce()
    // One that comes later starts on its safe answer, as usual.
    await show(sitePermission('later'))
    await settle()
    expect(screen.getByRole('button', { name: 'Deny' })).toHaveFocus()
  })

  it('gives the focus back to the shell control it came from once answered, but to nothing when it closes before an answer', async () => {
    const { show, settle } = mountDialog()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync })
    const address = document.createElement('input')
    address.setAttribute('aria-label', 'Address')
    document.body.append(address)
    try {
      address.focus()
      await show(httpAuth('one'))
      await settle()
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      await show(null)
      expect(address).toHaveFocus()

      // Answered in another tab: the person is done with it.
      await show(httpAuth('two'))
      await settle()
      await show(null)
      expect(address).toHaveFocus()

      await show(httpAuth('three'))
      await settle()
      await user.type(screen.getByLabelText('Password'), 'pass')
      await show(null, { afterInterruptedSignIn: true })
      expect(address).not.toHaveFocus()
      expect(document.activeElement).toBe(document.body)
    } finally {
      address.remove()
    }
  })

  it('keeps the field the person moved to while it was opening', async () => {
    const { show, settle } = mountDialog()
    await show(httpAuth('one'))
    screen.getByLabelText('Password').focus()
    await settle()
    expect(screen.getByLabelText('Password')).toHaveFocus()
  })
})

function certificate(id: string, overrides: Partial<Extract<TrustedDialogRequest['variant'], { kind: 'certificate' }>> = {}): TrustedDialogRequest {
  return {
    id,
    type: 'warning',
    title: 'Not private',
    message: 'Proceed to staging.example?',
    buttons: ['Back to safety', 'Proceed (unsafe)'],
    defaultId: 0,
    cancelId: 0,
    variant: { kind: 'certificate', host: 'staging.example', error: 'ERR_CERT_AUTHORITY_INVALID', workspaceName: 'Client A', ...overrides }
  }
}

describe('Hronaut’s question before opening a page whose certificate was refused', () => {
  it('names the website, why its certificate is not trusted, the risk and the workspace, with Back to safety focused', async () => {
    const { show, settle } = mountDialog()
    await show(certificate('one'))
    const dialog = screen.getByRole('alertdialog', { name: 'Proceed to staging.example?' })
    expect(dialog).toHaveAttribute('data-variant', 'certificate')
    expect(dialog).toHaveClass('trusted-dialog--warning')
    expect(dialog).toHaveTextContent('Not private')
    expect(dialog).toHaveTextContent('Its security certificate is not from an authority this computer trusts.')
    expect(dialog).toHaveTextContent('Someone on the network might be pretending to be this website')
    expect(dialog).toHaveTextContent('in the “Client A” workspace until it quits, and agents in the workspace can open it too.')
    expect(dialog).not.toHaveTextContent('Hronaut trusts this certificate for this website until it quits.')
    const back = screen.getByRole('button', { name: 'Back to safety' })
    expect(back).toHaveFocus()
    // Proceeding is never drawn as the main action.
    expect(screen.getByRole('button', { name: 'Proceed (unsafe)' })).not.toHaveClass('ui-button--primary')
    expect(back).not.toHaveClass('ui-button--primary')
    await settle()
    expect(back).toHaveFocus()
  })

  it('says why for each kind of certificate error, and that the choice lasts until Hronaut quits without a workspace', async () => {
    const { show } = mountDialog()
    for (const [error, reason] of [
      ['ERR_CERT_COMMON_NAME_INVALID', 'Its security certificate is for another website.'],
      ['ERR_CERT_DATE_INVALID', 'Its security certificate has expired or is not valid yet.'],
      ['ERR_CERT_WEAK_KEY', 'Its security certificate cannot be verified.'],
      ['toString', 'Its security certificate cannot be verified.']
    ] as const) {
      await show(certificate(error, { error, workspaceName: undefined }))
      const dialog = screen.getByRole('alertdialog')
      expect(dialog, error).toHaveTextContent(reason)
      expect(dialog, error).toHaveTextContent('Hronaut trusts this certificate for this website until it quits.')
      expect(dialog, error).not.toHaveTextContent('workspace')
    }
  })

  it('goes back on Enter or Escape, and proceeds only on its button once it takes answers', async () => {
    const { api, show, settle } = mountDialog()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync })
    await show(certificate('one'))
    await user.click(screen.getByRole('button', { name: 'Proceed (unsafe)' }))
    expect(api.respond).not.toHaveBeenCalled()
    await settle()
    await user.keyboard('{Enter}')
    expect(api.respond).toHaveBeenLastCalledWith('one', 0)

    await show(certificate('two'))
    await settle()
    await user.keyboard('{Escape}')
    expect(api.respond).toHaveBeenLastCalledWith('two', 0)

    await show(certificate('three'))
    await settle()
    await user.click(screen.getByRole('button', { name: 'Proceed (unsafe)' }))
    expect(api.respond).toHaveBeenLastCalledWith('three', 1)
  })

  it('speaks the interface language', async () => {
    const { show } = mountDialog('uk-UA')
    await show(certificate('one'))
    const dialog = screen.getByRole('alertdialog', { name: 'Перейти на staging.example?' })
    expect(dialog).toHaveTextContent('Не захищено')
  })
})
