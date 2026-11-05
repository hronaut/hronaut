import type { HomeTab } from '../../../shared/home-tabs.js'
import type { BrowserTabOverviewPreview } from '../../../shared/types.js'
import { errorText } from './dom.js'
import { displayUrl, tabName, type TabWords } from './tab-cards.js'

type Status = 'loading' | 'ready' | 'error' | 'changed' | 'closed'

interface PagePreviewOptions {
  capture: (tabId: string) => Promise<BrowserTabOverviewPreview>
  open: (tabId: string) => void
  back: () => void
}

function control(text: string, action: string, className = ''): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.dataset.previewAction = action
  button.textContent = text
  return button
}

/**
 * A tab's whole page in one picture, taken when it is shown and again on Refresh. It is a snapshot: a navigation,
 * a reload or the tab going to sleep says so instead of keeping a picture of a page that is gone.
 */
export function mountTabPagePreview(root: HTMLElement, words: TabWords, options: PagePreviewOptions, signal: AbortSignal) {
  let tab: HomeTab | undefined
  let tabId: string | null = null
  let status: Status = 'loading'
  let picture: BrowserTabOverviewPreview | null = null
  let failure: unknown = null
  let fit: 'page' | 'width' = 'page'
  let request = 0

  const back = control(words.t('tabSearch.backToTabs'), 'back')
  const title = document.createElement('strong')
  const address = document.createElement('span')
  const heading = document.createElement('div')
  heading.className = 'tab-page-preview-heading'
  heading.append(title, address)
  const open = control(words.t('tabSearch.openTab'), 'open', 'workspace-primary')
  const toolbar = document.createElement('div')
  toolbar.className = 'tab-page-preview-toolbar'
  toolbar.append(back, heading, open)
  const fitGroup = document.createElement('div')
  fitGroup.className = 'tab-page-preview-fit'
  fitGroup.setAttribute('role', 'group')
  fitGroup.setAttribute('aria-label', words.t('tabSearch.previewScale'))
  const fitPage = control(words.t('tabSearch.fitPage'), 'fit-page')
  const fitWidth = control(words.t('tabSearch.fitWidth'), 'fit-width')
  fitGroup.append(fitPage, fitWidth)
  const note = document.createElement('span')
  note.textContent = words.t('tabSearch.previewSnapshot')
  const refreshButton = control(words.t('tabSearch.refreshPreview'), 'refresh')
  const settings = document.createElement('div')
  settings.className = 'tab-page-preview-options'
  settings.append(fitGroup, note, refreshButton)
  const stage = document.createElement('div')
  stage.className = 'tab-page-preview-stage'
  root.replaceChildren(toolbar, settings, stage)

  const unavailable = (): boolean => !tab || tab.loading || tab.sleeping

  /** The tab's name and the buttons, which follow the tab on every read without drawing the picture again. */
  function renderControls(): void {
    title.textContent = tab ? tabName(tab, words) : words.t('tabSearch.newTabTitle')
    address.textContent = tab ? displayUrl(tab.url, words) : words.t('tabSearch.previewClosed')
    open.disabled = !tab
    refreshButton.disabled = status === 'loading' || unavailable()
    fitPage.setAttribute('aria-pressed', String(fit === 'page'))
    fitWidth.setAttribute('aria-pressed', String(fit === 'width'))
  }

  function render(): void {
    renderControls()
    // The picture or its state is drawn anew; focus inside it goes to Back to tabs, not to the page body.
    const hadFocus = stage.contains(document.activeElement)
    if (picture) {
      const canvas = document.createElement('div')
      canvas.className = `tab-page-preview-canvas fit-${fit}`
      canvas.tabIndex = 0
      canvas.setAttribute('aria-label', words.t('tabSearch.pagePreview'))
      const image = document.createElement('img')
      image.src = picture.dataUrl
      image.width = picture.width
      image.height = picture.height
      image.alt = words.t('tabSearch.fullPreviewAlt', { title: title.textContent })
      image.draggable = false
      canvas.append(image)
      stage.replaceChildren(canvas)
    } else {
      const state = document.createElement('div')
      state.className = 'tab-page-preview-state'
      state.setAttribute('role', status === 'loading' ? 'status' : 'alert')
      if (status === 'loading') {
        state.setAttribute('aria-busy', 'true')
        const spinner = document.createElement('span')
        spinner.className = 'spinner'
        spinner.setAttribute('aria-hidden', 'true')
        state.append(spinner)
      }
      const message = document.createElement('strong')
      message.textContent = words.t(status === 'loading' ? 'tabSearch.previewCapturing'
        : status === 'closed' ? 'tabSearch.previewClosed'
          : status === 'changed' ? 'tabSearch.previewChanged' : 'tabSearch.previewFailed')
      state.append(message)
      if (status !== 'loading' && tab) {
        const recovery = document.createElement('span')
        recovery.textContent = status === 'error' ? errorText(failure, words.t('tabSearch.previewRecovery')) : words.t('tabSearch.previewRecovery')
        const retry = control(words.t('tabSearch.retryPreview'), 'refresh')
        retry.disabled = unavailable()
        state.append(recovery, retry)
      }
      stage.replaceChildren(state)
    }
    if (hadFocus && document.activeElement === document.body) back.focus()
  }

  async function refresh(): Promise<void> {
    const current = tab
    const token = ++request
    failure = null
    picture = null
    if (!current) status = 'closed'
    else if (current.loading || current.sleeping) status = 'changed'
    else status = 'loading'
    render()
    if (status !== 'loading' || !current) return
    try {
      const result = await options.capture(current.id)
      if (request !== token) return
      if (result.tabId !== current.id || result.navigationGeneration !== current.navigationGeneration
        || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/u.test(result.dataUrl)
        || !Number.isSafeInteger(result.width) || result.width <= 0
        || !Number.isSafeInteger(result.height) || result.height <= 0) throw new Error('Invalid preview')
      picture = result
      status = 'ready'
    } catch (cause) {
      if (request !== token) return
      failure = cause
      status = 'error'
    }
    render()
  }

  root.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-preview-action]')
    if (!button || button.disabled || !tabId) return
    const action = button.dataset.previewAction
    if (action === 'back') options.back()
    else if (action === 'open') options.open(tabId)
    else if (action === 'refresh') void refresh()
    else if (action === 'fit-page' || action === 'fit-width') { fit = action === 'fit-page' ? 'page' : 'width'; render() }
  }, { signal })
  // Enter repeats while it is held: the preview's buttons take a new press, as Home's other buttons do.
  root.addEventListener('keydown', event => {
    if (event.repeat && event.key === 'Enter' && (event.target as Element).closest('button')) event.preventDefault()
  }, { signal })

  return {
    isOpen: (): boolean => tabId !== null,
    show(next: HomeTab): void {
      tab = next
      tabId = next.id
      fit = 'page'
      root.hidden = false
      void refresh()
      back.focus()
    },
    hide(): void {
      request++
      tab = undefined
      tabId = null
      picture = null
      root.hidden = true
    },
    /** The tabs as they are now: a navigation, reload, sleep or close makes the picture out of date. */
    update(tabs: HomeTab[]): void {
      if (!tabId) return
      const next = tabs.find(candidate => candidate.id === tabId)
      const identity = (value: HomeTab | undefined): string => JSON.stringify([value?.navigationGeneration, value?.loading, value?.sleeping])
      const changed = identity(next) !== identity(tab)
      tab = next
      if (!changed) { renderControls(); return }
      request++
      picture = null
      failure = null
      status = next ? 'changed' : 'closed'
      render()
    }
  }
}
