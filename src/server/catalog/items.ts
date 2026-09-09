import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  MediaValidationError,
  readMediaFile,
  saveMediaFile,
  validateOutgoing,
} from "@/server/whatsapp/media";
import { extractText } from "@/server/catalog/extract";
import { rm } from "node:fs/promises";
import { mediaFilePath } from "@/server/whatsapp/media";

export type CatalogItem = typeof schema.catalogItem.$inferSelect;

const ALLOWED = /^(application\/pdf|image\/(jpeg|png|webp))$/;

export function catalogKind(mime: string): "pdf" | "image" {
  return mime === "application/pdf" ? "pdf" : "image";
}

export async function listItems(organizationId: string): Promise<CatalogItem[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.catalogItem)
    .where(scoped(schema.catalogItem.organizationId, organizationId))
    .orderBy(asc(schema.catalogItem.position), asc(schema.catalogItem.createdAt));
}

export async function listActiveItems(organizationId: string): Promise<CatalogItem[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.catalogItem)
    .where(
      scoped(
        schema.catalogItem.organizationId,
        organizationId,
        eq(schema.catalogItem.active, true)
      )
    )
    .orderBy(asc(schema.catalogItem.position), asc(schema.catalogItem.createdAt));
}

/** Solo lo que es de la org Y está activo: lo que el modelo puede mandar. */
export async function getSendableItem(
  organizationId: string,
  itemId: string
): Promise<CatalogItem | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.catalogItem)
    .where(
      scoped(
        schema.catalogItem.organizationId,
        organizationId,
        and(eq(schema.catalogItem.id, itemId), eq(schema.catalogItem.active, true))
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function createItem(input: {
  organizationId: string;
  title: string;
  description?: string | null;
  price?: string | null;
  file: { data: Buffer; mimeType: string; fileName: string };
}): Promise<CatalogItem> {
  if (!ALLOWED.test(input.file.mimeType)) {
    throw new MediaValidationError(
      "unsupported_type",
      "Solo PDF o imágenes (jpeg, png, webp)"
    );
  }
  // Mismos límites que un envío: lo que no se puede mandar no se guarda.
  validateOutgoing(input.file.mimeType, input.file.data.byteLength);

  const id = newId("catalogItem");
  const storagePath = await saveMediaFile(input.organizationId, id, input.file.data);
  const extractedText = await extractText(input.file.data, input.file.mimeType);
  const db = getDb();
  const existing = await listItems(input.organizationId);
  const rows = await db
    .insert(schema.catalogItem)
    .values({
      id,
      organizationId: input.organizationId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      price: input.price?.trim() || null,
      kind: catalogKind(input.file.mimeType),
      mimeType: input.file.mimeType,
      fileName: input.file.fileName,
      fileSize: input.file.data.byteLength,
      storagePath,
      extractedText: extractedText || null,
      position: existing.length,
    })
    .returning();
  return rows[0]!;
}

export async function updateItem(
  organizationId: string,
  itemId: string,
  patch: { title?: string; description?: string | null; price?: string | null; active?: boolean }
): Promise<CatalogItem | null> {
  const db = getDb();
  const rows = await db
    .update(schema.catalogItem)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      scoped(
        schema.catalogItem.organizationId,
        organizationId,
        eq(schema.catalogItem.id, itemId)
      )
    )
    .returning();
  return rows[0] ?? null;
}

export async function deleteItem(organizationId: string, itemId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .delete(schema.catalogItem)
    .where(
      scoped(
        schema.catalogItem.organizationId,
        organizationId,
        eq(schema.catalogItem.id, itemId)
      )
    )
    .returning({ id: schema.catalogItem.id });
  if (rows.length === 0) return false;
  await rm(mediaFilePath(organizationId, itemId), { force: true }).catch(() => {});
  return true;
}

export async function readItemFile(item: CatalogItem): Promise<Buffer> {
  return readMediaFile(item.organizationId, item.id);
}
