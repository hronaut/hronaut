import { humanDecisionFromAttentionReason } from '../../../shared/human-waiting.js'

type Translate = (key: string) => string

/**
 * Why an agent needs you, for tooltips and the agent card. A decision's request carries Hronaut's English line
 * (humanDecisionAttentionReason), which reads here in the interface language; an agent's own words show as written.
 */
export function attentionReasonText(t: Translate, reason: string, decision: boolean): string {
  const kind = decision ? humanDecisionFromAttentionReason(reason) : undefined
  return kind ? t(`shell.agentCard.decisionReasons.${kind}`) : reason
}
