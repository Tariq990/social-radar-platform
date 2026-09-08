import { GoogleGenAI } from '@google/genai';
import { DbPost, DbRule } from '../db/database';

export interface EvaluationResult {
  matched: boolean;
  confidence: number;
  category: string;
  reason: string;
  extracted: Record<string, any>;
  isFallback?: boolean;
}

let aiClient: GoogleGenAI | null = null;
function getAiClient(): GoogleGenAI | null {
  if (!aiClient && process.env.GEMINI_API_KEY) {
    aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return aiClient;
}

const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite'
];

/**
 * Evaluates whether a post matches a user watch rule.
 * 1. Cheap deterministic checks (include/exclude terms)
 * 2. Gemini semantic evaluation
 * 3. Strict structured validation
 */
export async function evaluatePostAgainstRule(
  post: DbPost,
  rule: DbRule,
  locale: 'en' | 'ar' = 'en'
): Promise<EvaluationResult> {
  const postText = (post.text || '').toLowerCase();

  // 1. Cheap Deterministic Exclude Terms Filter
  if (Array.isArray(rule.exclude_terms) && rule.exclude_terms.length > 0) {
    for (const term of rule.exclude_terms) {
      if (term.trim() && postText.includes(term.trim().toLowerCase())) {
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

  // 2. Cheap Deterministic Include Terms Check (if specified and missing)
  if (Array.isArray(rule.include_terms) && rule.include_terms.length > 0) {
    const hasAnyInclude = rule.include_terms.some(t => t.trim() && postText.includes(t.trim().toLowerCase()));
    if (!hasAnyInclude) {
      // If specific terms were mandated, we can skip expensive AI calls
      return {
        matched: false,
        confidence: 0.95,
        category: 'Keyword Mismatch',
        reason: `Post does not contain required keyword terms`,
        extracted: {}
      };
    }
  }

  // 3. Gemini Semantic Evaluation
  const ai = getAiClient();
  if (ai) {
    const prompt = `You are a precision social intelligence scanner for "MR SCRAP".
Your task is to analyze the following social post and decide if it strictly matches the user's intent.

User's Watch Rule:
"${rule.natural_language}"

Post Information:
- Platform: ${post.platform}
- Author: ${post.author_name || 'Author'}
- Published: ${post.published_at || 'Recent'}
- Content Text:
"""
${post.text}
"""

Evaluate carefully:
- Does this post genuinely fulfill what the user asked to be alerted about?
- Ignore generic marketing fluff, pleasantries, and spam.
- Assign a confidence score from 0.00 to 1.00.
- State a concise explanation (in ${locale === 'ar' ? 'Arabic' : 'English'}) explaining WHY it matched or didn't match.
- Extract any structured entities (e.g. price, discountPercentage, item, date, promoCode).

Return ONLY raw valid JSON (no markdown fences, no extra text) with this exact schema:
{
  "matched": boolean,
  "confidence": number,
  "category": string,
  "reason": string,
  "extracted": object
}`;

    for (const model of FALLBACK_MODELS) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.1
          }
        });

        const rawText = response.text?.trim() || '';
        const cleaned = rawText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
        const parsed = JSON.parse(cleaned);

        const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.85;
        const matched = Boolean(parsed.matched) && confidence >= (Number(rule.min_confidence) || 0.80);

        return {
          matched,
          confidence,
          category: parsed.category || 'Target Match',
          reason: parsed.reason || (matched ? 'Matched watch rule criteria' : 'Did not match rule criteria'),
          extracted: parsed.extracted && typeof parsed.extracted === 'object' ? parsed.extracted : {}
        };
      } catch (err) {
        console.warn(`[RuleEvaluator] Model ${model} evaluation failed:`, (err as any)?.message);
        // Try next fallback model
      }
    }
  }

  // 4. Deterministic Fallback if Gemini is not configured or all models were temporarily unavailable
  return evaluateDeterministicFallback(post, rule, locale);
}

function evaluateDeterministicFallback(
  post: DbPost,
  rule: DbRule,
  locale: 'en' | 'ar'
): EvaluationResult {
  const text = (post.text || '').toLowerCase();
  const ruleNL = (rule.natural_language || '').toLowerCase();

  // Extract keywords from rule
  const keywords = ruleNL
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !['when', 'they', 'post', 'about', 'notify', 'alert', 'tell'].includes(w));

  const matchedKeywords = keywords.filter(kw => text.includes(kw));
  const hasDiscountSignal = text.includes('%') || text.includes('off') || text.includes('discount') || text.includes('sale') || text.includes('خصم') || text.includes('عرض');
  const ruleWantsDiscount = ruleNL.includes('discount') || ruleNL.includes('sale') || ruleNL.includes('off') || ruleNL.includes('خصم') || ruleNL.includes('تخفيض');

  let matched = false;
  let confidence = 0.50;

  if (ruleWantsDiscount && hasDiscountSignal) {
    matched = true;
    confidence = 0.88;
  } else if (keywords.length > 0 && matchedKeywords.length >= Math.ceil(keywords.length * 0.6)) {
    matched = true;
    confidence = 0.84;
  }

  return {
    matched,
    confidence,
    category: matched ? 'Keyword Match' : 'No Match',
    reason: matched
      ? (locale === 'ar' ? `تطابق الكلمات الرئيسية: ${matchedKeywords.join(', ') || 'عرض ترويجي'}` : `Matched keywords: ${matchedKeywords.join(', ') || 'promotion'}`)
      : (locale === 'ar' ? 'لم يتطابق المحتوى مع معايير القاعدة' : 'Post content did not meet rule criteria'),
    extracted: { fallback: true },
    isFallback: true
  };
}
