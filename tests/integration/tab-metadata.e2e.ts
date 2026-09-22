import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_TAB_TITLE_CHARS } from '../../src/main/browser/tab-metadata.js'
import type { BrowserState } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('bounds website-controlled titles in live, closed, and persisted tab state', async ({
  appWindow,
  profileDirectory
}) => {
  const title = `${'T'.repeat(MAX_TAB_TITLE_CHARS - 1)}🧪`
  const boundedTitle = 'T'.repeat(MAX_TAB_TITLE_CHARS - 1)
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(`<script>document.title=${JSON.stringify(title)}</script><main>Bounded title</main>`)}`
  const opened = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`) as BrowserState
  const tabId = opened.activeTabId!

  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => {
    const tab = state.tabs.find((candidate) => candidate.id === ${JSON.stringify(tabId)})
    return tab ? { length: tab.title.length, title: tab.title } : null
  })`)).toEqual({ length: boundedTitle.length, title: boundedTitle })

  await expect.poll(async () => {
    const source = await readFile(join(profileDirectory, 'tabs.json'), 'utf8').catch(() => '')
    if (!source) return null
    const state = JSON.parse(source) as { tabs: Array<{ id: string; title: string }> }
    const tab = state.tabs.find((candidate) => candidate.id === tabId)
    return tab ? { length: tab.title.length, title: tab.title } : null
  }).toEqual({ length: boundedTitle.length, title: boundedTitle })

  await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(tabId)})`)
  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => {
    const tab = state.closedTabs.find((candidate) => candidate.url === ${JSON.stringify(url)})
    return tab ? { length: tab.title.length, title: tab.title } : null
  })`)).toEqual({ length: boundedTitle.length, title: boundedTitle })
})
