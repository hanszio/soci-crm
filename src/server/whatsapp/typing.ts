import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import { graphRequest } from "@/lib/meta/client";

/**
 * Indicador "escribiendo…" + marcar leído el último inbound. Lo usan el
 * cerebro externo (`POST /api/bot/typing`) y la cola del agente incluido.
 *
 * Best-effort por contrato: si Meta falla se devuelve `ok:false` y la
 * conversación sigue. El indicador dura hasta ~25 s o hasta la respuesta.
 */
export async function sendTypingIndicator(
  organizationId: string,
  conversationId: string
): Promise<{ ok: boolean; reason?: string }> {
  const db = getDb();
  const convs = await db
    .select()
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  const conv = convs[0];
  if (!conv) return { ok: false, reason: "not_found" };
  // Sandbox: jamás toca la API real (guardrail del Laboratorio).
  if (conv.isTest) return { ok: false, reason: "sandbox" };
  // Handoff/IA pausada: un humano atiende — "escribiendo…" sería mentirle.
  if (!conv.aiEnabled || conv.handoffAt) return { ok: false, reason: "ai_paused" };
  if (conv.channel !== "whatsapp") return { ok: false, reason: "channel" };

  const msgs = await db
    .select({ waMessageId: schema.message.waMessageId })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.conversationId, conv.id),
        eq(schema.message.direction, "in"),
        isNotNull(schema.message.waMessageId)
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(1);
  const wamid = msgs[0]?.waMessageId;
  if (!wamid) return { ok: false, reason: "no_inbound" };

  const creds = await getCredentialsByOrg(organizationId);
  if (!creds) return { ok: false, reason: "no_connection" };

  try {
    await graphRequest(`${creds.phoneNumberId}/messages`, {
      method: "POST",
      token: creds.token,
      body: {
        messaging_product: "whatsapp",
        status: "read",
        message_id: wamid,
        typing_indicator: { type: "text" },
      },
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: "meta_error" };
  }
}
