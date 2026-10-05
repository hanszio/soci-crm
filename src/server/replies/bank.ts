import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  defaultVariants,
  isReplyKey,
  REPLY_KEYS,
  type Formality,
  type ReplyKey,
} from "@/server/replies/keys";

export type ReplyVariant = typeof schema.replyVariant.$inferSelect;
export type Slots = { agente?: string; negocio?: string; horario?: string; direccion?: string };

export function renderVariant(text: string, slots: Slots): string {
  return text
    .replace(/\{agente\}/g, slots.agente ?? "")
    .replace(/\{negocio\}/g, slots.negocio ?? "el negocio")
    .replace(/\{horario\}/g, slots.horario ?? "")
    .replace(/\{direccion\}/g, slots.direccion ?? "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Cómo habla el agente en este turno: una frase por clave, sin repetirse. */
export type Say = (key: ReplyKey, slots?: Slots) => string;

/**
 * Banco en memoria para un turno. `used` crece con cada frase dicha: dos
 * frases del mismo turno tampoco se repiten.
 */
export function makeSay(
  variants: Partial<Record<ReplyKey, string[]>>,
  formality: Formality,
  usedTexts: string[],
  baseSlots: Slots = {},
  rng: () => number = Math.random
): Say {
  const defaults = defaultVariants(formality);
  const used = [...usedTexts];
  return (key, slots) => {
    const own = variants[key];
    const all = { ...baseSlots, ...slots };
    const candidates = (own && own.length > 0 ? own : defaults[key]).map((t) => renderVariant(t, all));
    const chosen = chooseVariant(candidates, used, rng) ?? renderVariant(defaults[key][0]!, all);
    used.push(chosen);
    return chosen;
  };
}

/** Sin base de datos: solo las de fábrica. Para pruebas y como último recurso. */
export function defaultSay(formality: Formality = "usted"): Say {
  return makeSay({}, formality, []);
}

/** Carga las variantes activas del negocio UNA vez por turno. */
export async function loadSay(input: {
  organizationId: string;
  formality: Formality;
  usedTexts: string[];
  slots: Slots;
}): Promise<Say> {
  let rows: { key: string; text: string }[] = [];
  try {
    rows = await getDb()
      .select({ key: schema.replyVariant.key, text: schema.replyVariant.text })
      .from(schema.replyVariant)
      .where(
        scoped(schema.replyVariant.organizationId, input.organizationId, eq(schema.replyVariant.active, true))
      );
  } catch (err) {
    // Sin banco propio el agente habla con las frases de fábrica.
    console.warn(`[respuestas] no pude leer las variantes: ${err}`);
  }
  const own: Partial<Record<ReplyKey, string[]>> = {};
  for (const r of rows) {
    if (!isReplyKey(r.key)) continue;
    (own[r.key] ??= []).push(r.text);
  }
  return makeSay(own, input.formality, input.usedTexts, input.slots);
}

export { REPLY_KEYS };

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
