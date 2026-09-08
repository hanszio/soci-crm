import { getEnv } from "@/lib/env";
import {
  claim,
  complete,
  enqueue,
  fail,
  requeueStale,
  type ClaimedJob,
  type JobKind,
} from "@/server/jobs/queue";
import { runAgentTurnExclusive } from "@/server/ai/pipeline";
import { sendTypingIndicator } from "@/server/whatsapp/typing";

/**
 * El único trabajador de la cola (T1.2): cada `AGENT_JOB_POLL_MS` toma lo
 * vencido y lo despacha por `kind`. In-process, como todo el trabajo de fondo
 * de Vocero — arranca en `instrumentation.ts` y muere con el servidor.
 */

const BATCH = 5;
/** Si el turno de esa conversación ya está corriendo, se vuelve a intentar en… */
const BUSY_RETRY_MS = 3_000;

export type Handlers = Record<JobKind, (job: ClaimedJob) => Promise<void>>;

export const handlers: Handlers = {
  async agent_turn(job) {
    const outcome = await runAgentTurnExclusive(job.conversationId);
    if (outcome === "busy") {
      await enqueue({
        organizationId: job.organizationId,
        kind: "agent_turn",
        conversationId: job.conversationId,
        runAt: new Date(Date.now() + BUSY_RETRY_MS),
      });
    }
  },
  async agent_typing(job) {
    // Best-effort: "escribiendo…" jamás vale un reintento.
    await sendTypingIndicator(job.organizationId, job.conversationId).catch(
      () => undefined
    );
  },
};

export type TickDeps = {
  claim: (limit: number) => Promise<ClaimedJob[]>;
  complete: (id: string) => Promise<void>;
  fail: (job: ClaimedJob, err: unknown) => Promise<void>;
  handlers: Handlers;
};

const defaultDeps: TickDeps = { claim, complete, fail, handlers };

/** Procesa un lote. Devuelve cuántos trabajos tomó. Exportada para tests. */
export async function runTick(deps: TickDeps = defaultDeps): Promise<number> {
  const jobs = await deps.claim(BATCH);
  for (const job of jobs) {
    const handler = deps.handlers[job.kind];
    try {
      if (!handler) throw new Error(`kind desconocido: ${job.kind}`);
      await handler(job);
      await deps.complete(job.id);
    } catch (err) {
      console.error(`[jobs] ${job.kind} ${job.conversationId} falló:`, err);
      await deps.fail(job, err).catch(() => undefined);
    }
  }
  return jobs.length;
}

type PollerState = { timer: ReturnType<typeof setInterval>; ticking: boolean };
const g = globalThis as unknown as { __agentPoller?: PollerState };

async function guardedTick(): Promise<void> {
  const state = g.__agentPoller;
  if (!state || state.ticking) return;
  state.ticking = true;
  try {
    // Mientras haya vencidos, se sigue: un lote no tiene por qué esperar al
    // siguiente intervalo.
    let took = 0;
    do {
      took = await runTick();
    } while (took === BATCH);
  } catch (err) {
    console.error("[jobs] tick falló:", err);
  } finally {
    state.ticking = false;
  }
}

export function startPoller(): void {
  if (g.__agentPoller) return;
  const every = getEnv().AGENT_JOB_POLL_MS;
  const timer = setInterval(() => void guardedTick(), every);
  timer.unref?.();
  g.__agentPoller = { timer, ticking: false };
  void requeueStale()
    .then((n) => {
      if (n > 0) console.log(`[jobs] ${n} trabajo(s) huérfano(s) re-encolado(s)`);
    })
    .catch(() => undefined);
  console.log(`[jobs] poller encendido (cada ${every} ms)`);
}

/** Pide un tick ya, sin esperar al intervalo (retraso 0, tests). */
export function kick(): void {
  if (!g.__agentPoller) return;
  setTimeout(() => void guardedTick(), 0);
}
