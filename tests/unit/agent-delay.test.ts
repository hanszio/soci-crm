import { describe, expect, it } from "vitest";
import { classifyIntent, computeDelaySec, typingLeadSec } from "@/server/jobs/delay";

/** T1.2 — el retraso humano: nadie contesta un WhatsApp en 200 ms. */

const mid = () => 0.5;

describe("classifyIntent", () => {
  it("reconoce saludos, confirmaciones, agenda y preguntas", () => {
    expect(classifyIntent("Hola!")).toBe("greeting");
    expect(classifyIntent("ok")).toBe("ack");
    expect(classifyIntent("gracias")).toBe("ack");
    expect(classifyIntent("Quiero una cita para mañana")).toBe("booking");
    expect(classifyIntent("mañana a las 10")).toBe("booking");
    expect(classifyIntent("¿Cuánto cuesta el millar?")).toBe("question");
    expect(classifyIntent("Tarjetas")).toBe("other");
  });
});

describe("computeDelaySec", () => {
  it("un ok se contesta rápido; una cita tarda más", () => {
    const ack = computeDelaySec({ text: "ok", minSec: 0, maxSec: 600, mode: "human", rng: mid });
    const cita = computeDelaySec({
      text: "quiero agendar una cita",
      minSec: 0,
      maxSec: 600,
      mode: "human",
      rng: mid,
    });
    expect(ack).toBeLessThan(cita);
    expect(ack).toBeGreaterThanOrEqual(6);
    expect(cita).toBeGreaterThanOrEqual(40);
  });

  it("respeta el rango del negocio", () => {
    expect(
      computeDelaySec({ text: "ok", minSec: 30, maxSec: 40, mode: "human", rng: mid })
    ).toBe(30);
    expect(
      computeDelaySec({ text: "x".repeat(5000), minSec: 0, maxSec: 45, mode: "human", rng: () => 0.99 })
    ).toBe(45);
  });

  it("instant ⇒ 0, siempre", () => {
    expect(
      computeDelaySec({ text: "quiero agendar", minSec: 10, maxSec: 300, mode: "instant" })
    ).toBe(0);
  });

  it("el ruido hace que dos mensajes iguales no tarden exactamente igual", () => {
    const a = computeDelaySec({ text: "hola", minSec: 0, maxSec: 600, mode: "human", rng: () => 0.1 });
    const b = computeDelaySec({ text: "hola", minSec: 0, maxSec: 600, mode: "human", rng: () => 0.9 });
    expect(a).not.toBe(b);
  });
});

describe("typingLeadSec", () => {
  it("no se enciende para retrasos cortos y nunca pasa de 20 s", () => {
    expect(typingLeadSec(0)).toBe(0);
    expect(typingLeadSec(5)).toBe(0);
    expect(typingLeadSec(10)).toBe(4);
    expect(typingLeadSec(300)).toBe(20);
  });
});
