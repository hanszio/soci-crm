import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { deleteVariant, updateVariant } from "@/server/replies/bank";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  text: z.string().trim().min(2).max(500).optional(),
  active: z.boolean().optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  if (session.role !== "owner" && session.role !== "admin") {
    return apiError(403, "forbidden", "Solo el propietario o un admin editan las respuestas");
  }
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const ok = await updateVariant(session.organizationId, id, body.data);
  return ok ? Response.json({ ok: true }) : apiError(404, "not_found", "Variante no encontrada");
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  if (session.role !== "owner" && session.role !== "admin") {
    return apiError(403, "forbidden", "Solo el propietario o un admin editan las respuestas");
  }
  const { id } = await ctx.params;
  const ok = await deleteVariant(session.organizationId, id);
  return ok ? Response.json({ ok: true }) : apiError(404, "not_found", "Variante no encontrada");
});
