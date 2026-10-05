import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { systemOne } from "@/lib/typesafe";
import { buildJevRequest, type JevContext } from "@/server/jev/questions";
import { routeTurn, type Plan } from "@/server/jev/route";

/**
 * Un turno visto por Jev: arma el request, lo manda, aplica la política y deja
 * registro en `turn_decision`. Devuelve null si Jev no respondió — el turno
 * sigue entonces por el LLM, como siempre.
 *
 * El registro existe en los dos modos (`shadow` y `on`): es lo que permite
 * comparar a Jev contra el LLM antes de dejarlo responder, y después auditar
 * por qué contestó lo que contestó.
 */
export async function decideTurn(input: {
  organizationId: string;
  conversationId: string;
  context: JevContext;
  agenda: boolean;
  lastOutIsQuestion: boolean;
  sentItemIds: string[];
}): Promise<{ plan: Plan; decisionId: string | null } | null> {
  const { state, questions, maps } = buildJevRequest(input.context);
  const res = await systemOne({ state, questions, organizationId: input.organizationId });
  if (!res.ok) {
    if (res.error !== "not_configured") console.warn(`[jev] sin respuesta (${res.error}); sigue el LLM`);
    return null;
  }
  const plan = routeTurn(res.answers, {
    agenda: input.agenda,
    lastOutIsQuestion: input.lastOutIsQuestion,
    modalities: input.context.modalities,
    sentItemIds: input.sentItemIds,
    maps,
  });

  let decisionId: string | null = null;
  try {
    decisionId = newId("turnDecision");
    await getDb()
      .insert(schema.turnDecision)
      .values({
        id: decisionId,
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        plan: plan.type,
        detail: plan.type === "llm" ? plan.reason : plan.type === "bank" ? plan.key : null,
        answers: res.answers,
        latencyMs: Math.round(res.latencyMs),
        model: res.model,
      });
  } catch (err) {
    decisionId = null;
    console.warn(`[jev] no pude registrar la decisión: ${err}`);
  }
  return { plan, decisionId };
}

export async function markDecision(
  decisionId: string | null,
  patch: { applied?: boolean; llmAction?: string }
): Promise<void> {
  if (!decisionId) return;
  await getDb()
    .update(schema.turnDecision)
    .set(patch)
    .where(eq(schema.turnDecision.id, decisionId))
    .catch(() => undefined);
}
