import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organization, user } from "../schema";

/**
 * Configuración de IA por organización (BYOK). Sin fila, la organización usa
 * las claves de la plataforma (variables de entorno). La clave va cifrada con
 * AES-256-GCM (`lib/crypto`), como el token de WhatsApp; a la UI solo bajan los
 * últimos 4 caracteres.
 */
export const aiSettings = pgTable(
  "ai_settings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: ["anthropic", "openai", "google", "openrouter", "compat"],
    }).notNull(),
    apiKeyCipher: text("api_key_cipher").notNull(),
    apiKeyIv: text("api_key_iv").notNull(),
    apiKeyTag: text("api_key_tag").notNull(),
    apiKeyLast4: text("api_key_last4").notNull(),
    baseUrl: text("base_url"),
    model: text("model").notNull(),
    judgeModel: text("judge_model"),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_settings_org_uq").on(t.organizationId)]
);

/**
 * Una fila por llamada al proveedor de IA: base de cuotas, costos por
 * organización y diagnóstico. Best-effort: escribirla jamás bloquea un turno.
 */
export const usageEvent = pgTable(
  "usage_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    model: text("model").notNull(),
    kind: text("kind", { enum: ["chat", "judge", "gate", "embed", "text"] }).notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    ok: boolean("ok").notNull().default(true),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("usage_event_org_created_idx").on(t.organizationId, t.createdAt),
    index("usage_event_created_idx").on(t.createdAt),
  ]
);
