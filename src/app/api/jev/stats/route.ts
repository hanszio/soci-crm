import { and, gte, sql } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { jevEnabled } from "@/server/jev/flag";

export const dynamic = "force-dynamic";

/**
 * Qué decidió Jev en los últimos 7 días: cuántos turnos salieron por el carril
 * directo y, en modo observar, qué hizo el LLM en los turnos donde Jev habría
 * respondido solo. Es el dato para decidir cuándo pasar de `shadow` a `on`.
 */
export const GET = withAuth(async (session) => {
  if (!jevEnabled()) return new Response(null, { status: 404 });
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const rows = await getDb()
    .select({
      plan: schema.turnDecision.plan,
      applied: schema.turnDecision.applied,
      llmAction: schema.turnDecision.llmAction,
      n: sql<number>`count(*)::int`,
      latency: sql<number>`coalesce(avg(${schema.turnDecision.latencyMs}), 0)::int`,
    })
    .from(schema.turnDecision)
    .where(
      scoped(
        schema.turnDecision.organizationId,
        session.organizationId,
        and(gte(schema.turnDecision.createdAt, since))
      )
    )
    .groupBy(schema.turnDecision.plan, schema.turnDecision.applied, schema.turnDecision.llmAction);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const applied = rows.filter((r) => r.applied).reduce((a, r) => a + r.n, 0);
  const wouldBeDirect = rows.filter((r) => r.plan !== "llm").reduce((a, r) => a + r.n, 0);
  return Response.json({
    days: 7,
    total,
    applied,
    wouldBeDirect,
    avgLatencyMs: total ? Math.round(rows.reduce((a, r) => a + r.latency * r.n, 0) / total) : 0,
    rows: rows.map((r) => ({ plan: r.plan, applied: r.applied, llmAction: r.llmAction, n: r.n })),
  });
});
