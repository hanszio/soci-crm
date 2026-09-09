import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { deleteItem, updateItem } from "@/server/catalog/items";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  price: z.string().trim().max(80).nullable().optional(),
  active: z.boolean().optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  if (session.role !== "owner" && session.role !== "admin") {
    return apiError(403, "forbidden", "Solo el propietario o un admin editan el catálogo");
  }
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const item = await updateItem(session.organizationId, id, body.data);
  if (!item) return apiError(404, "not_found", "Archivo no encontrado");
  return Response.json({ ok: true });
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  if (session.role !== "owner" && session.role !== "admin") {
    return apiError(403, "forbidden", "Solo el propietario o un admin editan el catálogo");
  }
  const { id } = await ctx.params;
  const ok = await deleteItem(session.organizationId, id);
  if (!ok) return apiError(404, "not_found", "Archivo no encontrado");
  return Response.json({ ok: true });
});
