import { describe, expect, it, vi } from "vitest";
import { backoffMs } from "@/server/jobs/queue";
import { runTick, type TickDeps } from "@/server/jobs/poller";

/**
 * T1.2 — el trabajador de la cola. Lo que se fija: despacha por `kind`,
 * marca hecho lo que salió bien, y un fallo devuelve el trabajo a la cola
 * (con backoff) en vez de perderlo — o lo da por perdido al agotar intentos.
 */

vi.mock("@/lib/env", () => ({ getEnv: () => ({ AGENT_JOB_POLL_MS: 2000 }) }));
vi.mock("@/server/ai/pipeline", () => ({ runAgentTurnExclusive: async () => "ran" }));
vi.mock("@/server/whatsapp/typing", () => ({ sendTypingIndicator: async () => ({ ok: true }) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

function job(over: Partial<Parameters<TickDeps["fail"]>[0]> = {}) {
  return {
    id: "ajb_1",
    organizationId: "org_1",
    kind: "agent_turn" as const,
    conversationId: "cv_1",
    attempts: 0,
    maxAttempts: 3,
    ...over,
  };
}

describe("runTick", () => {
  it("despacha por kind y marca hecho", async () => {
    const complete = vi.fn(async () => {});
    const fail = vi.fn(async () => {});
    const turn = vi.fn(async () => {});
    const took = await runTick({
      claim: async () => [job()],
      complete,
      fail,
      handlers: { agent_turn: turn, agent_typing: async () => {} },
    });
    expect(took).toBe(1);
    expect(turn).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith("ajb_1");
    expect(fail).not.toHaveBeenCalled();
  });

  it("un handler que lanza no tumba el tick: el trabajo pasa a fail", async () => {
    const fail = vi.fn(async () => {});
    const complete = vi.fn(async () => {});
    await runTick({
      claim: async () => [job(), job({ id: "ajb_2", conversationId: "cv_2" })],
      complete,
      fail,
      handlers: {
        agent_turn: async (j) => {
          if (j.id === "ajb_1") throw new Error("proveedor caído");
        },
        agent_typing: async () => {},
      },
    });
    expect(fail).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith("ajb_2");
  });

  it("sin trabajos vencidos no hace nada", async () => {
    const took = await runTick({
      claim: async () => [],
      complete: async () => {},
      fail: async () => {},
      handlers: { agent_turn: async () => {}, agent_typing: async () => {} },
    });
    expect(took).toBe(0);
  });
});

describe("backoffMs", () => {
  it("1, 2, 4 minutos", () => {
    expect(backoffMs(0)).toBe(60_000);
    expect(backoffMs(1)).toBe(120_000);
    expect(backoffMs(2)).toBe(240_000);
  });
});
