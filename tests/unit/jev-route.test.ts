import { describe, expect, it } from "vitest";
import type { Answer } from "@/lib/typesafe";
import { routeTurn, THRESHOLDS, type RouteContext } from "@/server/jev/route";
import { buildJevRequest } from "@/server/jev/questions";
import { chooseVariant, renderVariant } from "@/server/replies/bank";
import { DEFAULT_VARIANTS, REPLY_KEYS } from "@/server/replies/keys";
import { typesafeMockAnswers } from "@/server/dev/typesafe-mock";

/**
 * 018 — La política del turno con Jev. Todo lo que decide es código puro: se
 * prueba con respuestas simuladas, sin red. Lo que se fija es que el riesgo
 * manda: lo dudoso o lo caro de equivocar va al LLM, nunca al carril directo.
 */

const ch = (choice: string, confidence = 0.97): Answer => ({
  type: "choice",
  choice,
  confidence,
  probabilities: { [choice]: confidence },
});
const no = (noul: number): Answer => ({ type: "noul", noul });

const ctx: RouteContext = {
  agenda: true,
  lastOutIsQuestion: false,
  modalities: ["presencial", "llamada"],
  sentItemIds: [],
  maps: {
    offers: { h1: "2026-10-06T14:00:00.000Z", h2: "2026-10-06T15:00:00.000Z" },
    fichas: { f1: "kb_1", f2: "kb_2" },
    files: { a1: "cat_1" },
  },
};
const base = (over: Record<string, Answer>): Record<string, Answer> => ({
  intencion: ch("otro"),
  pide_humano: no(0.02),
  hostil: no(0.02),
  inyeccion: no(0.02),
  compuesta: no(0.02),
  ...over,
});

describe("routeTurn", () => {
  it("saludo, acuse y despedida salen del banco", () => {
    expect(routeTurn(base({ intencion: ch("saludo") }), ctx)).toEqual({ type: "bank", key: "abrir" });
    expect(routeTurn(base({ intencion: ch("confirmacion") }), ctx)).toEqual({ type: "bank", key: "ack" });
    expect(routeTurn(base({ intencion: ch("despedida") }), ctx)).toEqual({ type: "bank", key: "despedida" });
  });

  it("un «ok» que responde a una pregunta del asistente NO es un acuse: va al LLM", () => {
    const plan = routeTurn(base({ intencion: ch("confirmacion") }), { ...ctx, lastOutIsQuestion: true });
    expect(plan).toMatchObject({ type: "llm", reason: "confirmacion_a_pregunta" });
  });

  it("ficha directa solo con confianza alta; si no, LLM", () => {
    const hi = routeTurn(base({ intencion: ch("pregunta_negocio"), ficha: ch("f2", 0.93) }), ctx);
    expect(hi).toEqual({ type: "ficha", fichaId: "kb_2" });
    const lo = routeTurn(
      base({ intencion: ch("pregunta_negocio"), ficha: ch("f2", THRESHOLDS.ficha - 0.01) }),
      ctx
    );
    expect(lo.type).toBe("llm");
    const none = routeTurn(base({ intencion: ch("pregunta_negocio"), ficha: ch("ninguna") }), ctx);
    expect(none.type).toBe("llm");
  });

  it("una pregunta compuesta va al LLM aunque haya ficha segura", () => {
    const plan = routeTurn(
      base({ intencion: ch("pregunta_negocio"), ficha: ch("f1"), compuesta: no(0.9) }),
      ctx
    );
    expect(plan).toMatchObject({ type: "llm", reason: "compuesta" });
  });

  it("reservar exige horario seguro Y modalidad clara", () => {
    const ok = routeTurn(
      base({ intencion: ch("elegir_horario"), horario: ch("h2"), modalidad: ch("llamada", 0.8) }),
      ctx
    );
    expect(ok).toEqual({ type: "book", startUtc: "2026-10-06T15:00:00.000Z", modality: "llamada" });

    const sinModalidad = routeTurn(
      base({ intencion: ch("elegir_horario"), horario: ch("h2"), modalidad: ch("no_dijo") }),
      ctx
    );
    expect(sinModalidad).toMatchObject({ type: "llm", reason: "falta_modalidad" });

    const dudoso = routeTurn(
      base({ intencion: ch("elegir_horario"), horario: ch("h2", 0.7), modalidad: ch("llamada") }),
      ctx
    );
    expect(dudoso.type).toBe("llm");
  });

  it("con una sola modalidad no hace falta preguntarla", () => {
    const plan = routeTurn(base({ intencion: ch("elegir_horario"), horario: ch("h1") }), {
      ...ctx,
      modalities: ["llamada"],
    });
    expect(plan).toMatchObject({ type: "book", modality: "llamada" });
  });

  it("otro día u hora no reserva nada", () => {
    const plan = routeTurn(base({ intencion: ch("elegir_horario"), horario: ch("otro_dia_u_hora") }), ctx);
    expect(plan.type).toBe("llm");
  });

  it("agendar ofrece horarios; sin agenda no", () => {
    expect(routeTurn(base({ intencion: ch("agendar") }), ctx)).toEqual({ type: "offer" });
    expect(routeTurn(base({ intencion: ch("agendar") }), { ...ctx, agenda: false }).type).toBe("llm");
  });

  it("pedir precios manda el archivo una sola vez", () => {
    const answers = base({ intencion: ch("pedir_precio_o_catalogo"), archivo: ch("a1") });
    expect(routeTurn(answers, ctx)).toEqual({ type: "send", itemId: "cat_1" });
    expect(routeTurn(answers, { ...ctx, sentItemIds: ["cat_1"] }).type).toBe("llm");
  });

  it("la seguridad gana a todo lo demás", () => {
    const inj = routeTurn(base({ intencion: ch("saludo"), inyeccion: no(0.8) }), ctx);
    expect(inj).toEqual({ type: "bank", key: "fuera_de_tema" });
    const hostil = routeTurn(base({ intencion: ch("pregunta_negocio"), ficha: ch("f1"), hostil: no(0.9) }), ctx);
    expect(hostil).toMatchObject({ type: "handoff" });
  });

  it("pedir humano necesita la intención Y el noul; cancelar siempre escala", () => {
    expect(routeTurn(base({ intencion: ch("pedir_humano"), pide_humano: no(0.95) }), ctx)).toMatchObject({
      type: "handoff",
      reason: "pide hablar con una persona",
    });
    // J0: «quién es el contador a cargo» dispara el noul pero no la intención.
    expect(routeTurn(base({ intencion: ch("pregunta_negocio"), pide_humano: no(0.97) }), ctx).type).toBe("llm");
    expect(routeTurn(base({ intencion: ch("cancelar_o_cambiar_cita") }), ctx)).toMatchObject({ type: "handoff" });
  });

  it("intención con poca confianza no dispara nada directo", () => {
    expect(routeTurn(base({ intencion: ch("saludo", 0.4) }), ctx).type).toBe("llm");
  });
});

