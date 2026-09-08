import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { sendTypingIndicator } from "@/server/whatsapp/typing";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ conversationId: z.string().min(1) });

/**
 * Indicador "escribiendo…" + marcar leído el último inbound.
 * POST /api/bot/typing {conversationId}
 *
 * Best-effort por contrato: al bot JAMÁS le vale reintentar esto — si Meta
 * falla se responde 200 {ok:false} y la conversación sigue.
 */
export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const result = await sendTypingIndicator(organizationId, body.data.conversationId);
  if (result.reason === "not_found") {
    return apiError(404, "not_found", "Conversación no encontrada");
  }
  if (result.reason === "no_connection") {
    return apiError(409, "no_connection", "WhatsApp no está conectado");
  }
  return Response.json(result);
}
