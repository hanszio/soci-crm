import { eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { readItemFile } from "@/server/catalog/items";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Descarga para el operador (ver lo que el bot manda). */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.catalogItem)
    .where(scoped(schema.catalogItem.organizationId, session.organizationId, eq(schema.catalogItem.id, id)))
    .limit(1);
  const item = rows[0];
  if (!item) return apiError(404, "not_found", "Archivo no encontrado");
  const data = await readItemFile(item);
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": item.mimeType,
      "content-disposition": `inline; filename="${encodeURIComponent(item.fileName)}"`,
      "cache-control": "private, max-age=0",
    },
  });
});
