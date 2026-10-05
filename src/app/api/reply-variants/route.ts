import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { addVariants, listVariants } from "@/server/replies/bank";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { defaultVariants, REPLY_KEYS, REPLY_KEY_META } from "@/server/replies/keys";

export const dynamic = "force-dynamic";

/** Banco de respuestas del negocio, agrupado por clave, con las de fábrica al lado. */
export const GET = withAuth(async (session) => {
  const rows = await listVariants(session.organizationId);
  const profile = await getDb()
    .select({ formality: schema.agentProfile.formality })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, session.organizationId))
    .limit(1);
  const defaults = defaultVariants(profile[0]?.formality ?? "usted");
  return Response.json({
    keys: REPLY_KEYS.map((key) => ({
      key,
      ...REPLY_KEY_META[key],
      defaults: defaults[key],
      variants: rows
        .filter((r) => r.key === key)
        .map((r) => ({ id: r.id, text: r.text, source: r.source, active: r.active })),
    })),
  });
});

const postSchema = z.object({
  key: z.enum(REPLY_KEYS),
  text: z.string().trim().min(2).max(500),
});

export const POST = withAuth(async (session, req: Request) => {
  if (session.role !== "owner" && session.role !== "admin") {
    return apiError(403, "forbidden", "Solo el propietario o un admin editan las respuestas");
  }
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;
  const res = await addVariants(session.organizationId, [body.data], "owner");
  if (res.added === 0) return apiError(409, "duplicate", "Esa variante ya existe");
  return Response.json({ ok: true }, { status: 201 });
});