describe("buildJevRequest", () => {
  const req = buildJevRequest({
    business: { name: "Estudio", agent: "Ana" },
    history: [{ from: "cliente", text: "hola" }],
    lastMessage: "mañana a las 10",
    offers: [
      { startUtc: "2026-10-06T14:00:00.000Z", label: "mañana 09:00" },
      { startUtc: "2026-10-06T15:00:00.000Z", label: "mañana 10:00" },
    ],
    fichas: [{ id: "kb_x", question: "¿Dónde están?" }],
    files: [],
    modalities: ["presencial", "llamada"],
  });

  it("usa ids cortos y guarda el mapa a los reales; las respuestas de las fichas no viajan", () => {
    expect(req.maps.offers.h2).toBe("2026-10-06T15:00:00.000Z");
    expect(req.maps.fichas.f1).toBe("kb_x");
    expect(JSON.stringify(req.state)).not.toContain("kb_x");
    expect(req.questions.archivo).toBeUndefined();
  });

  it("siempre hay una salida de «no aplica» y la posición del horario va escrita", () => {
    const horario = req.questions.horario as { criteria: Record<string, string> };
    expect(Object.keys(horario.criteria)).toEqual(["h1", "h2", "otro_dia_u_hora", "ninguno"]);
    expect(horario.criteria.h2).toContain("segunda opción y la última");
    expect(Object.keys((req.questions.ficha as { criteria: object }).criteria)).toContain("ninguna");
  });

  it("sin oferta ni fichas no se pregunta por ellas", () => {
    const bare = buildJevRequest({
      business: { name: "X", agent: "Y" },
      history: [],
      lastMessage: "hola",
      offers: [],
      fichas: [],
      files: [],
      modalities: [],
    });
    expect(Object.keys(bare.questions).sort()).toEqual(
      ["compuesta", "hostil", "intencion", "inyeccion", "pide_humano"].sort()
    );
  });
});

