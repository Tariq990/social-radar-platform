import { DbPost, DbRule } from '../db/database';
import { aiService } from './aiService';
import { RuleMatchResult } from './types';

export interface EvaluationResult extends RuleMatchResult {
  isFallback?: boolean;
}

/**
 * Production rule evaluation pipeline:
 * 1. Deterministic negative filters to avoid unnecessary AI calls.
 * 2. Provider-neutral semantic classification through the operator-configured AI backend.
 * 3. Apply the rule confidence threshold after schema validation.
 *
 * Important: production never turns an AI/provider error into a fabricated positive match.
 */
export async function evaluatePostAgainstRule(
  post: DbPost,
  rule: DbRule,
  locale: 'en' | 'ar' = 'en'
): Promise<EvaluationResult> {
  const postText = (post.text || '').toLowerCase();

  if (Array.isArray(rule.exclude_terms) && rule.exclude_terms.length > 0) {
    for (const term of rule.exclude_terms) {
      const normalized = String(term || '').trim().toLowerCase();
      if (normalized && postText.includes(normalized)) {
        return {
          matched: false,
          confidence: 0.99,
          category: 'Excluded',
          reason: `Post contains excluded term: "${term}"`,
          extracted: {}
        };
      }
    }
  }

  if (Array.isArray(rule.include_terms) && rule.include_terms.length > 0) {
    const hasAnyInclude = rule.include_terms.some(term => {
      const normalized = String(term || '').trim().toLowerCase();
      return normalized.length > 0 && postText.includes(normalized);
    });

    if (!hasAnyInclude) {
      return {
        matched: false,
        confidence: 0.99,
        category: 'Keyword Mismatch',
        reason: 'Post does not contain any required include terms',
        extracted: {}
      };
    }
  }

  const result = await aiService.classifyPost(post, rule, locale);
  const configuredThreshold = Number(rule.min_confidence);
  const threshold = Number.isFinite(configuredThreshold)
    ? Math.max(0, Math.min(1, configuredThreshold))
    : 0.8;

  return {
    ...result,
    matched: result.matched && result.confidence >= threshold,
    reason:
      result.matched && result.confidence < threshold
        ? `AI relevance confidence ${result.confidence.toFixed(2)} is below the rule threshold ${threshold.toFixed(2)}. ${result.reason}`
        : result.reason,
    isFallback: false
  };
}
