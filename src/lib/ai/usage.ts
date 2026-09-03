import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

export type UsageKind = "chat" | "judge" | "gate" | "embed" | "text";

/** Registra una llamada al proveedor. Nunca lanza: medir no puede tumbar un turno. */
export async function recordUsage(input: {
  organizationId?: string | null;
  model: string;
  kind: UsageKind;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs: number;
  ok: boolean;
  error?: string | null;
}): Promise<void> {
  try {
    const db = getDb();
    await db.insert(schema.usageEvent).values({
      id: newId("usageEvent"),
      organizationId: input.organizationId ?? null,
      model: input.model,
      kind: input.kind,
      tokensIn: input.tokensIn ?? 0,
      tokensOut: input.tokensOut ?? 0,
      latencyMs: Math.max(0, Math.round(input.latencyMs)),
      ok: input.ok,
      error: input.error ? input.error.slice(0, 500) : null,
    });
  } catch (err) {
    console.error("[ai-usage] no se pudo registrar el uso:", err);
  }
}

/** Tokens consumidos por una organización en un mes (YYYY-MM). */
export async function monthlyUsage(
  organizationId: string,
  month: string
): Promise<{ tokensIn: number; tokensOut: number; calls: number; failed: number }> {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) throw new Error("month debe ser YYYY-MM");
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  const db = getDb();
  const rows = await db
    .select({
      tokensIn: sql<number>`coalesce(sum(${schema.usageEvent.tokensIn}), 0)`,
      tokensOut: sql<number>`coalesce(sum(${schema.usageEvent.tokensOut}), 0)`,
      calls: sql<number>`count(*)`,
      failed: sql<number>`count(*) filter (where ${schema.usageEvent.ok} = false)`,
    })
    .from(schema.usageEvent)
    .where(
      and(
        eq(schema.usageEvent.organizationId, organizationId),
        gte(schema.usageEvent.createdAt, from),
        lt(schema.usageEvent.createdAt, to)
      )
    );
  const r = rows[0];
  return {
    tokensIn: Number(r?.tokensIn ?? 0),
    tokensOut: Number(r?.tokensOut ?? 0),
    calls: Number(r?.calls ?? 0),
    failed: Number(r?.failed ?? 0),
  };
}
