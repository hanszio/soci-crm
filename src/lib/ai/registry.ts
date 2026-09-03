import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { EmbeddingModel, LanguageModel } from "ai";
import { getOrgAiOverride } from "@/lib/ai/org-override";
import {
  OPENROUTER_BASE_URL,
  PROVIDER_INFO,
  parseModelId,
  type AiProvider,
} from "@/lib/ai/providers";

/**
 * Variables de IA leídas en caliente (no memoizadas): son todas opcionales y
 * así el comportamiento sigue al entorno real, igual que `isAiConfigured()`.
 */
function aiEnv() {
  const g = (k: string) => {
    const v = process.env[k];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  };
  return {
    OPENROUTER_API_TOKEN: g("OPENROUTER_API_TOKEN"),
    OPENROUTER_BASE_URL: g("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api",
    OPENROUTER_MODEL: g("OPENROUTER_MODEL"),
    OPENROUTER_JUDGE_MODEL: g("OPENROUTER_JUDGE_MODEL"),
    AI_MODEL: g("AI_MODEL"),
    AI_JUDGE_MODEL: g("AI_JUDGE_MODEL"),
    AI_GATE_MODEL: g("AI_GATE_MODEL"),
    AI_EMBED_MODEL: g("AI_EMBED_MODEL"),
    AI_FALLBACK: g("AI_FALLBACK"),
    ANTHROPIC_API_KEY: g("ANTHROPIC_API_KEY"),
    OPENAI_API_KEY: g("OPENAI_API_KEY"),
    GOOGLE_GENERATIVE_AI_API_KEY: g("GOOGLE_GENERATIVE_AI_API_KEY"),
    OPENROUTER_API_KEY: g("OPENROUTER_API_KEY"),
    AI_COMPAT_BASE_URL: g("AI_COMPAT_BASE_URL"),
    AI_COMPAT_API_KEY: g("AI_COMPAT_API_KEY"),
  };
}

/** Un modelo concreto listo para usarse: proveedor + credencial + id. */
export type ModelSpec = {
  provider: AiProvider;
  model: string;
  apiKey: string;
  baseUrl: string | null;
  /** De dónde salió: para logs y para el breaker. */
  source: "org" | "platform" | "fallback" | "legacy";
};

export type ModelKind = "chat" | "judge" | "gate" | "embed";

export function specKey(s: ModelSpec): string {
  return `${s.provider}:${s.baseUrl ?? ""}:${s.model}`;
}

function platformKey(provider: AiProvider): string | undefined {
  const env = aiEnv();
  switch (provider) {
    case "anthropic":
      return env.ANTHROPIC_API_KEY;
    case "openai":
      return env.OPENAI_API_KEY;
    case "google":
      return env.GOOGLE_GENERATIVE_AI_API_KEY;
    case "openrouter":
      return env.OPENROUTER_API_KEY ?? env.OPENROUTER_API_TOKEN;
    case "compat":
      return env.AI_COMPAT_API_KEY ?? "no-key";
  }
}

function platformBaseUrl(provider: AiProvider): string | null {
  const env = aiEnv();
  if (provider === "compat") return env.AI_COMPAT_BASE_URL ?? null;
  return null;
}

/** `proveedor/modelo` → spec con la clave de la plataforma, o null si falta. */
function platformSpec(id: string, source: ModelSpec["source"]): ModelSpec | null {
  const parsed = parseModelId(id);
  if (!parsed) return null;
  const apiKey = platformKey(parsed.provider);
  const baseUrl = platformBaseUrl(parsed.provider);
  if (!apiKey) return null;
  if (parsed.provider === "compat" && !baseUrl) return null;
  return { provider: parsed.provider, model: parsed.model, apiKey, baseUrl, source };
}

/**
 * Compatibilidad con la configuración original de Vocero: OPENROUTER_MODEL +
 * OPENROUTER_API_TOKEN + OPENROUTER_BASE_URL. Se modela como proveedor
 * "compat" apuntando a `${OPENROUTER_BASE_URL}/v1`, así el self-test con el
 * ai-mock sigue funcionando sin tocar variables.
 */
function legacySpec(kind: ModelKind): ModelSpec | null {
  const env = aiEnv();
  const token = env.OPENROUTER_API_TOKEN;
  const model = kind === "judge" || kind === "gate"
    ? (env.OPENROUTER_JUDGE_MODEL ?? env.OPENROUTER_MODEL)
    : env.OPENROUTER_MODEL;
  if (!token || !model || kind === "embed") return null;
  return {
    provider: "compat",
    model,
    apiKey: token,
    baseUrl: `${env.OPENROUTER_BASE_URL.replace(/\/$/, "")}/v1`,
    source: "legacy",
  };
}

function platformModelId(kind: ModelKind): string | undefined {
  const env = aiEnv();
  switch (kind) {
    case "chat":
      return env.AI_MODEL;
    case "judge":
      return env.AI_JUDGE_MODEL ?? env.AI_MODEL;
    case "gate":
      return env.AI_GATE_MODEL ?? env.AI_JUDGE_MODEL ?? env.AI_MODEL;
    case "embed":
      return env.AI_EMBED_MODEL;
  }
}

function embeddingSpecFor(provider: AiProvider, apiKey: string, baseUrl: string | null, source: ModelSpec["source"]): ModelSpec | null {
  const info = PROVIDER_INFO[provider];
  if (!info.embeddingModel) return null;
  return { provider, model: info.embeddingModel, apiKey, baseUrl, source };
}

/**
 * Candidatos en orden: configuración de la organización → plataforma →
 * respaldos (AI_FALLBACK) → configuración heredada de OpenRouter. Sin
 * duplicados. Lista vacía = IA no configurada.
 */
export async function resolveCandidates(
  kind: ModelKind,
  organizationId?: string
): Promise<ModelSpec[]> {
  const out: ModelSpec[] = [];
  const seen = new Set<string>();
  const push = (s: ModelSpec | null) => {
    if (!s) return;
    const k = specKey(s);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  };

  if (organizationId) {
    const org = await getOrgAiOverride(organizationId);
    if (org) {
      if (kind === "embed") {
        push(embeddingSpecFor(org.provider, org.apiKey, org.baseUrl, "org"));
      } else {
        const model = kind === "chat" ? org.model : (org.judgeModel ?? org.model);
        push({ provider: org.provider, model, apiKey: org.apiKey, baseUrl: org.baseUrl, source: "org" });
      }
    }
  }

  const primary = platformModelId(kind);
  if (primary) push(platformSpec(primary, "platform"));

  const env = aiEnv();
  if (kind !== "embed" && env.AI_FALLBACK) {
    for (const id of env.AI_FALLBACK.split(",").map((s) => s.trim()).filter(Boolean)) {
      push(platformSpec(id, "fallback"));
    }
  }

  push(legacySpec(kind));

  if (kind === "embed" && out.length === 0) {
    // Sin AI_EMBED_MODEL: usar el proveedor de chat de la plataforma si ofrece embeddings.
    const chat = primary ? platformSpec(primary, "platform") : null;
    if (chat) push(embeddingSpecFor(chat.provider, chat.apiKey, chat.baseUrl, "platform"));
  }

  return out;
}

/** Spec explícito (Ajustes → IA "Probar conexión"), sin pasar por el entorno. */
export function specFromOverride(input: {
  provider: AiProvider;
  apiKey: string;
  baseUrl?: string | null;
  model: string;
}): ModelSpec {
  return {
    provider: input.provider,
    model: input.model,
    apiKey: input.apiKey,
    baseUrl: input.baseUrl ?? null,
    source: "org",
  };
}

const APP_HEADERS = {
  "HTTP-Referer": "https://soci.vibedigital.agency",
  "X-Title": "Soci CRM",
};

export function buildLanguageModel(spec: ModelSpec): LanguageModel {
  switch (spec.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: spec.apiKey })(spec.model);
    case "openai":
      return createOpenAI({ apiKey: spec.apiKey }).chat(spec.model);
    case "google":
      return createGoogleGenerativeAI({ apiKey: spec.apiKey })(spec.model);
    case "openrouter":
      return createOpenAICompatible({
        name: "openrouter",
        baseURL: spec.baseUrl ?? OPENROUTER_BASE_URL,
        apiKey: spec.apiKey,
        headers: APP_HEADERS,
      })(spec.model);
    case "compat":
      if (!spec.baseUrl) throw new Error("proveedor compat sin URL base");
      return createOpenAICompatible({
        name: "compat",
        baseURL: spec.baseUrl,
        apiKey: spec.apiKey,
      })(spec.model);
  }
}

export function buildEmbeddingModel(spec: ModelSpec): EmbeddingModel {
  switch (spec.provider) {
    case "openai":
      return createOpenAI({ apiKey: spec.apiKey }).embeddingModel(spec.model);
    case "google":
      return createGoogleGenerativeAI({ apiKey: spec.apiKey }).textEmbeddingModel(spec.model);
    case "openrouter":
      return createOpenAICompatible({
        name: "openrouter",
        baseURL: spec.baseUrl ?? OPENROUTER_BASE_URL,
        apiKey: spec.apiKey,
        headers: APP_HEADERS,
      }).embeddingModel(spec.model);
    case "compat":
      if (!spec.baseUrl) throw new Error("proveedor compat sin URL base");
      return createOpenAICompatible({ name: "compat", baseURL: spec.baseUrl, apiKey: spec.apiKey }).embeddingModel(spec.model);
    case "anthropic":
      throw new Error("Anthropic no ofrece embeddings; configura AI_EMBED_MODEL con otro proveedor");
  }
}
