import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";
import { registerOrgAiOverrideLoader, type OrgAiOverride } from "@/lib/ai/org-override";
import type { AiProvider } from "@/lib/ai/providers";

export type AiSettingsPublic = {
  provider: AiProvider;
  apiKeyLast4: string;
  baseUrl: string | null;
  model: string;
  judgeModel: string | null;
  updatedAt: string;
};

type Row = typeof schema.aiSettings.$inferSelect;

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: OrgAiOverride | null }>();

function toOverride(row: Row): OrgAiOverride {
  return {
    provider: row.provider,
    apiKey: decryptSecret({ cipher: row.apiKeyCipher, iv: row.apiKeyIv, tag: row.apiKeyTag }),
    baseUrl: row.baseUrl,
    model: row.model,
    judgeModel: row.judgeModel,
  };
}

async function loadRow(organizationId: string): Promise<Row | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.aiSettings)
    .where(scoped(schema.aiSettings.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

/** Lo que baja a la UI: nunca la clave, solo sus últimos 4. */
export async function getAiSettingsPublic(organizationId: string): Promise<AiSettingsPublic | null> {
  const row = await loadRow(organizationId);
  if (!row) return null;
  return {
    provider: row.provider,
    apiKeyLast4: row.apiKeyLast4,
    baseUrl: row.baseUrl,
    model: row.model,
    judgeModel: row.judgeModel,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Configuración descifrada para el registro de modelos (con caché de 60 s). */
export async function getOrgAiOverrideFromDb(organizationId: string): Promise<OrgAiOverride | null> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const row = await loadRow(organizationId);
  const value = row ? toOverride(row) : null;
  cache.set(organizationId, { at: Date.now(), value });
  return value;
}

/** La clave existente, para "Probar" o guardar sin volver a pegarla. */
export async function getStoredApiKey(organizationId: string): Promise<string | null> {
  const row = await loadRow(organizationId);
  return row ? toOverride(row).apiKey : null;
}

export async function saveAiSettings(input: {
  organizationId: string;
  provider: AiProvider;
  apiKey: string;
  baseUrl: string | null;
  model: string;
  judgeModel: string | null;
  updatedBy: string;
}): Promise<void> {
  const enc = encryptSecret(input.apiKey);
  const db = getDb();
  const existing = await loadRow(input.organizationId);
  const values = {
    provider: input.provider,
    apiKeyCipher: enc.cipher,
    apiKeyIv: enc.iv,
    apiKeyTag: enc.tag,
    apiKeyLast4: input.apiKey.slice(-4),
    baseUrl: input.baseUrl,
    model: input.model,
    judgeModel: input.judgeModel,
    updatedBy: input.updatedBy,
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(schema.aiSettings).set(values).where(eq(schema.aiSettings.id, existing.id));
  } else {
    await db.insert(schema.aiSettings).values({
      id: newId("aiSettings"),
      organizationId: input.organizationId,
      ...values,
    });
  }
  cache.delete(input.organizationId);
}

export async function deleteAiSettings(organizationId: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.aiSettings).where(scoped(schema.aiSettings.organizationId, organizationId));
  cache.delete(organizationId);
}

// El registro de modelos (lib/ai) consulta este loader al resolver candidatos.
registerOrgAiOverrideLoader(getOrgAiOverrideFromDb);
