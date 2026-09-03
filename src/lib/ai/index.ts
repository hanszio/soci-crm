import type { z } from "zod";
import { APICallError, embedMany, generateText, type ModelMessage } from "ai";
import { FallbackExhaustedError, withFallback } from "@/lib/ai/fallback";
import {
  buildEmbeddingModel,
  buildLanguageModel,
  resolveCandidates,
  specKey,
  type ModelKind,
  type ModelSpec,
} from "@/lib/ai/registry";
import { recordUsage, type UsageKind } from "@/lib/ai/usage";
// Registra el lector de Ajustes → IA (efecto secundario del import).
import "@/server/ai-settings/store";

/**
 * Adaptador LLM — ÚNICA frontera con los proveedores de IA (Constitución II).
 * Desde T1.1 habla con cualquier proveedor vía Vercel AI SDK, con cadena de
 * fallback y configuración por organización. La firma pública de `chatJson`
 * se conserva: la salida del modelo es impredecible, todo consumo pasa por
 * extracción robusta + Zod + reintentos, y un hipo del proveedor jamás
 * propaga excepción (resultado `error` tipado).
 */

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatJsonResult<T> =
  | { ok: true; data: T; raw: string }
  | { ok: false; error: "not_configured" | "provider_error" | "invalid_output"; detail: string };

export type ChatOpts = {
  /** Sobrescribe el modelo (`proveedor/modelo` o solo el id en el proveedor principal). */
  model?: string;
  /** Usa el modelo juez (más barato) en vez del principal. */
  judge?: boolean;
  timeoutMs?: number;
  /** Organización que origina la llamada: activa su configuración y mide su uso. */
  organizationId?: string;
  /** Etiqueta para la medición de uso. */
  kind?: UsageKind;
  /** Spec explícito (Ajustes → IA: probar conexión). Ignora entorno y organización. */
  spec?: ModelSpec;
};

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

