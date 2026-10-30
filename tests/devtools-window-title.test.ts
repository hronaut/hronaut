import { describe, expect, it } from 'vitest'
import type { WebContents } from 'electron'
import { openDevTools } from '../src/main/browser/devtools/devtools.js'
import { translate, type MessageKey, type MessageParameters } from '../src/shared/i18n.js'
import type { SupportedLocale } from '../src/shared/locale.js'

/** Opens Developer Tools for a tab with this title in this language and returns the window title Hronaut asked for. */
async function devToolsTitle(locale: SupportedLocale, title: string, url: string): Promise<string | undefined> {
  let opened = false
  let requested: string | undefined
  const webContents = {
    id: 7,
    isDestroyed: () => false,
    isDevToolsOpened: () => opened,
    debugger: { isAttached: () => false, detach: () => undefined },
    once: () => webContents,
    removeListener: () => webContents,
    openDevTools: (options: { title?: string }) => {
      requested = options.title
      opened = true
    }
  } as unknown as WebContents
  const tab = { id: 'tab', title, url, webContents, networkDebuggerEpoch: 0, networkConditionApplication: 'confirmed', networkRoutes: [] }
  const opening = new Set<number>()
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    destroyed: false,
    devToolsOpening: opening,
    dialogMonitorAttachPromises: new Map(),
    debuggerQueue: { pending: () => undefined },
    text: (key: MessageKey, parameters?: MessageParameters) => translate(locale, key, parameters)
  }
  await openDevTools(browser as never, tab as never)
  expect(opening.size).toBe(0)
  return requested
}

describe('the Developer Tools window title', () => {
  it('is written in the interface language', async () => {
    // It was always "Hronaut Developer Tools — <title>" in English.
    expect(await devToolsTitle('en-US', 'Checkout', 'https://shop.example/checkout')).toBe('Hronaut Developer Tools — Checkout')
    expect(await devToolsTitle('uk-UA', 'Checkout', 'https://shop.example/checkout')).toBe('Інструменти розробника Hronaut — Checkout')
    expect(await devToolsTitle('de-DE', 'Checkout', 'https://shop.example/checkout')).toBe('Hronaut-Entwicklertools — Checkout')
  })

  it('names a blank tab as a new tab in that language and keeps a page title with braces as written', async () => {
    expect(await devToolsTitle('uk-UA', 'New tab', 'about:blank')).toBe('Інструменти розробника Hronaut — Нова вкладка')
    expect(await devToolsTitle('fr-FR', 'Plan {title} | v2', 'https://docs.example/')).toBe('Outils de développement Hronaut — Plan {title} | v2')
  })
})
