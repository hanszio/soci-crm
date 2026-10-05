import { recordUsage } from "@/lib/ai/usage";

/**
 * Cliente mínimo de TypeSafe (modelo Jev, "System One").
 *
 * Jev NO genera texto: recibe un `state` y preguntas tipadas y devuelve
 * decisiones con probabilidad (choice / noul / score). Aquí solo vive el
 * transporte; qué se pregunta y qué se hace con la respuesta está en
 * `server/jev`. Contrato: https://docs.typesafe.ai/api.md
 *
 * Nunca lanza: Jev es un conector opcional y su fallo no puede tumbar un turno.
 */

export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
};
export type NoulQuestion = { type: "noul"; instructions: string };
export type ScoreQuestion = { type: "score"; instructions: string; criteria: string[] };
export type Question = ChoiceQuestion | NoulQuestion | ScoreQuestion;

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};
export type NoulAnswer = { type: "noul"; noul: number };
export type ScoreAnswer = { type: "score"; score: number; confidence: number };
export type Answer = ChoiceAnswer | NoulAnswer | ScoreAnswer;

export type SystemOneResult =
  | { ok: true; answers: Record<string, Answer>; model: string; inputTokens: number; latencyMs: number }
  | { ok: false; error: string; latencyMs: number };

/** Versión fijada: los umbrales de `server/jev/route.ts` se midieron con esta. */
export const DEFAULT_JEV_MODEL = "jev-1.13.0";
const DEFAULT_BASE_URL = "https://api.typesafe.ai";
/** Más que esto y el turno sigue por el camino de siempre. */
const DEFAULT_TIMEOUT_MS = 2500;

export function typesafeConfig(): { apiKey: string; baseUrl: string; model: string } | null {
  const apiKey = (process.env.TYPESAFE_API_KEY ?? "").trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.TYPESAFE_BASE_URL ?? "").trim() || DEFAULT_BASE_URL,
    model: (process.env.TYPESAFE_MODEL ?? "").trim() || DEFAULT_JEV_MODEL,
  };
}

export async function systemOne(input: {
  state: unknown;
  questions: Record<string, Question>;
  organizationId?: string | null;
  timeoutMs?: number;
}): Promise<SystemOneResult> {
  const cfg = typesafeConfig();
  const t0 = performance.now();
  if (!cfg) return { ok: false, error: "not_configured", latencyMs: 0 };

  let lastError = "sin respuesta";
  // Un reintento, solo ante 429/5xx: Jev es rápido o no vale la pena esperarlo.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${cfg.baseUrl}/v1/systemone`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ state: input.state, model: cfg.model, questions: input.questions }),
        signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = `http_${res.status}`;
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      const json = (await res.json().catch(() => null)) as {
        model?: string;
        answers?: Record<string, Answer>;
        usage?: { input_tokens?: number };
      } | null;
      if (!res.ok || !json?.answers) {
        lastError = `http_${res.status}`;
        break;
      }
      const latencyMs = performance.now() - t0;
      const inputTokens = json.usage?.input_tokens ?? 0;
      void recordUsage({
        organizationId: input.organizationId,
        model: json.model ?? cfg.model,
        kind: "gate",
        tokensIn: inputTokens,
        latencyMs,
        ok: true,
      });
      return { ok: true, answers: json.answers, model: json.model ?? cfg.model, inputTokens, latencyMs };
    } catch (err) {
      lastError = err instanceof Error ? err.name : "error";
      break;
    }
  }
  const latencyMs = performance.now() - t0;
  void recordUsage({
    organizationId: input.organizationId,
    model: cfg.model,
    kind: "gate",
    latencyMs,
    ok: false,
    error: lastError,
  });
  return { ok: false, error: lastError, latencyMs };
}