describe("banco de respuestas", () => {
  it("no repite una variante ya usada en la conversación", () => {
    const candidates = ["De nada.", "Perfecto.", "A usted."];
    const used = ["Hola, buen día\nSí, dígame", "de nada."];
    for (let i = 0; i < 20; i++) {
      expect(chooseVariant(candidates, used, () => i / 20)).not.toBe("De nada.");
    }
  });

  it("si ya se usaron todas, repite antes que callar", () => {
    expect(chooseVariant(["a", "b"], ["a", "b"], () => 0)).toBe("a");
    expect(chooseVariant([], [], () => 0)).toBeNull();
  });

  it("toda clave tiene variantes de fábrica (las de conversación, 3 o más) y las ranuras se resuelven", () => {
    for (const key of REPLY_KEYS) expect(DEFAULT_VARIANTS[key].length).toBeGreaterThanOrEqual(2);
    for (const key of ["abrir", "ack", "despedida", "fuera_de_tema"] as const) {
      expect(DEFAULT_VARIANTS[key].length).toBeGreaterThanOrEqual(3);
    }
    expect(renderVariant("Temas de {negocio}. Soy {agente}.", { negocio: "Spark", agente: "David" })).toBe(
      "Temas de Spark. Soy David."
    );
  });
});

describe("typesafe-mock", () => {
  it("responde con la forma del API real y es determinista", () => {
    const { questions, state } = buildJevRequest({
      business: { name: "X", agent: "Y" },
      history: [],
      lastMessage: "hola buenas",
      offers: [],
      fichas: [{ id: "kb_1", question: "¿Dónde están ubicados?" }],
      files: [],
      modalities: [],
    });
    const a = typesafeMockAnswers(state, questions) as Record<string, Answer>;
    expect(a.intencion).toMatchObject({ type: "choice", choice: "saludo" });
    expect(routeTurn(a, { ...ctx, maps: { offers: {}, fichas: { f1: "kb_1" }, files: {} } })).toEqual({
      type: "bank",
      key: "abrir",
    });
  });
});

describe("trato y frases del sistema", () => {
  it("cada clave tiene variantes en usted y en tú, y ninguna mezcla el trato", async () => {
    const { defaultVariants } = await import("@/server/replies/keys");
    const usted = defaultVariants("usted");
    const tu = defaultVariants("tu");
    for (const key of REPLY_KEYS) {
      expect(usted[key].length, key).toBeGreaterThanOrEqual(2);
      expect(tu[key].length, key).toBeGreaterThanOrEqual(2);
      for (const t of usted[key]) expect(t, `${key}: ${t}`).not.toMatch(/\b(te|ti|tu|tus|dime|mira|necesitas|quieres|escribes)\b/i);
      for (const t of tu[key]) expect(t, `${key}: ${t}`).not.toMatch(/\b(le|usted|dígame|cuénteme|necesita|disculpe)\b/i);
    }
  });

  it("makeSay: las variantes del negocio ganan, las ranuras se llenan y un mismo turno no se repite", async () => {
    const { makeSay } = await import("@/server/replies/bank");
    const say = makeSay({ ack: ["Ya, con gusto.", "Para servirle."] }, "usted", [], { negocio: "Spark" }, () => 0);
    const a = say("ack");
    const b = say("ack");
    expect([a, b].sort()).toEqual(["Para servirle.", "Ya, con gusto."]);
    expect(say("cita_confirmada", { horario: "mar 6 oct, 10:00" })).toContain("mar 6 oct, 10:00");
    expect(say("fuera_de_tema")).toContain("Spark");
    const tu = makeSay({}, "tu", [], {}, () => 0);
    expect(tu("cita_llamada")).toBe("Te llamamos a este mismo número.");
  });

  it("tras agendar solo se permite la cortesía", async () => {
    const { isCourtesyPlan } = await import("@/server/jev/route");
    expect(isCourtesyPlan({ type: "bank", key: "ack" })).toBe(true);
    expect(isCourtesyPlan({ type: "bank", key: "despedida" })).toBe(true);
    expect(isCourtesyPlan({ type: "bank", key: "abrir" })).toBe(false);
    expect(isCourtesyPlan({ type: "ficha", fichaId: "kb_1" })).toBe(false);
    expect(isCourtesyPlan({ type: "llm", reason: "x" })).toBe(false);
  });
});