export async function chatJson<T>(
  schema: z.ZodType<T>,
  messages: ChatMessage[],
  opts?: ChatOpts
): Promise<ChatJsonResult<T>> {
  const candidates = await candidatesFor(opts?.judge ? "judge" : "chat", opts);
  if (candidates.length === 0) return notConfigured();

  let lastDetail = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptMessages: ChatMessage[] =
      attempt === 1
        ? messages
        : [
            ...messages,
            {
              role: "system",
              content:
                "STRICT: tu respuesta anterior no fue JSON válido según el esquema. Responde ÚNICAMENTE el objeto JSON, sin explicaciones ni markdown.",
            },
          ];
    try {
      const raw = await callWithFallback(candidates, attemptMessages, opts, opts?.kind ?? (opts?.judge ? "judge" : "chat"));
      const extracted = extractJson(raw);
      if (extracted === null) {
        lastDetail = `sin JSON extraíble (raw=${truncate(raw)})`;
        continue;
      }
      const parsed = schema.safeParse(extracted);
      if (!parsed.success) {
        lastDetail = `no cumple el esquema: ${parsed.error.issues
          .map((i) => i.path.join(".") + " " + i.message)
          .join("; ")} (raw=${truncate(raw)})`;
        continue;
      }
      return { ok: true, data: parsed.data, raw };
    } catch (err) {
      lastDetail = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  return {
    ok: false,
    error:
      lastDetail.includes("esquema") || lastDetail.includes("JSON")
        ? "invalid_output"
        : "provider_error",
    detail: lastDetail,
  };
}

export type ChatTextResult =
  | { ok: true; text: string; model: string; latencyMs: number }
  | { ok: false; error: "not_configured" | "provider_error"; detail: string };

/** Respuesta libre (visión, resúmenes, prueba de conexión). Un solo intento por candidato. */
export async function chatText(messages: ChatMessage[], opts?: ChatOpts & { maxOutputTokens?: number }): Promise<ChatTextResult> {
  const candidates = await candidatesFor(opts?.judge ? "judge" : "chat", opts);
  if (candidates.length === 0) return { ok: false, error: "not_configured", detail: "Sin proveedor de IA configurado" };
  const started = Date.now();
  try {
    const { result, key } = await withFallback(
      candidates.map((c) => ({ key: specKey(c), value: c })),
      (spec) => callModel(spec, messages, opts?.timeoutMs ?? 60_000, opts?.kind ?? "text", opts?.organizationId, opts?.maxOutputTokens),
      classifyError
    );
    return { ok: true, text: result, model: key, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, error: "provider_error", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Embeddings en lotes de 64. Lanza si no hay proveedor de embeddings. */
export async function embed(texts: string[], opts?: { organizationId?: string; timeoutMs?: number }): Promise<number[][]> {
  const candidates = await resolveCandidates("embed", opts?.organizationId);
  if (candidates.length === 0) throw new Error("Sin modelo de embeddings configurado (AI_EMBED_MODEL)");
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const batch = texts.slice(i, i + 64);
    const started = Date.now();
    const { result } = await withFallback(
      candidates.map((c) => ({ key: specKey(c), value: c })),
      async (spec) => {
        const res = await embedMany({
          model: buildEmbeddingModel(spec),
          values: batch,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(opts?.timeoutMs ?? 60_000),
        });
        void recordUsage({
          organizationId: opts?.organizationId,
          model: `${spec.provider}/${spec.model}`,
          kind: "embed",
          tokensIn: res.usage?.tokens ?? 0,
          latencyMs: Date.now() - started,
          ok: true,
        });
        return res.embeddings;
      },
      classifyError
    );
    out.push(...result);
  }
  return out;
}

/** true si esta organización (o la plataforma) tiene un modelo de chat resoluble. */
export async function isAiAvailable(organizationId?: string): Promise<boolean> {
  try {
    return (await resolveCandidates("chat", organizationId)).length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------

async function candidatesFor(kind: ModelKind, opts?: ChatOpts): Promise<ModelSpec[]> {
  if (opts?.spec) return [opts.spec];
  let candidates = await resolveCandidates(kind, opts?.organizationId);
  if (opts?.model && candidates.length > 0) {
    // Modelo explícito: `proveedor/modelo` cambia proveedor; un id suelto usa el primero.
    const slash = opts.model.indexOf("/");
    const first = candidates[0]!;
    const override: ModelSpec = slash > 0
      ? { ...first, provider: first.provider, model: opts.model }
      : { ...first, model: opts.model };
    candidates = [override, ...candidates.slice(1)];
  }
  return candidates;
}

function notConfigured<T>(): ChatJsonResult<T> {
  return {
    ok: false,
    error: "not_configured",
    detail: "Sin proveedor de IA configurado (Ajustes → IA o variables AI_*)",
  };
}

async function callWithFallback(
  candidates: ModelSpec[],
  messages: ChatMessage[],
  opts: ChatOpts | undefined,
  kind: UsageKind
): Promise<string> {
  try {
    const { result } = await withFallback(
      candidates.map((c) => ({ key: specKey(c), value: c })),
      (spec) => callModel(spec, messages, opts?.timeoutMs ?? 60_000, kind, opts?.organizationId),
      classifyError
    );
    return result;
  } catch (err) {
    if (err instanceof FallbackExhaustedError) throw new Error(err.message);
    throw err;
  }
}

async function callModel(
  spec: ModelSpec,
  messages: ChatMessage[],
  timeoutMs: number,
  kind: UsageKind,
  organizationId?: string,
  maxOutputTokens?: number
): Promise<string> {
  const started = Date.now();
  const modelLabel = `${spec.provider}/${spec.model}`;
  // AI SDK prefiere el system aparte del historial.
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n") || undefined;
  const history: ModelMessage[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  try {
    const res = await generateText({
      model: buildLanguageModel(spec),
      system,
      messages: history,
      maxRetries: 0,
      maxOutputTokens,
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    void recordUsage({
      organizationId,
      model: modelLabel,
      kind,
      tokensIn: res.usage?.inputTokens ?? 0,
      tokensOut: res.usage?.outputTokens ?? 0,
      latencyMs: Date.now() - started,
      ok: true,
    });
    const text = stripThinking(res.text);
    if (typeof text !== "string" || text.length === 0) {
      throw new Error("respuesta del proveedor sin contenido (¿modelo razonador con pocos tokens de salida?)");
    }
    return text;
  } catch (err) {
    void recordUsage({
      organizationId,
      model: modelLabel,
      kind,
      latencyMs: Date.now() - started,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Algunos modelos razonadores (MiniMax, Kimi, GLM…) devuelven su cadena de
 * pensamiento dentro del texto entre <think>…</think>. Nunca debe llegar al
 * cliente ni confundir la extracción de JSON.
 */
export function stripThinking(text: string): string {
  if (!text) return text;
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  // Bloque abierto sin cerrar (se agotaron los tokens): lo descartamos entero.
  out = out.replace(/<think>[\s\S]*$/i, "");
  return out.trim();
}

/** Traduce el error del SDK a un mensaje corto y decide si abre el breaker. */
export function classifyError(err: unknown): { message: string; opensBreaker: boolean } {
  if (APICallError.isInstance(err)) {
    const status = err.statusCode;
    const body = truncate(err.responseBody ?? err.message);
    const message = `proveedor respondió ${status ?? "?"}: ${body}`;
    const opensBreaker = status === undefined || status === 402 || status === 408 || status === 429 || status >= 500;
    return { message, opensBreaker };
  }
  if (err instanceof Error) {
    const timeout = /abort|timeout/i.test(err.name + err.message);
    return { message: timeout ? "tiempo de espera agotado" : err.message, opensBreaker: true };
  }
  return { message: String(err), opensBreaker: true };
}

/** Mensaje humano para la UI de Ajustes → IA. */
export function humanizeProviderError(detail: string): string {
  if (/respondió 401|respondió 403|invalid.*api key|incorrect api key|authentication/i.test(detail)) return "Clave inválida o sin permisos.";
  if (/respondió 402|insufficient credits|insufficient_quota|billing/i.test(detail)) return "Sin créditos o saldo en el proveedor.";
  if (/respondió 404|model.*not (found|exist)|does not exist/i.test(detail)) return "El modelo no existe en ese proveedor.";
  if (/respondió 429/i.test(detail)) return "Límite de peticiones del proveedor; intenta en unos segundos.";
  if (/tiempo de espera|timeout|fetch failed|ECONNREFUSED|ENOTFOUND/i.test(detail)) return "No se pudo conectar con el proveedor (URL o red).";
  return detail.slice(0, 200);
}

/**
 * Extracción robusta de JSON de una respuesta de modelo:
 * 1) bloque ```json ... ``` (o ``` ... ```), 2) el texto completo,
 * 3) del primer `{` al último `}`.
 */
export function extractJson(raw: string): unknown | null {
  const candidates: string[] = [];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  candidates.push(raw.trim());
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(raw.slice(first, last + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
