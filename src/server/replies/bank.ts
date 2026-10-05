import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { DEFAULT_VARIANTS, isReplyKey, type ReplyKey } from "@/server/replies/keys";

export type ReplyVariant = typeof schema.replyVariant.$inferSelect;
export type Slots = { agente?: string; negocio?: string };

export function renderVariant(text: string, slots: Slots): string {
  return text
    .replace(/\{agente\}/g, slots.agente ?? "")
    .replace(/\{negocio\}/g, slots.negocio ?? "el negocio")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Elige una variante que NO se haya usado ya en la conversación. Si todas se
 * usaron, cualquiera: repetir es mejor que callar. Pura, con rng inyectable.
 */
export function chooseVariant(
  candidates: string[],
  usedTexts: string[],
  rng: () => number = Math.random
): string | null {
  if (candidates.length === 0) return null;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const used = usedTexts.map(norm);
  const fresh = candidates.filter((c) => !used.some((u) => u.includes(norm(c))));
  const pool = fresh.length > 0 ? fresh : candidates;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))] ?? null;
}

export async function listVariants(organizationId: string): Promise<ReplyVariant[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.replyVariant)
    .where(scoped(schema.replyVariant.organizationId, organizationId))
    .orderBy(asc(schema.replyVariant.key), asc(schema.replyVariant.createdAt));
}

/** Variantes activas del negocio para una clave; si no tiene, las de fábrica. */
export async function variantsFor(organizationId: string, key: ReplyKey): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ text: schema.replyVariant.text })
    .from(schema.replyVariant)
    .where(
      scoped(
        schema.replyVariant.organizationId,
        organizationId,
        and(eq(schema.replyVariant.key, key), eq(schema.replyVariant.active, true))
      )
    );
  return rows.length > 0 ? rows.map((r) => r.text) : DEFAULT_VARIANTS[key];
}

export async function pickReply(input: {
  organizationId: string;
  key: ReplyKey;
  usedTexts: string[];
  slots: Slots;
}): Promise<string> {
  const candidates = (await variantsFor(input.organizationId, input.key)).map((t) =>
    renderVariant(t, input.slots)
  );
  return chooseVariant(candidates, input.usedTexts) ?? renderVariant(DEFAULT_VARIANTS[input.key][0]!, input.slots);
}

export async function addVariants(
  organizationId: string,
  items: { key: string; text: string }[],
  source: "owner" | "mined" | "ai"
): Promise<{ added: number; skipped: number }> {
  const existing = await listVariants(organizationId);
  const seen = new Set(existing.map((v) => `${v.key}|${v.text.toLowerCase().trim()}`));
  const rows: (typeof schema.replyVariant.$inferInsert)[] = [];
  let skipped = 0;
  for (const it of items) {
    const text = it.text.trim().slice(0, 500);
    const id = `${it.key}|${text.toLowerCase()}`;
    if (!isReplyKey(it.key) || text.length < 2 || seen.has(id)) {
      skipped++;
      continue;
    }
    seen.add(id);
    rows.push({ id: newId("replyVariant"), organizationId, key: it.key, text, source });
  }
  if (rows.length > 0) await getDb().insert(schema.replyVariant).values(rows);
  return { added: rows.length, skipped };
}

export async function updateVariant(
  organizationId: string,
  id: string,
  patch: { text?: string; active?: boolean }
): Promise<boolean> {
  const rows = await getDb()
    .update(schema.replyVariant)
    .set({ ...patch, updatedAt: new Date() })
    .where(scoped(schema.replyVariant.organizationId, organizationId, eq(schema.replyVariant.id, id)))
    .returning({ id: schema.replyVariant.id });
  return rows.length > 0;
}

export async function deleteVariant(organizationId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(schema.replyVariant)
    .where(scoped(schema.replyVariant.organizationId, organizationId, eq(schema.replyVariant.id, id)))
    .returning({ id: schema.replyVariant.id });
  return rows.length > 0;
}
