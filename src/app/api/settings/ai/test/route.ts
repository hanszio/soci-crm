import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { chatText, humanizeProviderError } from "@/lib/ai";
import { AI_PROVIDERS } from "@/lib/ai/providers";
import { specFromOverride } from "@/lib/ai/registry";
import { getStoredApiKey } from "@/server/ai-settings/store";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  apiKey: z.string().trim().min(8).max(500).optional(),
  baseUrl: z.string().trim().url().max(300).nullable().optional(),
  model: z.string().trim().min(1).max(120),
});

/** Prueba de conexión: una llamada mínima al proveedor. NO guarda. */
export const POST = withAuth(async (session, req: Request) => {
  if (session.role !== "owner" && session.role !== "admin") {
    return apiError(403, "forbidden", "Solo el dueño o un administrador");
  }
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const d = body.data;
  if (d.provider === "compat" && !d.baseUrl) {
    return apiError(422, "invalid_body", "El proveedor compatible necesita una URL base");
  }
  const apiKey = d.apiKey ?? (await getStoredApiKey(session.organizationId));
  if (!apiKey) return apiError(422, "invalid_body", "Falta la clave del proveedor");

  const spec = specFromOverride({ provider: d.provider, apiKey, baseUrl: d.baseUrl ?? null, model: d.model });
  const probe = await chatText([{ role: "user", content: "Responde únicamente con la palabra: ok" }], {
    spec,
    organizationId: session.organizationId,
    kind: "text",
    maxOutputTokens: 400,
    timeoutMs: 45_000,
  });
  if (!probe.ok) return apiError(422, "provider_rejected", humanizeProviderError(probe.detail));
  return Response.json({ ok: true, latencyMs: probe.latencyMs, model: probe.model });
});
