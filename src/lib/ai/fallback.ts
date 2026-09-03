/**
 * Cadena de fallback con circuit breaker en memoria.
 *
 * Un modelo que falla `FAILURES_TO_OPEN` veces seguidas con un error de
 * disponibilidad (402 sin créditos, 429, 5xx, timeout, red) queda "abierto"
 * `OPEN_MS` y se salta hasta que pase el plazo (medio-abierto: se prueba una
 * vez). Los errores de configuración (400/401/403/404) no abren el breaker
 * —arreglarlos es cosa del operador— pero sí pasan al siguiente candidato.
 */

export const FAILURES_TO_OPEN = 3;
export const OPEN_MS = 5 * 60 * 1000;

type BreakerState = { failures: number; openedAt: number | null };

const globalForBreaker = globalThis as unknown as {
  __sociAiBreaker?: Map<string, BreakerState>;
};

function states(): Map<string, BreakerState> {
  if (!globalForBreaker.__sociAiBreaker) {
    globalForBreaker.__sociAiBreaker = new Map();
  }
  return globalForBreaker.__sociAiBreaker;
}

export function breakerIsOpen(key: string, now = Date.now()): boolean {
  const s = states().get(key);
  if (!s || s.openedAt === null) return false;
  if (now - s.openedAt >= OPEN_MS) {
    // medio-abierto: se permite UN intento; si falla vuelve a abrirse
    s.openedAt = null;
    s.failures = FAILURES_TO_OPEN - 1;
    return false;
  }
  return true;
}

export function reportSuccess(key: string): void {
  states().delete(key);
}

export function reportFailure(key: string, opensBreaker: boolean, now = Date.now()): void {
  if (!opensBreaker) return;
  const s = states().get(key) ?? { failures: 0, openedAt: null };
  s.failures += 1;
  if (s.failures >= FAILURES_TO_OPEN) s.openedAt = now;
  states().set(key, s);
}

/** Solo para tests. */
export function resetBreakers(): void {
  states().clear();
}

export type AttemptFailure = { key: string; message: string; opensBreaker: boolean };

/**
 * Ejecuta `fn` sobre cada candidato hasta que uno responda. Los candidatos
 * con breaker abierto se saltan. Si todos fallan, lanza con el detalle de
 * cada intento.
 */
export async function withFallback<C, T>(
  candidates: { key: string; value: C }[],
  fn: (candidate: C) => Promise<T>,
  classify: (err: unknown) => { message: string; opensBreaker: boolean }
): Promise<{ result: T; key: string }> {
  const failures: AttemptFailure[] = [];
  // Un breaker abierto solo se salta si queda algún candidato cerrado: con un
  // único proveedor, enmudecer 5 minutos sería peor que reintentar.
  const anyClosed = candidates.some((c) => !breakerIsOpen(c.key));
  for (const c of candidates) {
    if (anyClosed && breakerIsOpen(c.key)) {
      failures.push({ key: c.key, message: "breaker abierto (fallos recientes)", opensBreaker: false });
      continue;
    }
    try {
      const result = await fn(c.value);
      reportSuccess(c.key);
      return { result, key: c.key };
    } catch (err) {
      const info = classify(err);
      reportFailure(c.key, info.opensBreaker);
      failures.push({ key: c.key, ...info });
    }
  }
  const detail = failures.map((f) => `${f.key}: ${f.message}`).join(" | ");
  throw new FallbackExhaustedError(detail || "sin candidatos", failures);
}

export class FallbackExhaustedError extends Error {
  constructor(
    message: string,
    public readonly failures: AttemptFailure[]
  ) {
    super(message);
    this.name = "FallbackExhaustedError";
  }
}
