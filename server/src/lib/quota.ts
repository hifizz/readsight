import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export type UsageMetric = 'chat_requests' | 'translation_characters' | 'lookup_requests';

const LIMITS: Record<UsageMetric, number> = {
  chat_requests: Number(process.env.DAILY_CHAT_REQUESTS ?? 50),
  translation_characters: Number(process.env.DAILY_TRANSLATION_CHARACTERS ?? 200_000),
  lookup_requests: Number(process.env.DAILY_LOOKUP_REQUESTS ?? 500),
};

export type QuotaResult =
  | { allowed: true; used: number; limit: number }
  | { allowed: false; used: number; limit: number; resetAt: string };

function nextUtcMidnight(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

export async function reserveUsage(
  userId: string,
  metric: UsageMetric,
  amount = 1,
): Promise<QuotaResult> {
  const limit = LIMITS[metric];
  if (!Number.isFinite(amount) || amount < 0) throw new Error('invalid_usage_amount');
  if (amount > limit) return { allowed: false, used: 0, limit, resetAt: nextUtcMidnight() };

  const result = await db.execute(sql`
    INSERT INTO readsight.daily_usage (user_id, usage_date, metric, amount, updated_at)
    VALUES (${userId}, CURRENT_DATE, ${metric}, ${amount}, now())
    ON CONFLICT (user_id, usage_date, metric)
    DO UPDATE SET
      amount = readsight.daily_usage.amount + EXCLUDED.amount,
      updated_at = now()
    WHERE readsight.daily_usage.amount + EXCLUDED.amount <= ${limit}
    RETURNING amount
  `);
  const row = result[0] as { amount: number } | undefined;
  if (row) return { allowed: true, used: Number(row.amount), limit };

  const current = await db.execute(sql`
    SELECT amount FROM readsight.daily_usage
    WHERE user_id = ${userId} AND usage_date = CURRENT_DATE AND metric = ${metric}
  `);
  const used = Number((current[0] as { amount?: number } | undefined)?.amount ?? 0);
  return { allowed: false, used, limit, resetAt: nextUtcMidnight() };
}

export function quotaExceededResponse(result: Extract<QuotaResult, { allowed: false }>): Response {
  return Response.json(
    {
      error: 'daily_quota_exceeded',
      used: result.used,
      limit: result.limit,
      resetAt: result.resetAt,
    },
    { status: 429 },
  );
}
