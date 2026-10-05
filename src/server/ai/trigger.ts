import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { enqueue } from "@/server/jobs/queue";
import { kick } from "@/server/jobs/poller";
import { computeDelaySec, typingLeadSec } from "@/server/jobs/delay";
import { jevEnabled } from "@/server/jev/flag";

/**
 * Punto de enganche tras la ingesta de un mensaje entrante REAL: calcula el
 * retraso humano y deja el turno (y el "escribiendo…") en la cola persistente.
 * Las conversaciones del Laboratorio invocan el pipeline directamente.
 */
export async function maybeRunAgentTurn(conversationId: string): Promise<void> {
  const db = getDb();
  const convRows = await db
    .select({
      organizationId: schema.conversation.organizationId,
      aiEnabled: schema.conversation.aiEnabled,
      handoffAt: schema.conversation.handoffAt,
      handoffReason: schema.conversation.handoffReason,
      isTest: schema.conversation.isTest,
    })
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const conv = convRows[0];
  // El turno vuelve a comprobar todo esto; aquí solo se evita encolar basura.
  if (!conv || conv.isTest || !conv.aiEnabled) return;
  // Con handoff no hay turno, salvo la cortesía tras agendar (ver pipeline).
  if (conv.handoffAt && !(conv.handoffReason === "cita_agendada" && jevEnabled())) return;

  const profileRows = await db
    .select({
      enabled: schema.agentProfile.enabled,
      delayMinSec: schema.agentProfile.delayMinSec,
      delayMaxSec: schema.agentProfile.delayMaxSec,
    })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, conv.organizationId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile?.enabled) return;

  const lastRows = await db
    .select({ text: schema.message.text })
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(desc(schema.message.createdAt))
    .limit(1);

  const delaySec = computeDelaySec({
    text: lastRows[0]?.text ?? "",
    minSec: profile.delayMinSec,
    maxSec: profile.delayMaxSec,
    mode: getEnv().AGENT_DELAY_MODE,
  });
  const now = Date.now();
  await enqueue({
    organizationId: conv.organizationId,
    kind: "agent_turn",
    conversationId,
    runAt: new Date(now + delaySec * 1000),
  });
  const lead = typingLeadSec(delaySec);
  if (lead > 0) {
    await enqueue({
      organizationId: conv.organizationId,
      kind: "agent_typing",
      conversationId,
      runAt: new Date(now + (delaySec - lead) * 1000),
    });
  }
  if (delaySec === 0) kick();
  else console.log(`[jobs] agent_turn ${conversationId} en ${delaySec}s`);
}
