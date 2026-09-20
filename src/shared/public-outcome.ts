import type { BrowserObservationQualityResult } from './observation-quality.js'

export type WriterContextOutcome = 'writer_context_verified' | 'writer_context_not_verified' | 'unknown'
export type PublicObservationOutcome =
  | 'publicly_observed'
  | 'not_publicly_observed'
  | 'unknown'
  | 'reconciliation_required'

export interface PublicOutcomeAssessmentSummary {
  status: BrowserObservationQualityResult['status']
  evidenceClass: BrowserObservationQualityResult['evidenceClass']
  expectedEvidence: BrowserObservationQualityResult['expectedEvidence']
}

export function summarizePublicOutcomeAssessment(
  assessment: BrowserObservationQualityResult
): PublicOutcomeAssessmentSummary {
  return {
    status: assessment.status,
    evidenceClass: assessment.evidenceClass,
    expectedEvidence: structuredClone(assessment.expectedEvidence)
  }
}

export function classifyWriterContextOutcome(
  assessment: BrowserObservationQualityResult | null
): WriterContextOutcome {
  if (!assessment) return 'unknown'
  if (assessment.status === 'candidate' && assessment.expectedEvidence.matched === true) {
    return 'writer_context_verified'
  }
  if (
    assessment.status === 'empty_content'
    || assessment.status === 'soft_404'
    || (assessment.status === 'needs_review' && assessment.expectedEvidence.matched === false)
  ) return 'writer_context_not_verified'
  return 'unknown'
}

export function classifyPublicObservationOutcome(
  assessment: BrowserObservationQualityResult | null,
  contextStable = true
): PublicObservationOutcome {
  if (!contextStable || assessment?.status === 'wrong_origin') return 'reconciliation_required'
  if (!assessment) return 'unknown'
  if (assessment.status === 'candidate' && assessment.expectedEvidence.matched === true) {
    return 'publicly_observed'
  }
  if (
    assessment.status === 'empty_content'
    || assessment.status === 'soft_404'
    || (assessment.status === 'needs_review' && assessment.expectedEvidence.matched === false)
  ) return 'not_publicly_observed'
  return 'unknown'
}
