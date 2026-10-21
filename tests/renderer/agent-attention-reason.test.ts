import { describe, expect, it } from 'vitest'
import { attentionReasonText } from '../../src/renderer/src/composables/agent-attention-reason.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { humanDecisionAttentionReason, type HumanWaitingDecision } from '../../src/shared/human-waiting.js'
import { SUPPORTED_LOCALES } from '../../src/shared/locale.js'

const DECISIONS: HumanWaitingDecision[] = ['review-page', 'approve-action', 'provide-input', 'resolve-unknown']

describe('why an agent needs you', () => {
  it('keeps the English line a decision raises for MCP results and the tray', () => {
    expect(humanDecisionAttentionReason('approve-action')).toBe('Human decision required: approve-action')
  })

  it('names each decision in every language and shows anything else as written', () => {
    // Tooltips read "Human decision required: approve-action" in every language.
    for (const locale of SUPPORTED_LOCALES) {
      const i18n = createHronautI18n(locale).global
      const t = i18n.t as (key: string) => string
      for (const decision of DECISIONS) {
        const key = `shell.agentCard.decisionReasons.${decision}`
        expect(i18n.te(key)).toBe(true)
        expect(attentionReasonText(t, humanDecisionAttentionReason(decision), true)).toBe(t(key))
      }
    }
    const t = createHronautI18n('de-DE').global.t as (key: string) => string
    expect(attentionReasonText(t, 'Human decision required: approve-action', true)).toBe('Der Agent möchte Ihre Genehmigung, bevor er handelt.')
    // An agent's own request keeps its words, even when they read like a decision's line.
    expect(attentionReasonText(t, 'Human decision required: approve-action', false)).toBe('Human decision required: approve-action')
    expect(attentionReasonText(t, 'Log in, then hand back.', false)).toBe('Log in, then hand back.')
    expect(attentionReasonText(t, 'Human decision required: future-kind', true)).toBe('Human decision required: future-kind')
    expect(attentionReasonText(t, 'Human decision required: constructor', true)).toBe('Human decision required: constructor')
  })
})
