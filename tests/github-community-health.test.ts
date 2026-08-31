import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

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

describe('GitHub community health', () => {
  it('offers a privacy-safe general bug report independently of setup feedback', async () => {
    const [bugReportSource, setupFeedbackSource] = await Promise.all([
      readFile('.github/ISSUE_TEMPLATE/bug-report.yml', 'utf8'),
      readFile('.github/ISSUE_TEMPLATE/setup-feedback.yml', 'utf8')
    ])
    const bugReport = parse(bugReportSource) as IssueForm
    const setupFeedback = parse(setupFeedbackSource) as IssueForm

    expect(bugReport.name).toBe('Bug report')
    expect(bugReport.description).toContain('reproducible, non-sensitive')
    expect(setupFeedback.name).toBe('Setup feedback')

    const items = bugReport.body ?? []
    for (const id of [
      'hronaut-version',
      'operating-system',
      'installation-package',
      'affected-area',
      'reproduction',
      'expected',
      'actual'
    ]) {
      expect(items.find((item) => item.id === id)?.validations?.required, id).toBe(true)
    }
    expect(items.find((item) => item.id === 'sanitized-diagnostics')?.validations?.required).not.toBe(true)

    const introduction = items.find((item) => item.type === 'markdown')?.attributes?.value ?? ''
    expect(introduction).toContain('https://github.com/hronaut/hronaut/security/advisories/new')
    for (const warning of [
      'credentials',
      'MCP bearer tokens',
      'private URLs',
      'page content',
      'wallet material',
      'personal data',
      'raw browser-session logs'
    ]) {
      expect(introduction, warning).toContain(warning)
    }

    expect(items.find((item) => item.id === 'privacy')?.attributes?.options).toEqual([
      {
        label: 'I removed credentials, MCP tokens, private URLs, page content, wallet material, personal data, and raw browser-session logs.',
        required: true
      }
    ])
  })
})
