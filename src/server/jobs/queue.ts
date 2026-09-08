import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * Cola persistente de trabajos del agente (T1.2). La única cola del sistema:
 * en Postgres, sin Redis ni terceros (Constitución II).
 *
 * Lo que compra sobre un `setTimeout`: un turno programado para dentro de 3
 * minutos SOBREVIVE a un redeploy. Sin esto, cada despliegue en mitad de un
 * retraso humano dejaba a un cliente sin respuesta — para siempre.
 *
 * Una conversación tiene como mucho UN turno pendiente (índice único parcial):
 * un mensaje nuevo mueve el `run_at`, no apila turnos.
 */

export type JobKind = "agent_turn" | "agent_typing";

export type ClaimedJob = {
  id: string;
  organizationId: string;
  kind: JobKind;
  conversationId: string;
  attempts: number;
  maxAttempts: number;
};

export async function enqueue(input: {
  organizationId: string;
  kind: JobKind;
  conversationId: string;
  runAt: Date;
  maxAttempts?: number;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.agentJob)
    .values({
      id: newId("agentJob"),
      organizationId: input.organizationId,
      kind: input.kind,
      conversationId: input.conversationId,
      payload: {},
      runAt: input.runAt,
      maxAttempts: input.maxAttempts ?? 3,
    })
    .onConflictDoUpdate({
      target: [schema.agentJob.kind, schema.agentJob.conversationId],
      targetWhere: sql`${schema.agentJob.status} = 'queued'`,
      // Un mensaje nuevo pospone el turno pendiente en vez de duplicarlo.
      set: { runAt: input.runAt, updatedAt: new Date() },
    });
}

export async function cancelQueued(
  kind: JobKind,
  conversationId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.agentJob)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(schema.agentJob.kind, kind),
        eq(schema.agentJob.conversationId, conversationId),
        eq(schema.agentJob.status, "queued")
      )
    );
}

/**
 * Toma hasta `limit` trabajos vencidos. `FOR UPDATE SKIP LOCKED` es lo que
 * permitiría dos procesos sin pisarse; hoy hay uno, pero el candado no cuesta.
 */
export async function claim(limit: number, now = new Date()): Promise<ClaimedJob[]> {
  const db = getDb();
  // El driver no serializa Date en SQL crudo: va como ISO y se castea. Las
  // columnas son `timestamp` sin zona y Drizzle escribe en UTC, así que el
  // ISO con Z compara bien.
  const nowIso = now.toISOString();
  const rows = await db.execute(sql`
    UPDATE agent_job
    SET status = 'running', locked_at = ${nowIso}::timestamp, updated_at = ${nowIso}::timestamp
    WHERE id IN (
      SELECT id FROM agent_job
      WHERE status = 'queued' AND run_at <= ${nowIso}::timestamp
      ORDER BY run_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, organization_id, kind, conversation_id, attempts, max_attempts
  `);
  return Array.from(rows as Iterable<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    organizationId: String(r.organization_id),
    kind: r.kind as JobKind,
    conversationId: String(r.conversation_id),
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
  }));
}

export async function complete(id: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.agentJob)
    .set({ status: "done", lockedAt: null, updatedAt: new Date() })
    .where(eq(schema.agentJob.id, id));
}

/** 1, 2, 4… minutos. */
export function backoffMs(attempts: number): number {
  return 2 ** attempts * 60_000;
}

export async function fail(job: ClaimedJob, error: unknown): Promise<void> {
  const db = getDb();
  const attempts = job.attempts + 1;
  const message = String(error instanceof Error ? error.message : error).slice(0, 1000);
  const exhausted = attempts >= job.maxAttempts;
  await db
    .update(schema.agentJob)
    .set({
      status: exhausted ? "failed" : "queued",
      attempts,
      lastError: message,
      lockedAt: null,
      runAt: exhausted ? undefined : new Date(Date.now() + backoffMs(job.attempts)),
      updatedAt: new Date(),
    })
    .where(eq(schema.agentJob.id, job.id));
}

/** Un trabajo `running` de hace más de 10 min es un proceso que murió. */
export async function requeueStale(olderThanMs = 10 * 60_000): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanMs);
  const rows = await db
    .update(schema.agentJob)
    .set({ status: "queued", lockedAt: null, updatedAt: new Date() })
    .where(
      and(eq(schema.agentJob.status, "running"), lt(schema.agentJob.lockedAt, cutoff))
    )
    .returning({ id: schema.agentJob.id });
  return rows.length;
}
