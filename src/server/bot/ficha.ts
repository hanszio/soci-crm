import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Ficha de calificación del lead: lo que el cerebro externo va descubriendo
 * en la conversación.
 *
 * Las claves NO están cableadas. Cada negocio califica distinto —una clínica
 * pregunta el tratamiento, una constructora los metros, una agencia el
 * presupuesto— y el CRM no tiene por qué migrar cada vez que alguien cambia su
 * cuestionario. Lo que sí impone el CRM es que lo guardado sea sano: escalares,
 * acotados y en número razonable.
 *
 * La validación es FLOJA a propósito. Del otro lado hay un LLM que deriva: hoy
 * manda `dolor_principal` y mañana `dolorPrincipal`, o un `"sí"` donde antes
 * mandaba `true`. Devolverle un 422 le tira datos reales de calificación que ya
 * costaron una conversación; se prefiere guardar lo que se entienda e ignorar
 * en silencio lo que no.
 */

/** Tope de claves por ficha: contiene un bot en bucle sin estorbar a nadie. */
const MAX_KEYS = 40;
const MAX_KEY_LEN = 60;
const MAX_VALUE_LEN = 500;

export type FichaInput = Record<string, unknown>;
export type Ficha = Record<string, string | number | boolean | null>;

/**
 * Deja la ficha en valores que se puedan guardar y mostrar: escalares
 * acotados. `null` sobrevive porque significa "borra esta clave". Objetos,
 * arreglos y claves absurdas se ignoran sin error.
 */
export function normalizeFicha(raw: FichaInput): Ficha {
  const out: Ficha = {};
  if (!raw || typeof raw !== "object") return out;

  for (const [rawKey, value] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_KEYS) break;

    const key = rawKey.trim();
    if (!key || key.length > MAX_KEY_LEN) continue;

    if (value === null) {
      out[key] = null;
      continue;
    }
    if (typeof value === "boolean" || typeof value === "number") {
      if (typeof value === "number" && !Number.isFinite(value)) continue;
      out[key] = value;
      continue;
    }
    if (typeof value === "string") {
      const v = value.trim();
      // La cadena vacía no borra: para eso está `null` explícito. Un LLM manda
      // "" con demasiada facilidad como para dejarlo tirar un dato bueno.
      if (v) out[key] = v.slice(0, MAX_VALUE_LEN);
      continue;
    }
    // Objetos y arreglos: fuera. Se ignoran sin error (ver arriba).
  }
  return out;
}

/** Merge campo a campo: lo ausente se conserva, `null` explícito borra. */
export function mergeFicha(prev: Ficha | null | undefined, patch: Ficha): Ficha {
  const out: Ficha = { ...(prev ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}

export async function upsertFicha(input: {
  contactId: string;
  ficha: FichaInput;
}): Promise<{ ficha: Ficha }> {
  const db = getDb();
  const patch = normalizeFicha(input.ficha);

  const rows = await db
    .select({ ficha: schema.contact.ficha })
    .from(schema.contact)
    .where(eq(schema.contact.id, input.contactId))
    .limit(1);
  const merged = mergeFicha(rows[0]?.ficha as Ficha | null, patch);

  await db
    .update(schema.contact)
    .set({ ficha: merged, updatedAt: new Date() })
    .where(eq(schema.contact.id, input.contactId));

  return { ficha: merged };
}

export function serializeFicha(
  contact: typeof schema.contact.$inferSelect
): Ficha {
  return (contact.ficha as Ficha | null) ?? {};
}
