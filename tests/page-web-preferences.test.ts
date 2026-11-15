import { describe, expect, it } from 'vitest'
import { translate, type MessageKey } from '../src/shared/i18n.js'
import { pageWebPreferences } from '../src/main/browser/new-tabs/tab-admission.js'

// A page that showed one alert or confirm box after another held the window, which each box blocks until it is
// answered, and offered no way to stop them.

describe('the web preferences of every website tab', () => {
  it('offer to stop a website\'s boxes from its second one on, in the person\'s language', () => {
    const browser = { text: (key: MessageKey) => translate('de-DE', key) }
    expect(pageWebPreferences(browser as never)).toMatchObject({
      safeDialogs: true,
      safeDialogsMessage: 'Weitere Dialogfelder auf dieser Seite verhindern'
    })
  })

  // Electron put the window in full screen for a page's full screen in any tab, even one the window did not show.
  it('leave the window\'s full screen to Hronaut, which gives it only to a page the window shows', () => {
    const browser = { text: (key: MessageKey) => translate('en-US', key) }
    expect(pageWebPreferences(browser as never)).toMatchObject({ disableHtmlFullscreenWindowResize: true })
  })

  // A link dropped on a page that did not take it, from another app or the other side of a split view, opened nothing.
  it('open a link dropped on a page that does not take it, as Chrome does', () => {
    const browser = { text: (key: MessageKey) => translate('en-US', key) }
    expect(pageWebPreferences(browser as never)).toMatchObject({ navigateOnDragDrop: true })
  })
})
