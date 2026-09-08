import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt, renderOffers } from "@/server/ai/prompts";
import { formatNow } from "@/server/ai/pipeline";

/**
 * Bug real (2026-09-03): el cliente eligió "mañana a las 10" tres veces y el
 * agente re-ofreció la misma lista tres veces. El modelo veía las etiquetas
 * pero nunca el startUtc que book_slot exige — no PODÍA reservar.
 */

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

const OFFERS = [
  { startUtc: "2026-09-04T14:00:00.000Z", label: "vie 4 sep, 09:00" },
  { startUtc: "2026-09-04T15:00:00.000Z", label: "vie 4 sep, 10:00" },
];

describe("prompt del agente con agenda", () => {
  it("la oferta vigente va al prompt con el startUtc EXACTO junto a la etiqueta", () => {
    const prompt = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [{ name: "Nuevo" }],
      agenda: true,
      offers: OFFERS,
    });
    expect(prompt).toContain('startUtc="2026-09-04T15:00:00.000Z" → vie 4 sep, 10:00');
    // Y la regla que evita el bucle: elegir en palabras ⇒ book_slot, no re-listar.
    expect(prompt).toMatch(/aunque lo diga en palabras/);
    expect(prompt).toMatch(/NO repitas la lista/);
  });

  it("sin oferta previa, el prompt lo dice: primero offer_slots", () => {
    const prompt = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [],
      agenda: true,
      offers: [],
    });
    expect(prompt).toContain("ninguna todavía");
  });

  it("con la agenda apagada no se menciona ninguna oferta", () => {
    const prompt = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [],
      agenda: false,
      offers: OFFERS,
    });
    expect(prompt).not.toContain("OFERTA VIGENTE");
    expect(prompt).not.toContain("startUtc=");
  });

  it("la fecha actual llega en la zona del negocio", () => {
    const prompt = buildAgentSystemPrompt({
      profile,
      kb: [],
      stages: [],
      agenda: true,
      now: formatNow(new Date("2026-09-04T14:12:00.000Z"), "America/Lima"),
    });
    // 14:12Z = 09:12 en Lima; el modelo necesita saber qué día es "mañana".
    expect(prompt).toMatch(/Fecha y hora actual: viernes,? 4 de septiembre de 2026,? 09:12 \(America\/Lima\)/);
  });

  it("renderOffers es determinista y legible", () => {
    expect(renderOffers(OFFERS).split("\n")).toHaveLength(3);
  });
});
