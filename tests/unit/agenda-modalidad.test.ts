import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODALITIES,
  normalizeModalities,
  resolveModality,
} from "@/lib/agenda-modalities";
import { meetingNotes, meetingTopic } from "@/server/agenda/service";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";

/**
 * Modalidad de la cita (T1.4). Lo que se fija: el negocio decide qué ofrece,
 * el cliente elige entre eso, y el evento del calendario le cuenta al dueño
 * todo lo que necesita sin abrir el CRM.
 */

describe("resolveModality", () => {
  it("la pedida gana si el negocio la permite", () => {
    expect(resolveModality("llamada", ["presencial", "llamada"])).toBe("llamada");
  });

  it("una modalidad que el negocio no ofrece cae a la primera permitida", () => {
    // El modelo puede alucinar "videollamada" aunque el negocio no la tenga.
    expect(resolveModality("videollamada", ["presencial", "llamada"])).toBe("presencial");
  });

  it("sin pedido y con una sola permitida, es esa", () => {
    expect(resolveModality(null, ["llamada"])).toBe("llamada");
  });

  it("con lista vacía (dato corrupto) cae al default y nunca a null", () => {
    expect(resolveModality(undefined, [])).toBe(DEFAULT_MODALITIES[0]);
  });
});

describe("normalizeModalities", () => {
  it("descarta lo desconocido, deduplica y ordena como el catálogo", () => {
    expect(normalizeModalities(["llamada", "zoom", "presencial", "llamada"])).toEqual([
      "presencial",
      "llamada",
    ]);
    expect(normalizeModalities("presencial")).toEqual([]);
  });
});

describe("el evento del calendario es el aviso al dueño", () => {
  it("el título dice cómo se atiende y a quién", () => {
    expect(meetingTopic("presencial", "Ana")).toBe("Cita presencial — Ana");
    expect(meetingTopic("llamada", "")).toBe("Llamada");
  });

  it("la descripción trae WhatsApp clicable, lugar y modalidad", () => {
    const notes = meetingNotes(
      "presencial",
      { name: "Ana", phone: "51977172089" },
      "quiere tarjetas",
      { address: "Av. El Sol 123, Cusco" }
    );
    expect(notes).toContain("Modalidad: Presencial");
    expect(notes).toContain("https://wa.me/51977172089");
    expect(notes).toContain("Lugar: Av. El Sol 123, Cusco");
    expect(notes).toContain("Notas: quiere tarjetas");
  });

  it("una llamada no lleva lugar aunque el negocio tenga dirección", () => {
    const notes = meetingNotes(
      "llamada",
      { name: "Ana", phone: null },
      null,
      { address: "Av. El Sol 123" }
    );
    expect(notes).not.toContain("Lugar:");
    expect(notes).not.toContain("WhatsApp:");
  });
});

describe("el prompt y las modalidades", () => {
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
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("con varias modalidades, pide preguntar UNA vez y pasarla en book_slot", () => {
    const prompt = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [],
      agenda: true,
      modalities: ["presencial", "llamada"],
      address: "Av. El Sol 123",
    });
    expect(prompt).toContain('"modality":"<presencial|llamada>"');
    expect(prompt).toMatch(/pregunta cuál prefiere/);
    expect(prompt).toContain("Av. El Sol 123");
    expect(prompt).not.toContain("videollamada");
  });

  it("con una sola modalidad, prohíbe preguntar", () => {
    const prompt = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [],
      agenda: true,
      modalities: ["llamada"],
    });
    expect(prompt).toMatch(/No preguntes modalidad/);
    expect(prompt).toContain('modality="llamada"');
  });
});
