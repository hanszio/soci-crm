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

describe("horarios inventados por el modelo", () => {
  it("detecta una lista de huecos escrita a mano (día + hora)", async () => {
    const { looksLikeInventedSlots } = await import("@/server/ai/policy");
    expect(
      looksLikeInventedSlots(
        "¿Prefieres presencial o llamada? Tenemos horarios mañana viernes 4 de septiembre a las 09:00, 09:30 o 10:00."
      )
    ).toBe(true);
    expect(looksLikeInventedSlots("Te agendo el jueves a las 10:00.")).toBe(true);
  });

  it("no confunde el horario de atención ni una respuesta normal", async () => {
    const { looksLikeInventedSlots } = await import("@/server/ai/policy");
    expect(looksLikeInventedSlots("Atendemos de lunes a viernes de 9:00 a 18:00.")).toBe(false);
    expect(looksLikeInventedSlots("El millar de tarjetas sale desde S/ 80.")).toBe(false);
    expect(looksLikeInventedSlots("¿Prefieres la cita presencial o una llamada?")).toBe(false);
  });

  it("deja la introducción sin los horarios", async () => {
    const { stripSlotSentences } = await import("@/server/ai/policy");
    expect(
      stripSlotSentences(
        "¿Prefieres la cita presencial en la tienda o una llamada? Tenemos horarios mañana viernes 4 de septiembre a las 09:00, 09:30 o 10:00."
      )
    ).toBe("¿Prefieres la cita presencial en la tienda o una llamada?");
    expect(stripSlotSentences("Mañana martes a las 10:00 te espero.")).toBe("");
  });
});

describe("saludos iniciales", () => {
  it("elige una variante al azar entre las líneas configuradas", async () => {
    const { pickGreeting, greetingVariants } = await import("@/server/ai/policy");
    const raw = "Hola!, buen día, le habla David de Spark\n- Buenas, habla David de Spark\n\n";
    expect(greetingVariants(raw)).toHaveLength(2);
    expect(pickGreeting(raw, () => 0)).toBe("Hola!, buen día, le habla David de Spark");
    expect(pickGreeting(raw, () => 0.99)).toBe("Buenas, habla David de Spark");
    expect(pickGreeting("", () => 0)).toBeNull();
  });

  it("si el modelo no abrió con el saludo, se antepone; si ya lo puso, no se duplica", async () => {
    const { ensureGreeting } = await import("@/server/ai/policy");
    const g = "Hola!, buen día, le habla David de Spark";
    expect(ensureGreeting("Sí, dígame, ¿en qué podemos ayudarle?", g)).toBe(
      `${g}\nSí, dígame, ¿en qué podemos ayudarle?`
    );
    expect(ensureGreeting("Hola, buen dia, le habla David de Spark. ¿Qué necesita?", g)).toBe(
      "Hola, buen dia, le habla David de Spark. ¿Qué necesita?"
    );
    // Un "Hola!" propio del modelo se reemplaza para no saludar dos veces.
    expect(ensureGreeting("¡Hola! ¿En qué le ayudo?", g)).toBe(`${g}\n¿En qué le ayudo?`);
  });

  it("el prompt exige el saludo solo en el primer mensaje", async () => {
    const { buildAgentSystemPrompt } = await import("@/server/ai/prompts");
    const profile = {
      id: "agp_1", organizationId: "org_1", enabled: true, name: "David", tone: null,
      instructions: null, escalationRules: null, greeting: "Hola, habla David",
      escalationMode: "cita" as const, delayMinSec: 10, delayMaxSec: 300,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const first = buildAgentSystemPrompt({ profile, kb: [], stages: [], firstTurn: true, greeting: "Hola, habla David" });
    expect(first).toContain("Empieza EXACTAMENTE con: «Hola, habla David»");
    const later = buildAgentSystemPrompt({ profile, kb: [], stages: [], firstTurn: false });
    expect(later).toContain("NO vuelvas a saludar");
  });
});
