import type { HomeTab } from '../../../shared/home-tabs.js'
import { MAX_TAB_LABEL_INPUT_LENGTH } from '../../../shared/tab-label.js'
import type { TabWords } from './tab-cards.js'

/** A label being edited on a tab card: what the person typed, and what went wrong with the last save. */
export interface LabelEdit {
  draft: string
  error: string
  pending: boolean
}

/** Changes when the editor's drawing would; typing changes only the draft, so the field is never redrawn under it. */
export function labelEditorSignature(tab: HomeTab, edit: LabelEdit | undefined): string {
  return JSON.stringify([tab.id, tab.label, tab.labelDurabilityUnconfirmed, edit && [edit.error, edit.pending]])
}

function labelButton(action: 'save' | 'clear' | 'cancel', text: string, type: 'button' | 'submit' = 'button'): HTMLButtonElement {
  const control = document.createElement('button')
  control.type = type
  control.dataset.labelAction = action
  control.dataset.focusKey = `label-${action}`
  control.textContent = text
  return control
}

/**
 * Under a tab card: its label form while the person edits the label, or else a warning when its label may not be on
 * disk yet. Saving keeps the field focused, so it is read-only rather than disabled meanwhile.
 */
export function renderLabelEditor(host: HTMLElement, tab: HomeTab, edit: LabelEdit | undefined, words: TabWords): void {
  if (!edit) {
    if (!tab.labelDurabilityUnconfirmed) { host.replaceChildren(); return }
    const warning = document.createElement('p')
    warning.setAttribute('role', 'alert')
    warning.textContent = words.t('tabLabel.uncertain')
    host.replaceChildren(warning)
    return
  }
  const id = `tab-label-${tab.id}`
  const form = document.createElement('form')
  form.className = 'tab-label-form'
  form.setAttribute('aria-label', words.t('tabLabel.edit'))
  const label = document.createElement('label')
  label.htmlFor = id
  label.textContent = words.t('tabLabel.name')
  const input = document.createElement('input')
  input.id = id
  input.dataset.focusKey = 'label-input'
  input.maxLength = MAX_TAB_LABEL_INPUT_LENGTH
  input.autocomplete = 'off'
  input.spellcheck = false
  input.value = edit.draft
  input.readOnly = edit.pending
  input.setAttribute('aria-describedby', `${id}-help`)
  const help = document.createElement('small')
  help.id = `${id}-help`
  help.textContent = words.t('tabLabel.help')
  form.append(label, input, help)
  if (edit.error) {
    const error = document.createElement('p')
    error.setAttribute('role', 'alert')
    error.textContent = edit.error
    form.append(error)
  }
  const buttons = document.createElement('div')
  const clear = labelButton('clear', words.t('tabLabel.clear'))
  clear.disabled = !tab.label
  buttons.append(labelButton('save', words.t('tabLabel.save'), 'submit'), clear, labelButton('cancel', words.t('tabLabel.cancel')))
  if (edit.pending) buttons.setAttribute('aria-busy', 'true')
  form.append(buttons)
  host.replaceChildren(form)
}
