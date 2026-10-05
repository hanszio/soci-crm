import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { addVariants } from "@/server/replies/bank";

export const dynamic = "force-dynamic";

const schema = z.object({
  source: z.enum(["owner", "mined", "ai"]).default("mined"),
  variants: z
    .array(z.object({ key: z.string().min(1), text: z.string().min(2).max(500) }))
    .min(1)
    .max(500),
});

/**
 * Carga masiva de variantes — lo que produce `scripts/wa-mine.mjs` al minar
 * chats reales exportados de WhatsApp. Duplicados y claves desconocidas se
 * saltan, no fallan.
 */
export const POST = withAuth(async (session, req: Request) => {
  if (session.role !== "owner" && session.role !== "admin") {
    return apiError(403, "forbidden", "Solo el propietario o un admin editan las respuestas");
  }
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const res = await addVariants(session.organizationId, body.data.variants, body.data.source ?? "mined");
  return Response.json(res, { status: 201 });
});
