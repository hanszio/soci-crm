import { apiError, withAuth } from "@/lib/api";
import { createItem, listItems } from "@/server/catalog/items";
import { MediaValidationError } from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

function serialize(it: Awaited<ReturnType<typeof listItems>>[number]) {
  return {
    id: it.id,
    title: it.title,
    description: it.description,
    price: it.price,
    kind: it.kind,
    mimeType: it.mimeType,
    fileName: it.fileName,
    fileSize: it.fileSize,
    active: it.active,
    hasText: Boolean(it.extractedText),
    textChars: it.extractedText?.length ?? 0,
    createdAt: it.createdAt,
  };
}

export const GET = withAuth(async (session) => {
  const items = await listItems(session.organizationId);
  return Response.json({ items: items.map(serialize) });
});

/**
 * T5.1 — Subir un archivo al catálogo (multipart): `file` + `title` +
 * `description?` + `price?`. Solo owner/admin: es lo que el bot le manda a
 * los clientes.
 */
export const POST = withAuth(async (session, req: Request) => {
  if (session.role !== "owner" && session.role !== "admin") {
    return apiError(403, "forbidden", "Solo el propietario o un admin editan el catálogo");
  }
  const form = await req.formData().catch(() => null);
  if (!form) return apiError(400, "invalid", "Se esperaba multipart/form-data");
  const file = form.get("file");
  if (!(file instanceof File)) return apiError(422, "invalid", "Falta el archivo (campo `file`)");
  const title = String(form.get("title") ?? "").trim();
  if (!title) return apiError(422, "invalid", "Falta el título");
  const description = String(form.get("description") ?? "").trim() || null;
  const price = String(form.get("price") ?? "").trim() || null;

  try {
    const item = await createItem({
      organizationId: session.organizationId,
      title: title.slice(0, 120),
      description: description?.slice(0, 500) ?? null,
      price: price?.slice(0, 80) ?? null,
      file: {
        data: Buffer.from(await file.arrayBuffer()),
        mimeType: file.type || "application/octet-stream",
        fileName: (file.name || "archivo").slice(0, 120),
      },
    });
    return Response.json({ item: serialize(item) }, { status: 201 });
  } catch (err) {
    if (err instanceof MediaValidationError) {
      return apiError(err.code === "too_large" ? 413 : 415, err.code, err.message);
    }
    throw err;
  }
});
