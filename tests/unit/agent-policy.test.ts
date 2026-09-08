import { describe, expect, it } from "vitest";
import {
  decideEscalation,
  nextProviderRetry,
  PROVIDER_RETRY_DELAYS_MS,
} from "@/server/ai/policy";
import { buildAgentSystemPrompt, buildJudgePrompt } from "@/server/ai/prompts";

/**
 * Política de cierre (T1.14): el dueño no vive en el dashboard, así que el
 * agente no puede callarse ANTES de una cita. Pedir un humano se convierte en
 * agendar una llamada; el proveedor caído se reintenta; y solo después de
 * agendar (o de cancelar/hostilidad) la IA le pasa el hilo al equipo.
 */

describe("decideEscalation", () => {
  const base = { mode: "cita" as const, agenda: true, hasActiveBooking: false };

  it("con política cita y agenda, pedir un humano ⇒ ofrecer una llamada", () => {
    expect(decideEscalation({ ...base, reason: null })).toEqual({ kind: "offer_call" });
    expect(decideEscalation({ ...base, reason: "pide hablar con alguien" })).toEqual({
      kind: "offer_call",
    });
  });

  it("si ya tiene cita activa, pedir un humano SÍ escala", () => {
    expect(decideEscalation({ ...base, hasActiveBooking: true })).toEqual({
      kind: "handoff",
    });
  });

  it("cancelar u hostilidad escalan aunque la política sea cita", () => {
    expect(decideEscalation({ ...base, reason: "quiere cancelar su cita" })).toEqual({
      kind: "handoff",
    });
    expect(decideEscalation({ ...base, reason: "cliente hostil, insultos" })).toEqual({
      kind: "handoff",
    });
  });

  it("sin agenda no hay llamada que ofrecer ⇒ handoff", () => {
    expect(decideEscalation({ ...base, agenda: false })).toEqual({ kind: "handoff" });
  });

  it("la política humano conserva el comportamiento clásico", () => {
    expect(decideEscalation({ ...base, mode: "humano" })).toEqual({ kind: "handoff" });
  });
});

describe("nextProviderRetry", () => {
  it("espera creciente y luego se rinde", () => {
    expect(nextProviderRetry(0)).toBe(PROVIDER_RETRY_DELAYS_MS[0]);
    expect(nextProviderRetry(2)).toBe(PROVIDER_RETRY_DELAYS_MS[2]);
    expect(nextProviderRetry(3)).toBeNull();
  });
});

describe("el prompt según la política", () => {
  const profile = {
    id: "agp_1",
    organizationId: "org_1",
    enabled: true,
    name: "Leo",
    tone: null,
    instructions: null,
    escalationRules: null,
    greeting: null,
    escalationMode: "cita" as const,
  delayMinSec: 10,
  delayMaxSec: 300,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("cita: pedir humano ⇒ llamada agendada, y el objetivo es la cita", () => {
    const prompt = buildAgentSystemPrompt({ profile, kb: [], stages: [], agenda: true });
    expect(prompt).toContain("TU OBJETIVO en cada conversación es llegar a una cita");
    expect(prompt).toMatch(/pide hablar con una persona\/humano\/asesor → NO uses handoff/);
    expect(prompt).toContain('modality="llamada"');
  });

  it("humano: pedir humano ⇒ handoff, sin objetivo de cita", () => {
    const prompt = buildAgentSystemPrompt({
      profile: { ...profile, escalationMode: "humano" },
      kb: [],
      stages: [],
      agenda: true,
    });
    expect(prompt).not.toContain("TU OBJETIVO");
    expect(prompt).toMatch(/pide hablar con una persona\/humano\/asesor → handoff\./);
  });

  it("sin agenda, la política cita no puede ofrecer llamadas: cae al clásico", () => {
    const prompt = buildAgentSystemPrompt({ profile, kb: [], stages: [], agenda: false });
    expect(prompt).toMatch(/pide hablar con una persona\/humano\/asesor → handoff\./);
  });

  it("el estilo humano va siempre: corto, sin repetir, una pregunta", () => {
    const prompt = buildAgentSystemPrompt({ profile, kb: [], stages: [], agenda: false });
    expect(prompt).toContain("ESTILO (obligatorio)");
    expect(prompt).toMatch(/1 a 3 líneas/);
    expect(prompt).toMatch(/Máximo una pregunta por mensaje/);
  });

  it("el juez acepta la llamada agendada como escalado", () => {
    const { system } = buildJudgePrompt({
      persona: "p",
      transcript: [],
      kbText: "",
      behaviorText: "",
    });
    expect(system).toContain("Ofrecer una llamada agendada CUENTA como escalar");
  });
});
