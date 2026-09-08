import { DbPost, DbRule } from '../db/database';
import { aiService } from './aiService';
import { RuleMatchResult } from './types';

export interface EvaluationResult extends RuleMatchResult {
  isFallback?: boolean;
}

function normalizeIntent(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isLatestPostIntent(value: string): boolean {
  const text = normalizeIntent(value || '');
  if (!text) return false;

  const english = [
    /\b(?:latest|newest)\s+(?:post|update)\b/,
    /\b(?:every|each|any)\s+new\s+(?:post|update)\b/,
    /\bnotify\s+me\s+(?:about\s+)?(?:the\s+)?(?:latest|newest)\s+(?:post|update)\b/,
    /\balert\s+me\s+(?:about\s+)?(?:the\s+)?(?:latest|newest)\s+(?:post|update)\b/
  ];
  if (english.some(pattern => pattern.test(text))) return true;

  return /(?:اخر|آخر|احدث|أحدث)\s+(?:بوست|منشور)/.test(text) ||
    /(?:كل|اي|أي)\s+(?:بوست|منشور)\s+جديد/.test(text) ||
    /(?:نبهني|نبّهني|اخبرني|أخبرني).*?(?:بوست|منشور).*?(?:جديد|نزل)/.test(text);
}

/**
 * Production rule evaluation pipeline:
 * 1. Deterministic intent/negative filters to avoid unnecessary AI calls.
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

  // "Latest/new post" is a transport intent, not a semantic-content filter. Device ingestion
  // marks exactly one non-pinned item from the current feed snapshot as latestCandidate. This is
  // more reliable than assuming feedIndex=0 because Meta can place pinned posts above the newest
  // chronological post. Older APKs may not send latestCandidate, so retain a conservative fallback.
  if (isLatestPostIntent(rule.natural_language || '')) {
    const metadata = post.metadata && typeof post.metadata === 'object' ? post.metadata as Record<string, unknown> : {};
    const pinned = metadata.pinned === true;
    const latestCandidate = metadata.latestCandidate;
    const feedIndex = Number(metadata.feedIndex);

    if (pinned || latestCandidate === false || (latestCandidate === undefined && Number.isFinite(feedIndex) && feedIndex > 0)) {
      return {
        matched: false,
        confidence: 1,
        category: 'New Post',
        reason: locale === 'ar'
          ? 'تم تجاهل هذا العنصر لأنه ليس أحدث منشور فعلي غير مثبت في ترتيب الصفحة.'
          : 'Ignored because this item is not the newest real non-pinned post in the page order.',
        extracted: {}
      };
    }

    return {
      matched: true,
      confidence: 1,
      category: 'New Post',
      reason: locale === 'ar'
        ? 'هذا هو أحدث منشور فعلي غير مثبت تم التقاطه من المصدر.'
        : 'This is the newest real non-pinned post collected from the source.',
      extracted: {}
    };
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
