import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { chatText, humanizeProviderError } from "@/lib/ai";
import { AI_PROVIDERS, PROVIDER_INFO } from "@/lib/ai/providers";
import { specFromOverride } from "@/lib/ai/registry";
import { isAiConfigured } from "@/lib/env";
import {
  deleteAiSettings,
  getAiSettingsPublic,
  getStoredApiKey,
  saveAiSettings,
} from "@/server/ai-settings/store";

export const dynamic = "force-dynamic";

function canManage(role: string): boolean {
  return role === "owner" || role === "admin";
}

/** Estado actual: configuración propia (sin clave) o "plataforma". */
export const GET = withAuth(async (session) => {
  if (!canManage(session.role)) return apiError(403, "forbidden", "Solo el dueño o un administrador");
  const settings = await getAiSettingsPublic(session.organizationId);
  return Response.json({
    settings,
    platformConfigured: isAiConfigured(),
    providers: PROVIDER_INFO,
  });
});

const putSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  // Opcional: si falta, se conserva la clave guardada (permite cambiar solo el modelo).
  apiKey: z.string().trim().min(8).max(500).optional(),
  baseUrl: z.string().trim().url().max(300).nullable().optional(),
  model: z.string().trim().min(1).max(120),
  judgeModel: z.string().trim().max(120).nullable().optional(),
});

/** Guarda: prueba contra el proveedor ANTES de cifrar y persistir. */
export const PUT = withAuth(async (session, req: Request) => {
  if (!canManage(session.role)) return apiError(403, "forbidden", "Solo el dueño o un administrador");
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;
  const d = body.data;

  if (d.provider === "compat" && !d.baseUrl) {
    return apiError(422, "invalid_body", "El proveedor compatible necesita una URL base");
  }
  const apiKey = d.apiKey ?? (await getStoredApiKey(session.organizationId));
  if (!apiKey) return apiError(422, "invalid_body", "Falta la clave del proveedor");

  const spec = specFromOverride({ provider: d.provider, apiKey, baseUrl: d.baseUrl ?? null, model: d.model });
  const probe = await chatText([{ role: "user", content: "Responde solo con: ok" }], {
    spec,
    organizationId: session.organizationId,
    kind: "text",
    maxOutputTokens: 20,
    timeoutMs: 20_000,
  });
  if (!probe.ok) {
    return apiError(422, "provider_rejected", humanizeProviderError(probe.detail));
  }

  await saveAiSettings({
    organizationId: session.organizationId,
    provider: d.provider,
    apiKey,
    baseUrl: d.provider === "compat" || d.provider === "openrouter" ? (d.baseUrl ?? null) : null,
    model: d.model,
    judgeModel: d.judgeModel?.trim() ? d.judgeModel.trim() : null,
    updatedBy: session.userId,
  });
  const settings = await getAiSettingsPublic(session.organizationId);
  return Response.json({ ok: true, settings, latencyMs: probe.latencyMs });
});

/** Vuelve a la configuración de la plataforma. */
export const DELETE = withAuth(async (session) => {
  if (!canManage(session.role)) return apiError(403, "forbidden", "Solo el dueño o un administrador");
  await deleteAiSettings(session.organizationId);
  return Response.json({ ok: true, platformConfigured: isAiConfigured() });
});
