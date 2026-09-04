import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { AGENT_GUIDE_IDS, AGENT_GUIDE_NAMES } from '../src/shared/agent-guides.js'

interface FormItem {
  type?: string
  id?: string
  attributes?: {
    value?: string
    options?: Array<{ label?: string; required?: boolean } | string>
  }
  validations?: { required?: boolean }
}

interface IssueForm {
  name?: string
  description?: string
  body?: FormItem[]
}

describe('setup feedback issue form', () => {
  it('parses with the required feedback fields and public-data guard', async () => {
    const source = await readFile('.github/ISSUE_TEMPLATE/setup-feedback.yml', 'utf8')
    const form = parse(source) as IssueForm

    expect(form.name).toBe('Setup feedback')
    expect(form.description).toContain('whether Hronaut connected')

    const items = form.body ?? []
    expect(items.filter((item) => item.id).map((item) => item.id)).toEqual([
      'client',
      'operating-system',
      'hronaut-version',
      'outcome',
      'experience',
      'improvement',
      'privacy'
    ])

    for (const id of ['client', 'operating-system', 'hronaut-version', 'outcome', 'experience']) {
      expect(items.find((item) => item.id === id)?.validations?.required, id).toBe(true)
    }

    expect(items.find((item) => item.id === 'client')?.attributes?.options).toEqual([
      ...AGENT_GUIDE_IDS.filter((id) => id !== 'generic').map((id) => AGENT_GUIDE_NAMES[id]),
      'Another MCP client'
    ])

    const privacy = items.find((item) => item.id === 'privacy')
    expect(privacy?.type).toBe('checkboxes')
    expect(privacy?.attributes?.options).toEqual([
      {
        label: 'I removed credentials, tokens, private URLs, page content, and personal browser-session data.',
        required: true
      }
    ])

    const introduction = items.find((item) => item.type === 'markdown')?.attributes?.value ?? ''
    for (const warning of ['public', 'credentials', 'MCP bearer tokens', 'private URLs', 'page content', 'personal data']) {
      expect(introduction, warning).toContain(warning)
    }
  })

  it('keeps public setup summaries aligned with every built-in named client', async () => {
    const [readme, reference] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('REFERENCE.md', 'utf8')
    ])
    const readmeStart = readme.indexOf('### Works with your coding agent')
    const readmeEnd = readme.indexOf('## When Hronaut is the right browser')
    const readmeClientDirectory = readme.slice(readmeStart, readmeEnd)
    const referenceHomeLine = reference.split('\n')
      .find((line) => line.startsWith('- Copy-ready setup instructions')) ?? ''

    expect(readmeStart).toBeGreaterThanOrEqual(0)
    expect(readmeEnd).toBeGreaterThan(readmeStart)
    expect(referenceHomeLine).not.toBe('')
    for (const id of AGENT_GUIDE_IDS) {
      if (id === 'generic') continue
      const name = AGENT_GUIDE_NAMES[id]
      expect(readmeClientDirectory, `README client directory: ${name}`).toContain(name)
      expect(referenceHomeLine, `REFERENCE Home summary: ${name}`).toContain(name)
    }
  })
})
