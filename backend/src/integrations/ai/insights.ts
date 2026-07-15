import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { formatGBP } from '../../lib/money.js';
import type { SavingsSummary } from '../../modules/insights/savings-engine.js';

/**
 * AI savings insights.
 *
 * The savings *figures* are computed deterministically by the savings engine
 * (that's arithmetic — you never want an LLM doing the maths on someone's
 * money). Claude adds the layer on top: a plain-English summary of what the
 * numbers mean and personalised tips to save more.
 *
 * When ANTHROPIC_API_KEY is unset we return a solid rule-based narrative, so
 * the endpoint always works without a key.
 */

export interface SavingsInsight {
  headline: string;
  narrative: string;
  tips: string[];
  source: 'ai' | 'rules';
}

const anthropic = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;

export async function generateSavingsInsight(
  summary: SavingsSummary,
  context: { displayName: string; monthlyDrivePackage?: number | null },
): Promise<SavingsInsight> {
  if (!anthropic) return ruleBasedInsight(summary);

  const facts = {
    period: summary.period,
    total_saved: formatGBP(summary.totalSavedMinor),
    total_spent: formatGBP(summary.totalSpentMinor),
    total_litres: summary.totalLitres,
    purchases: summary.purchaseCount,
    projected_annual_saving: formatGBP(summary.projectedAnnualSavingMinor),
    trend: summary.series.map((s) => ({ bucket: s.bucket, saved: formatGBP(s.savedMinor) })),
  };

  const system =
    'You are MOTORIQ, a UK motoring savings assistant. Given a member\'s verified fuel-savings figures, ' +
    'write a short, warm, factual summary and 2–4 concrete money-saving tips. Use British English and £. ' +
    'Never invent numbers — only use the figures provided. Keep it concise.';

  const prompt =
    `Member: ${context.displayName}\n` +
    (context.monthlyDrivePackage ? `Drive package: ${context.monthlyDrivePackage} miles/month\n` : '') +
    `Verified savings figures (JSON):\n${JSON.stringify(facts, null, 2)}\n\n` +
    'Return a JSON object with exactly these keys: "headline" (string, <= 60 chars), ' +
    '"narrative" (2-3 sentences), "tips" (array of 2-4 short strings).';

  try {
    const res = await anthropic.messages.create({
      model: env.AI_INSIGHTS_MODEL,
      max_tokens: 700,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              headline: { type: 'string' },
              narrative: { type: 'string' },
              tips: { type: 'array', items: { type: 'string' } },
            },
            required: ['headline', 'narrative', 'tips'],
            additionalProperties: false,
          },
        },
      },
      system,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = res.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return ruleBasedInsight(summary);
    const parsed = JSON.parse(text.text) as Omit<SavingsInsight, 'source'>;
    return { ...parsed, source: 'ai' };
  } catch {
    // Any upstream/parse failure degrades gracefully to the rule-based path.
    return ruleBasedInsight(summary);
  }
}

function ruleBasedInsight(summary: SavingsSummary): SavingsInsight {
  const saved = formatGBP(summary.totalSavedMinor);
  const annual = formatGBP(summary.projectedAnnualSavingMinor);
  const period = summary.period === 'daily' ? 'the last 30 days' : summary.period === 'weekly' ? 'the last 12 weeks' : 'the last year';

  const tips: string[] = [];
  if (summary.purchaseCount === 0) {
    tips.push('Log your fill-ups in the app so MOTORIQ can track your savings.');
  } else {
    tips.push('Use the Fuel tab to find the cheapest station before you fill up.');
    tips.push('Fill up mid-week — prices often creep up before the weekend.');
  }
  if (summary.totalSavedMinor <= 0 && summary.purchaseCount > 0) {
    tips.push('You paid around the local average recently — switching stations could unlock savings.');
  }
  tips.push('Consider MOTORIQ Plus for cashback on top of your fuel savings.');

  return {
    headline:
      summary.totalSavedMinor > 0 ? `You've saved ${saved} on fuel` : 'Start saving on every fill-up',
    narrative:
      `Across ${period} you logged ${summary.purchaseCount} fuel purchase(s) totalling ` +
      `${formatGBP(summary.totalSpentMinor)}. Against the local average you saved ${saved}. ` +
      `At this rate that's about ${annual} a year with MOTORIQ.`,
    tips: tips.slice(0, 4),
    source: 'rules',
  };
}
